// POST /api/checkout   (cliente logado)
// Corpo: { solicitacao_id }  ou  { pagamento_id }
// Cria (ou reaproveita) a cobrança e a preferência do Mercado Pago e devolve o
// link de pagamento. O VALOR SEMPRE vem do banco, nunca do navegador.
import { criarDb } from '../lib/supabase.js';
import { json, erro, lerCorpo, exigirUsuario, exigirCadastroCompleto, registrarErro, UUID, urlApp, urlPublica } from '../lib/http.js';
import { criarPreferencia, linkDaPreferencia } from '../lib/mercadopago.js';
import { texto } from '../lib/selecao.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return erro(res, 405, 'Método não permitido.');

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('checkout:config', e); return erro(res, 500, 'Pagamento indisponível no momento.'); }
  if (!process.env.MP_ACCESS_TOKEN) { registrarErro('checkout', 'MP_ACCESS_TOKEN ausente'); return erro(res, 500, 'Pagamento indisponível no momento.'); }

  const usuario = await exigirUsuario(req, res, db);
  if (!usuario) return;
  if (!(await exigirCadastroCompleto(usuario, res, db))) return;

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
        title: texto(pag.descricao, 120) || 'Projeto CMK COGIT',
        quantity: 1,
        unit_price: Number(pag.valor),
        currency_id: 'BRL'
      }],
      payer: { email: usuario.email },
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

async function cobrancaDaSolicitacao(db, s, clienteId) {
  const filtro = { select: '*', solicitacao_id: 'eq.' + s.id, status: 'eq.pendente' };
  let pag = await db.um('pagamentos', filtro);

  if (pag) {
    if (Number(pag.valor) !== Number(s.valor_final)) {
      // admin mudou o valor: atualiza e descarta o link antigo
      pag = await db.atualizar('pagamentos', { id: 'eq.' + pag.id }, {
        valor: s.valor_final, link_pagamento: null, mp_preference_id: null
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
      descricao: texto(s.codigo + ' — ' + titulo, 160),
      valor: s.valor_final,
      vencimento
    });
  } catch (e) {
    // dois cliques ao mesmo tempo: o índice único deixou só um passar
    if (e.status === 409 || e.code === '23505') return db.um('pagamentos', filtro);
    throw e;
  }
}
