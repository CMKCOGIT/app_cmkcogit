// Geração do orçamento detalhado de um pedido JÁ PAGO (status "paid" no banco, que só o
// aplicar_pagamento_mp grava depois de consultar o pagamento na API do Mercado Pago).
//
//   paid --(reserva atômica: mvp_reservar_geracao)--> generating --> ready (PDF no Storage)
//                                                            └-> paid (nova tentativa) | failed (esgotou)
//
// Quem chama: a tela de espera (POST /api/mvp/gerar), a rotina diária (api/renovacoes.js) e o admin.
// Duas chamadas ao mesmo tempo não geram duas vezes: só quem conseguiu a reserva segue.
// Cada chamada à IA grava tokens e custo reais em mvp_budget_generations, inclusive as que falham.
import { registrarErro } from './http.js';
import { gerarJsonClaude, configClaude } from './claude.js';
import { custoDoUso } from './custo.js';
import { SISTEMA_DOCUMENTO, ESQUEMA_DOCUMENTO, validarDocumento, montarEntrada } from './mvp-documento.js';
import { renderizarPdf } from './mvp-pdf.js';
import { criarStorage } from './storage.js';
import { createNotification } from './notificacoes.js';

export const BUCKET_PDF = 'orcamentos-mvp';

// Só para testes: troca o cliente do Claude, o Storage ou o renderizador sem mexer nas rotas.
export const dependenciasPadrao = {};
export const caminhoPdf = (pedido) => pedido.user_id + '/' + pedido.id + '.pdf';

export async function configPreco(db) {
  const c = await db.um('mvp_pricing_config', { select: '*', id: 'eq.1' });
  return {
    price_brl: Number(c && c.price_brl) || 30,
    usd_brl: Number(c && c.usd_brl) || 5.4,
    max_output_tokens: Number(c && c.max_output_tokens) || 16000,
    credit_valid_days: c && c.credit_valid_days != null ? Number(c.credit_valid_days) : 90,
    max_tentativas: Number(c && c.max_tentativas) || 3,
    validade_orcamento_dias: Number(c && c.validade_orcamento_dias) || 30
  };
}

async function registrarCusto(db, { pedidoId, provider, model, usage, usdBrl, sucesso }) {
  try {
    const c = custoDoUso(usage, model, { usdBrl });
    await db.inserir('mvp_budget_generations', {
      order_id: pedidoId, provider, model: model || 'desconhecido', sucesso,
      input_tokens: c.input_tokens, output_tokens: c.output_tokens,
      cache_read_tokens: c.cache_read_tokens, cache_write_tokens: c.cache_write_tokens,
      cost_usd: c.cost_usd, cost_brl: c.cost_brl, usd_brl: c.usd_brl
    });
  } catch (e) {
    registrarErro('mvp:custo', e);   // o registro de custo nunca derruba a entrega
  }
}

/**
 * Tenta gerar o documento de um pedido. Devolve o pedido como ficou.
 * deps (testes): { claude: cliente Anthropic falso, storage, env, renderizar }
 */
export async function processarPedido(db, pedidoId, depsChamada = {}) {
  const deps = { ...dependenciasPadrao, ...depsChamada };
  const env = deps.env || process.env;
  const reservados = await db.rpc('mvp_reservar_geracao', { p_order: pedidoId });
  const pedido = Array.isArray(reservados) ? reservados[0] : null;
  if (!pedido) return db.um('mvp_budget_orders', { select: '*', id: 'eq.' + pedidoId });   // outro já pegou, ou não está pago

  const cfg = await configPreco(db);
  let resposta = null;
  try {
    const [jornada, modulos, orcamento, comentarios, cliente] = await Promise.all([
      db.um('jornadas', { select: '*', id: 'eq.' + pedido.project_id }),
      db.select('jornada_modulos', { select: 'modulo,status,respostas', jornada_id: 'eq.' + pedido.project_id }),
      pedido.orcamento_id
        ? db.um('jornada_orcamentos', { select: '*', id: 'eq.' + pedido.orcamento_id })
        : db.um('jornada_orcamentos', { select: '*', jornada_id: 'eq.' + pedido.project_id, order: 'created_at.desc' }),
      db.select('mvp_mentor_comments', { select: 'modulo,body,created_at', project_id: 'eq.' + pedido.project_id, order: 'created_at.asc', limit: '40' }),
      db.um('profiles', { select: 'nome', id: 'eq.' + pedido.user_id })
    ]);
    if (!jornada || !orcamento) throw Object.assign(new Error('Projeto ou resumo não encontrado'), { codigo: 'sem_dados' });

    resposta = await gerarJsonClaude({
      sistema: SISTEMA_DOCUMENTO,
      prompt: montarEntrada({ titulo: jornada.titulo, modulos, orcamento: orcamento.dados, comentarios }),
      esquema: ESQUEMA_DOCUMENTO,
      maxTokens: cfg.max_output_tokens,
      env,
      cliente: deps.claude || null
    });
    await registrarCusto(db, { pedidoId, provider: 'anthropic', model: resposta.model, usage: resposta.usage, usdBrl: cfg.usd_brl, sucesso: true });

    const doc = validarDocumento(resposta.dados, orcamento.dados);
    const validade = new Date(Date.now() + cfg.validade_orcamento_dias * 86400000);
    const bytes = await (deps.renderizar || renderizarPdf)({
      doc, orcamento: orcamento.dados, jornada, cliente, pedido, validade, creditoDias: cfg.credit_valid_days
    });
    const caminho = caminhoPdf(pedido);
    await (deps.storage || criarStorage(env)).enviar(BUCKET_PDF, caminho, bytes);

    const prontos = await db.rpc('mvp_concluir_geracao', { p_order: pedido.id, p_path: caminho });
    const pronto = (Array.isArray(prontos) && prontos[0]) || pedido;
    await createNotification(db, {
      destinatarioId: pedido.user_id, tipo: 'jornada', titulo: 'Seu orçamento detalhado do MVP está pronto',
      mensagem: jornada.titulo, link: 'jornada.html?id=' + jornada.id
    }).catch((e) => registrarErro('mvp:aviso', e));
    return pronto;
  } catch (e) {
    // falha com resposta da IA (formato, recusa, cortada): o custo também conta
    if (e && e.usage && !resposta) {
      await registrarCusto(db, { pedidoId, provider: 'anthropic', model: e.model || configClaude(env).modelo, usage: e.usage, usdBrl: cfg.usd_brl, sucesso: false });
    }
    registrarErro('mvp:geracao', e);
    const motivo = (e && e.codigo ? e.codigo + ': ' : '') + String((e && e.message) || e).slice(0, 240);
    const falhou = await db.rpc('mvp_falhar_geracao', { p_order: pedido.id, p_erro: motivo }).catch(() => null);
    const atual = Array.isArray(falhou) && falhou[0];
    if (atual && atual.status === 'failed') {
      await createNotification(db, {
        destinatarioId: pedido.user_id, tipo: 'jornada', titulo: 'Não conseguimos gerar seu orçamento detalhado',
        mensagem: 'Você pode tentar de novo ou pedir o estorno dos R$ ' + Number(pedido.price_brl).toFixed(2).replace('.', ',') + '.',
        link: 'jornada.html?id=' + pedido.project_id
      }).catch(() => {});
    }
    return atual || db.um('mvp_budget_orders', { select: '*', id: 'eq.' + pedido.id });
  }
}

// Rotina diária: pedidos pagos sem documento (a tela de espera foi fechada antes da geração).
export async function processarPendentes(db, { limite = 3, deps = {} } = {}) {
  const seisMin = new Date(Date.now() - 6 * 60000).toISOString();
  const lista = await db.select('mvp_budget_orders', {
    select: 'id', or: '(status.eq.paid,and(status.eq.generating,gerando_desde.lt.' + seisMin + '))', order: 'paid_at.asc', limit: String(limite)
  });
  const resultado = [];
  for (const p of lista) resultado.push((await processarPedido(db, p.id, deps)) || { id: p.id });
  return resultado.map((p) => ({ id: p.id, status: p.status }));
}
