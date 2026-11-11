// POST /api/checkout   (cliente logado)
// Corpo: { solicitacao_id }  ou  { pagamento_id }
// Cria (ou reaproveita) a cobrança e a preferência do Mercado Pago e devolve o
// link de pagamento. O VALOR SEMPRE vem do banco, nunca do navegador.
import { criarDb } from '../lib/supabase.js';
import { json, erro, lerCorpo, exigirUsuario, exigirCadastroCompleto, registrarErro, UUID, urlApp, urlPublica } from '../lib/http.js';
import { criarPreferencia, linkDaPreferencia } from '../lib/mercadopago.js';
import { texto } from '../lib/selecao.js';
import { creditoDoProjeto } from '../lib/mvp-rota.js';
import { configPreco } from '../lib/mvp-geracao.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return erro(res, 405, 'Método não permitido.');

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('checkout:config', e); return erro(res, 500, 'Pagamento indisponível no momento.'); }
  if (!process.env.MP_ACCESS_TOKEN) { registrarErro('checkout', 'MP_ACCESS_TOKEN ausente'); return erro(res, 500, 'Pagamento indisponível no momento.'); }

  const usuario = await exigirUsuario(req, res, db);
  if (!usuario) return;
  const perfil = await exigirCadastroCompleto(usuario, res, db, { somenteCliente: true });
  if (!perfil) return;
  // CPF/CNPJ do contratante é obrigatório para pagar (contas antigas informam em Meu perfil)
  const documento = String(perfil.documento || '').replace(/\D/g, '');
  if (!/^(\d{11}|\d{14})$/.test(documento)) {
    return json(res, 409, { ok: false, codigo: 'documento_pendente', erro: 'Informe seu CPF ou o CNPJ da empresa em Meu perfil para continuar com o pagamento.' });
  }

  let corpo;
  try { corpo = await lerCorpo(req, 2000); } catch { return erro(res, 400, 'Requisição inválida.'); }

  try {
    let pag = null;

    if (typeof corpo.solicitacao_id === 'string' && UUID.test(corpo.solicitacao_id)) {
      const s = await db.um('solicitacoes', { select: '*', id: 'eq.' + corpo.solicitacao_id, cliente_id: 'eq.' + usuario.id });
      if (!s) return erro(res, 404, 'Solicitação não encontrada.');
      if (s.status !== 'aguardando_pagamento' || !(Number(s.valor_final) > 0)) {
        return erro(res, 409, 'Esta solicitação ainda não está liberada para pagamento.');
      }
      pag = await cobrancaDaSolicitacao(db, s, usuario.id);
    } else if (typeof corpo.pagamento_id === 'string' && UUID.test(corpo.pagamento_id)) {
      pag = await db.um('pagamentos', { select: '*', id: 'eq.' + corpo.pagamento_id, cliente_id: 'eq.' + usuario.id });
      if (!pag || pag.status !== 'pendente') return erro(res, 404, 'Cobrança não encontrada ou já paga.');
      if (pag.solicitacao_id) {
        const s = await db.um('solicitacoes', { select: 'status', id: 'eq.' + pag.solicitacao_id });
        if (!s || s.status !== 'aguardando_pagamento') return erro(res, 409, 'Esta cobrança não está mais disponível.');
      }
    } else {
      return erro(res, 400, 'Informe a solicitação ou a cobrança.');
    }

    // link já criado para este valor: reaproveita
    if (pag.link_pagamento && pag.mp_preference_id) {
      return json(res, 200, { ok: true, url: pag.link_pagamento, pagamento_id: pag.id });
    }

    const app = urlApp();
    const https = /^https:\/\//i.test(app);
    const publica = urlPublica();
    const preferencia = {
      items: [{
        id: pag.id,
        title: texto(pag.descricao, 120) || 'Projeto CMKCOGIT',
        quantity: 1,
        unit_price: Number(pag.valor),
        currency_id: 'BRL'
      }],
      payer: { email: usuario.email, identification: { type: documento.length === 11 ? 'CPF' : 'CNPJ', number: documento } },
      external_reference: pag.id,
      metadata: { pagamento_id: pag.id },
      back_urls: {
        success: app + '/pagamentos.html?mp=sucesso',
        pending: app + '/pagamentos.html?mp=pendente',
        failure: app + '/pagamentos.html?mp=falha'
      },
      statement_descriptor: 'CMKCOGIT'
    };
    // o Mercado Pago só volta sozinho para endereços https (em localhost use o botão "Voltar")
    if (https) preferencia.auto_return = 'approved';
    // webhook: só funciona com endereço público https (produção ou túnel)
    if (publica) preferencia.notification_url = publica + '/api/mp-webhook?source_news=webhooks';

    const pref = await criarPreferencia(preferencia);
    const link = linkDaPreferencia(pref);
    if (!/^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(\.[a-z]{2})?\//i.test(link || '')) {
      throw new Error('Link de pagamento inesperado');
    }

    await db.atualizar('pagamentos', { id: 'eq.' + pag.id }, { link_pagamento: link, mp_preference_id: String(pref.id) });
    return json(res, 200, { ok: true, url: link, pagamento_id: pag.id });
  } catch (e) {
    registrarErro('checkout', e);
    return erro(res, 502, 'Não foi possível abrir o pagamento agora. Tente novamente em instantes.');
  }
}

// Crédito do orçamento detalhado do MVP (sql/31): quem pagou o documento e contrata a construção
// do MESMO projeto dentro de credit_valid_days tem o valor abatido. O crédito só é consumido quando
// esta cobrança for paga (aplicar_pagamento_mp) e volta se ela for estornada.
async function creditoDaSolicitacao(db, s, clienteId) {
  if (s.origem !== 'jornada_mvp' || !s.jornada_id) return { valor: 0, pedido_id: null };
  const c = await creditoDoProjeto(db, clienteId, s.jornada_id, await configPreco(db)).catch((e) => { registrarErro('checkout:credito', e); return null; });
  if (!c) return { valor: 0, pedido_id: null };
  // nunca zera a cobrança (o Mercado Pago não cobra R$ 0)
  return { valor: Math.min(c.valor, Math.max(Number(s.valor_final) - 1, 0)), pedido_id: c.pedido_id };
}

async function cobrancaDaSolicitacao(db, s, clienteId) {
  const filtro = { select: '*', solicitacao_id: 'eq.' + s.id, status: 'eq.pendente' };
  let pag = await db.um('pagamentos', filtro);
  const credito = await creditoDaSolicitacao(db, s, clienteId);
  const valor = Math.round((Number(s.valor_final) - credito.valor) * 100) / 100;
  const camposCredito = { credito_mvp: credito.valor, credito_order_id: credito.pedido_id };

  if (pag) {
    if (Number(pag.valor) !== valor || (pag.credito_order_id || null) !== credito.pedido_id) {
      // admin mudou o valor (ou o crédito mudou): atualiza e descarta o link antigo
      pag = await db.atualizar('pagamentos', { id: 'eq.' + pag.id }, {
        valor, ...camposCredito, link_pagamento: null, mp_preference_id: null
      });
    }
    return pag;
  }

  const titulo = (s.resumo && s.resumo.itens && s.resumo.itens[0] && s.resumo.itens[0].nome) || 'Projeto';
  const vencimento = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
  try {
    return await db.inserir('pagamentos', {
      cliente_id: clienteId,
      solicitacao_id: s.id,
      descricao: texto(s.codigo + ' — ' + titulo + (credito.valor ? ' (crédito do orçamento: R$ ' + credito.valor.toFixed(2).replace('.', ',') + ')' : ''), 160),
      valor,
      ...camposCredito,
      vencimento
    });
  } catch (e) {
    // dois cliques ao mesmo tempo: o índice único deixou só um passar
    if (e.status === 409 || e.code === '23505') return db.um('pagamentos', filtro);
    throw e;
  }
}
