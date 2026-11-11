// Orçamento detalhado do MVP (R$ 30) — chamado pelo app e pelo mvp.cmkcogit.com.br (CORS em lib/cors.js).
// Endereço: /api/mvp?acao=...  (vercel.json reescreve para /api/notificacoes?rota=mvp: o plano Hobby
// da Vercel aceita no máximo 12 funções, então esta rota mora dentro de uma função que já existe).
//
//   GET  acao=config                          preço e regras (para a tela)
//   GET  acao=status&projeto_id=<jornada>     último pedido do projeto + crédito disponível
//   POST acao=pedir      { projeto_id }       cria o pedido + cobrança e devolve o link do Mercado Pago
//   POST acao=gerar      { pedido_id }        gera o documento de um pedido PAGO (o pagamento só vira "paid"
//                                             no banco depois de confirmado na API do Mercado Pago)
//   POST acao=tentar_novamente { pedido_id }  depois de "failed", libera mais uma tentativa (1 vez) e gera
//   GET  acao=pdf&pedido_id=                  URL assinada (10 min) do PDF; só o dono (ou admin)
//   POST acao=construir  { projeto_id }       "Construir com a CMK Cogit": cria a solicitação a partir do
//                                             orçamento SALVO no banco (nada vem da URL)
//   admin: GET acao=admin_pedidos · POST acao=admin_reprocessar | admin_estornar { pedido_id }
//
// Preço, crédito e validade vêm de mvp_pricing_config. Nenhum valor vem do navegador.
import { criarDb } from './supabase.js';
import { json, erro, lerCorpo, exigirUsuario, exigirCadastroCompleto, registrarErro, UUID, urlApp, urlPublica } from './http.js';
import { aplicarCors, origemPermitida } from './cors.js';
import { dentroDoLimite } from './limite.js';
import { criarPreferencia, linkDaPreferencia, estornarPagamentoMp, buscarPagamento, aplicarNoBanco } from './mercadopago.js';
import { processarPedido, configPreco, BUCKET_PDF } from './mvp-geracao.js';
import { criarStorage } from './storage.js';
import { calcular, texto } from './selecao.js';
import { createNotification } from './notificacoes.js';

class Recusa extends Error {
  constructor(status, mensagem, codigo, extra = {}) { super(mensagem); this.status = status; this.codigo = codigo; this.extra = extra; }
}

const ABERTOS = ['pending_payment', 'paid', 'generating'];

// MODO DE TESTE (sem pagar): MVP_TESTE_SEM_PAGAMENTO=email1@x.com,email2@y.com na Vercel do app.
// Só esses e-mails recebem o documento sem o Mercado Pago; todo o resto continua pagando.
// O pedido fica marcado (mp_payment_id = TESTE-SEM-PAGAMENTO), vale R$ 0,01 na margem e no crédito.
// A IA roda de verdade (gasta a chave da Anthropic). Para voltar ao normal: apague a variável.
export const MARCA_TESTE = 'TESTE-SEM-PAGAMENTO';
export function emailDeTeste(email, env = process.env) {
  const lista = String(env.MVP_TESTE_SEM_PAGAMENTO || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return Boolean(email) && lista.includes(String(email).toLowerCase());
}
const dia = 86400000;

export function pedidoPublico(p) {
  if (!p) return null;
  return {
    id: p.id, projeto_id: p.project_id, status: p.status, price_brl: Number(p.price_brl),
    created_at: p.created_at, paid_at: p.paid_at, ready_at: p.ready_at, refunded_at: p.refunded_at, valid_until: p.valid_until,
    tem_pdf: p.status === 'ready' && Boolean(p.document_path),
    pode_tentar_novamente: p.status === 'failed' && Boolean(p.paid_at) && !(p.tentativas_liberadas > 0),
    credito_usado_em: p.credito_usado_em
  };
}

// Crédito: valor pago no orçamento de ESTE projeto, ainda não usado e dentro do prazo
export async function creditoDoProjeto(db, usuarioId, projetoId, cfg) {
  if (!(cfg.credit_valid_days > 0)) return null;
  const desde = new Date(Date.now() - cfg.credit_valid_days * dia).toISOString();
  const p = await db.um('mvp_budget_orders', {
    select: 'id,price_brl,paid_at', user_id: 'eq.' + usuarioId, project_id: 'eq.' + projetoId,
    status: 'in.(paid,generating,ready,failed)', credito_usado_em: 'is.null', paid_at: 'gte.' + desde, order: 'paid_at.desc'
  });
  return p ? { pedido_id: p.id, valor: Number(p.price_brl), valido_ate: new Date(new Date(p.paid_at).getTime() + cfg.credit_valid_days * dia).toISOString() } : null;
}

async function projetoDoDono(db, id, usuarioId) {
  if (!UUID.test(id || '')) throw new Recusa(400, 'Projeto inválido.');
  const j = await db.um('jornadas', { select: '*', id: 'eq.' + id });
  if (!j || j.cliente_id !== usuarioId) throw new Recusa(404, 'Projeto não encontrado.');
  return j;
}
async function pedidoDe(db, id, usuarioId, admin = false) {
  if (!UUID.test(id || '')) throw new Recusa(400, 'Pedido inválido.');
  const p = await db.um('mvp_budget_orders', { select: '*', id: 'eq.' + id });
  if (!p || (!admin && p.user_id !== usuarioId)) throw new Recusa(404, 'Pedido não encontrado.');
  return p;
}
async function limitar(db, usuarioId, acao) {
  if (!(await dentroDoLimite(db, usuarioId, acao))) throw new Recusa(429, 'Muitas tentativas em pouco tempo. Aguarde alguns minutos.', 'limite');
}

async function linkDePagamento({ db, req, usuario, documento, pedido, pagamento, jornada }) {
  if (pagamento.link_pagamento && pagamento.mp_preference_id) return pagamento.link_pagamento;
  const origem = origemPermitida(req);
  const volta = origem
    ? origem + '/projeto.html?id=' + jornada.id                 // site do mvp
    : urlApp() + '/jornada.html?id=' + jornada.id;              // o próprio app
  const publica = urlPublica();
  const preferencia = {
    items: [{ id: pedido.id, title: 'Orçamento detalhado do MVP', description: texto(jornada.titulo, 120), quantity: 1, unit_price: Number(pagamento.valor), currency_id: 'BRL' }],
    payer: { email: usuario.email, identification: { type: documento.length === 11 ? 'CPF' : 'CNPJ', number: documento } },
    external_reference: pagamento.id,
    metadata: { pagamento_id: pagamento.id, mvp_order_id: pedido.id },
    back_urls: { success: volta + '&mp=sucesso', pending: volta + '&mp=pendente', failure: volta + '&mp=falha' },
    statement_descriptor: 'CMKCOGIT'
  };
  if (/^https:\/\//i.test(volta)) preferencia.auto_return = 'approved';
  if (publica) preferencia.notification_url = publica + '/api/mp-webhook?source_news=webhooks';
  const pref = await criarPreferencia(preferencia);
  const link = linkDaPreferencia(pref);
  if (!/^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(\.[a-z]{2})?\//i.test(link || '')) throw new Error('Link de pagamento inesperado');
  await db.atualizar('pagamentos', { id: 'eq.' + pagamento.id }, { link_pagamento: link, mp_preference_id: String(pref.id) });
  return link;
}

// Modo de teste: cria o pedido já "pago" (sem cobrança) e a tela segue direto para a geração.
async function pedirTeste({ db, usuario, corpo }) {
  await limitar(db, usuario.id, 'pedir');
  const j = await projetoDoDono(db, corpo.projeto_id, usuario.id);
  const orc = await db.um('jornada_orcamentos', { select: 'id', jornada_id: 'eq.' + j.id, order: 'created_at.desc' });
  if (!orc) throw new Recusa(409, 'Gere o resumo gratuito do orçamento antes de comprar o documento detalhado.', 'sem_resumo');
  const aberto = await db.um('mvp_budget_orders', { select: '*', project_id: 'eq.' + j.id, status: 'in.(' + ABERTOS.join(',') + ')' });
  if (aberto && aberto.status !== 'pending_payment') return { url: null, teste: true, pedido: pedidoPublico(aberto) };
  if (aberto) await db.atualizar('mvp_budget_orders', { id: 'eq.' + aberto.id }, { status: 'failed', erro: 'substituído pelo modo de teste' });
  const pedido = await db.inserir('mvp_budget_orders', {
    user_id: usuario.id, project_id: j.id, orcamento_id: orc.id, price_brl: 0.01,
    status: 'paid', paid_at: new Date().toISOString(), mp_payment_id: MARCA_TESTE
  });
  return { url: null, teste: true, pedido: pedidoPublico(pedido) };
}

const ACOES = {
  async config({ db }) {
    const c = await configPreco(db);
    return { preco: c.price_brl, credito_dias: c.credit_valid_days, validade_dias: c.validade_orcamento_dias };
  },

  async status({ db, usuario, admin, params }) {
    const j = admin ? await db.um('jornadas', { select: '*', id: 'eq.' + params.get('projeto_id') }) : await projetoDoDono(db, params.get('projeto_id'), usuario.id);
    if (!j) throw new Recusa(404, 'Projeto não encontrado.');
    const [pedido, cfg, orc] = await Promise.all([
      db.um('mvp_budget_orders', { select: '*', project_id: 'eq.' + j.id, order: 'created_at.desc' }),
      configPreco(db),
      db.um('jornada_orcamentos', { select: 'id', jornada_id: 'eq.' + j.id })
    ]);
    return {
      preco: cfg.price_brl, tem_resumo: Boolean(orc), pedido: pedidoPublico(pedido),
      credito: await creditoDoProjeto(db, j.cliente_id, j.id, cfg)
    };
  },

  async pedir({ db, usuario, perfil, req, corpo }) {
    if (perfil.role === 'admin') throw new Recusa(403, 'Administradores não fazem compras pela plataforma.', 'somente_cliente');
    if (emailDeTeste(usuario.email)) return pedirTeste({ db, usuario, corpo });
    const documento = String(perfil.documento || '').replace(/\D/g, '');
    if (!/^(\d{11}|\d{14})$/.test(documento)) {
      throw new Recusa(409, 'Informe seu CPF ou o CNPJ da empresa no seu perfil para continuar com o pagamento.', 'documento_pendente');
    }
    if (!process.env.MP_ACCESS_TOKEN) throw new Error('MP_ACCESS_TOKEN ausente');
    await limitar(db, usuario.id, 'pedir');
    const j = await projetoDoDono(db, corpo.projeto_id, usuario.id);
    const orc = await db.um('jornada_orcamentos', { select: 'id', jornada_id: 'eq.' + j.id, order: 'created_at.desc' });
    if (!orc) throw new Recusa(409, 'Gere o resumo gratuito do orçamento antes de comprar o documento detalhado.', 'sem_resumo');

    let pedido = await db.um('mvp_budget_orders', { select: '*', project_id: 'eq.' + j.id, status: 'in.(' + ABERTOS.join(',') + ')' });
    if (pedido && pedido.status !== 'pending_payment') {
      throw new Recusa(409, 'Este orçamento já foi pago. O documento está sendo preparado.', 'ja_pago', { pedido: pedidoPublico(pedido) });
    }
    let pagamento = pedido && pedido.pagamento_id ? await db.um('pagamentos', { select: '*', id: 'eq.' + pedido.pagamento_id }) : null;
    const cfg = await configPreco(db);

    if (pedido && (!pagamento || pagamento.status !== 'pendente' || Number(pagamento.valor) !== cfg.price_brl)) {
      // cobrança antiga cancelada ou preço mudou: recomeça o pedido
      if (pagamento && pagamento.status === 'pendente') await db.atualizar('pagamentos', { id: 'eq.' + pagamento.id }, { status: 'cancelado', link_pagamento: null });
      // pedido nunca pago: fica como "failed" sem paid_at (o banco nunca libera geração sem paid_at)
      await db.atualizar('mvp_budget_orders', { id: 'eq.' + pedido.id }, { status: 'failed', erro: 'cobrança substituída' });
      pedido = null;
      pagamento = null;
    }
    if (!pedido) {
      pagamento = await db.inserir('pagamentos', {
        cliente_id: usuario.id, descricao: texto('Orçamento detalhado do MVP — ' + j.titulo, 160), valor: cfg.price_brl,
        vencimento: new Date(Date.now() + 3 * dia).toISOString().slice(0, 10)
      });
      try {
        pedido = await db.inserir('mvp_budget_orders', {
          user_id: usuario.id, project_id: j.id, orcamento_id: orc.id, price_brl: cfg.price_brl, pagamento_id: pagamento.id
        });
      } catch (e) {
        await db.atualizar('pagamentos', { id: 'eq.' + pagamento.id }, { status: 'cancelado' }).catch(() => {});
        if (e.status === 409 || e.code === '23505') throw new Recusa(409, 'Já existe um pagamento em andamento para este projeto. Recarregue a página.', 'em_andamento');
        throw e;
      }
    }
    const url = await linkDePagamento({ db, req, usuario, documento, pedido, pagamento, jornada: j });
    return { url, pedido: pedidoPublico(pedido) };
  },

  async gerar({ db, usuario, admin, corpo }) {
    const p = await pedidoDe(db, corpo.pedido_id, usuario.id, admin);
    if (!admin) await limitar(db, usuario.id, 'gerar');
    if (p.status === 'paid' || p.status === 'generating') return { pedido: pedidoPublico(await processarPedido(db, p.id)) };
    return { pedido: pedidoPublico(p) };
  },

  async tentar_novamente({ db, usuario, corpo }) {
    const p = await pedidoDe(db, corpo.pedido_id, usuario.id);
    if (p.status !== 'failed') throw new Recusa(409, 'Este pedido não está com falha.');
    await limitar(db, usuario.id, 'gerar');
    const liberado = await db.rpc('mvp_liberar_tentativa', { p_order: p.id, p_admin: false });
    if (!Array.isArray(liberado) || !liberado.length) throw new Recusa(409, 'A nova tentativa já foi usada. Fale com a equipe para o estorno.', 'sem_tentativas');
    return { pedido: pedidoPublico(await processarPedido(db, p.id)) };
  },

  async pdf({ db, usuario, admin, params }) {
    const p = await pedidoDe(db, params.get('pedido_id'), usuario.id, admin);
    if (p.status !== 'ready' || !p.document_path) throw new Recusa(409, 'O documento ainda não está pronto.');
    const url = await criarStorage().urlAssinada(BUCKET_PDF, p.document_path, 600, 'orcamento-mvp-' + p.id.slice(0, 8) + '.pdf');
    return { url, expira_em: new Date(Date.now() + 600000).toISOString() };
  },

  async construir({ db, usuario, perfil, corpo }) {
    if (perfil.role === 'admin') throw new Recusa(403, 'Administradores não fazem compras pela plataforma.', 'somente_cliente');
    const j = await projetoDoDono(db, corpo.projeto_id, usuario.id);
    const ref = 'jornada-' + j.id;
    const existente = await db.um('solicitacoes', { select: 'id,codigo,status', cliente_id: 'eq.' + usuario.id, ref_site: 'eq.' + ref });
    if (existente) return { nova: false, solicitacao: existente };
    await limitar(db, usuario.id, 'construir');
    const orc = await db.um('jornada_orcamentos', { select: '*', jornada_id: 'eq.' + j.id, order: 'created_at.desc' });
    if (!orc) throw new Recusa(409, 'Gere o resumo do orçamento antes de seguir para a construção.', 'sem_resumo');

    const d = orc.dados || {};
    const cfgSel = { v: 1, ref, origem: 'jornada_mvp', objetivos: [], servicos: [{ id: 'mvp', modelo: null, plano: null }], complementos: [], notas: '', diagnostico: null };
    const catalogo = await db.select('catalogo_precos', { select: '*' });
    const calc = calcular(cfgSel, catalogo);
    const resumo = {
      ...(calc.ok ? calc.resumo : { itens: [{ id: 'mvp', nome: 'MVP e Produto Digital', modelo: null, preco: null, tipo_preco: 'custom' }], complementos: [], mensais: [], total: 0 }),
      jornada: {
        id: j.id, titulo: j.titulo, orcamento_id: orc.id, valor_min: d.valor_min, valor_max: d.valor_max,
        semanas: d.mvp && d.mvp.semanas, funcionalidades: (d.itens || []).filter((i) => i.prioridade === 'essencial').map((i) => i.nome).slice(0, 30)
      }
    };
    const notas = [
      'Projeto da Jornada MVP: ' + j.titulo,
      d.resumo ? 'Resumo: ' + d.resumo : '',
      'Estimativa do resumo: R$ ' + d.valor_min + ' a R$ ' + d.valor_max + (d.mvp && d.mvp.semanas ? ' em ' + d.mvp.semanas + ' semanas' : ''),
      'Funcionalidades essenciais: ' + resumo.jornada.funcionalidades.join(', ')
    ].filter(Boolean).join('\n');
    let nova;
    try {
      nova = await db.inserir('solicitacoes', {
        cliente_id: usuario.id, ref_site: ref, origem: 'jornada_mvp', jornada_id: j.id,
        selecao: { objetivos: [], servicos: cfgSel.servicos, complementos: [] }, resumo, notas: texto(notas, 3000),
        estruturado: false, tipo_preco: 'from', valor_calculado: Number(d.valor_min) || 0, valor_final: null, status: 'em_validacao'
      });
    } catch (e) {
      if (e.status === 409 || e.code === '23505') return { nova: false, solicitacao: await db.um('solicitacoes', { select: 'id,codigo,status', cliente_id: 'eq.' + usuario.id, ref_site: 'eq.' + ref }) };
      throw e;
    }
    const admins = await db.select('profiles', { select: 'id', role: 'eq.admin', limit: '50' });
    await Promise.all(admins.map((a) => createNotification(db, {
      destinatarioId: a.id, tipo: 'solicitacao', titulo: 'Construir com a CMK Cogit: ' + j.titulo,
      mensagem: 'Pedido vindo da Jornada MVP (' + nova.codigo + '). Defina o valor na validação.', link: 'admin.html'
    }).catch((e) => registrarErro('mvp:aviso', e))));
    return { nova: true, solicitacao: { id: nova.id, codigo: nova.codigo, status: nova.status } };
  },

  async admin_pedidos({ db, admin }) {
    if (!admin) throw new Recusa(403, 'Apenas administradores.');
    const pedidos = await db.select('mvp_budget_orders', { select: '*', order: 'created_at.desc', limit: '100' });
    const ids = pedidos.map((p) => p.id);
    const custos = ids.length ? await db.select('mvp_budget_generations', { select: 'order_id,cost_brl', order_id: 'in.(' + ids.join(',') + ')' }) : [];
    const jornadas = ids.length ? await db.select('jornadas', { select: 'id,titulo', id: 'in.(' + [...new Set(pedidos.map((p) => p.project_id))].join(',') + ')' }) : [];
    const titulo = new Map(jornadas.map((j) => [j.id, j.titulo]));
    return {
      pedidos: pedidos.map((p) => ({
        ...pedidoPublico(p), titulo: titulo.get(p.project_id) || '', erro: p.erro, tentativas: p.tentativas,
        custo_brl: custos.filter((c) => c.order_id === p.id).reduce((t, c) => t + Number(c.cost_brl || 0), 0)
      }))
    };
  },

  async admin_reprocessar({ db, admin, corpo }) {
    if (!admin) throw new Recusa(403, 'Apenas administradores.');
    const p = await pedidoDe(db, corpo.pedido_id, null, true);
    if (p.status === 'failed') await db.rpc('mvp_liberar_tentativa', { p_order: p.id, p_admin: true });
    return { pedido: pedidoPublico(await processarPedido(db, p.id)) };
  },

  async admin_estornar({ db, admin, corpo }) {
    if (!admin) throw new Recusa(403, 'Apenas administradores.');
    const p = await pedidoDe(db, corpo.pedido_id, null, true);
    if (!p.mp_payment_id || !['paid', 'failed', 'ready'].includes(p.status)) throw new Recusa(409, 'Este pedido não tem pagamento aprovado para estornar.');
    await estornarPagamentoMp(p.mp_payment_id, 'mvp-estorno-' + p.id);
    // aplica já o que o Mercado Pago diz agora (o webhook "refunded" também chega e é idempotente)
    const mp = await buscarPagamento(p.mp_payment_id);
    if (mp && p.pagamento_id) await aplicarNoBanco(db, p.pagamento_id, mp, 'estorno-admin');
    return { pedido: pedidoPublico(await db.um('mvp_budget_orders', { select: '*', id: 'eq.' + p.id })) };
  }
};

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') return erro(res, 405, 'Método não permitido.');

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('mvp:config', e); return erro(res, 500, 'Indisponível no momento.'); }

  const params = new URL(req.url || '/', 'http://x').searchParams;
  let corpo = {};
  if (req.method === 'POST') {
    try { corpo = (await lerCorpo(req, 4000)) || {}; } catch { return erro(res, 400, 'Requisição inválida.'); }
  }
  const nome = String(params.get('acao') || corpo.acao || '');
  const acao = Object.hasOwn(ACOES, nome) ? ACOES[nome] : null;
  if (!acao) return erro(res, 400, 'Ação inválida.');
  const soLeitura = ['config', 'status', 'pdf', 'admin_pedidos'].includes(nome);
  if (soLeitura !== (req.method === 'GET')) return erro(res, 405, 'Método não permitido.');

  const usuario = await exigirUsuario(req, res, db);
  if (!usuario) return;
  const perfil = await exigirCadastroCompleto(usuario, res, db);
  if (!perfil) return;

  try {
    const r = await acao({ db, usuario, perfil, admin: perfil.role === 'admin', req, params, corpo });
    return json(res, 200, { ok: true, ...r });
  } catch (e) {
    if (e instanceof Recusa) return json(res, e.status, { ok: false, codigo: e.codigo, erro: e.message, ...e.extra });
    registrarErro('mvp:' + nome, e);
    return erro(res, nome === 'pedir' ? 502 : 500, nome === 'pedir' ? 'Não foi possível abrir o pagamento agora. Tente novamente em instantes.' : 'Não foi possível concluir agora. Tente novamente.');
  }
}
