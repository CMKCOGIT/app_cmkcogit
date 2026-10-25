// POST /api/verificar-pagamento   (cliente logado ou admin)
// Corpo: { pagamento_id, payment_id? }
// Consulta o pagamento DIRETO na API do Mercado Pago e aplica no banco.
// É chamado quando o cliente volta do checkout e pelo botão "Já paguei — verificar".
// Funciona mesmo sem webhook (ex.: testando no seu computador, sem endereço público).
import { criarDb } from '../lib/supabase.js';
import { json, erro, lerCorpo, exigirUsuario, registrarErro, UUID } from '../lib/http.js';
import { buscarPagamento, buscarPorReferencia, tentativaRelevante, aplicarNoBanco } from '../lib/mercadopago.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return erro(res, 405, 'Método não permitido.');

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('verificar:config', e); return erro(res, 500, 'Indisponível no momento.'); }
  if (!process.env.MP_ACCESS_TOKEN) return erro(res, 500, 'Pagamento indisponível no momento.');

  const usuario = await exigirUsuario(req, res, db);
  if (!usuario) return;

  let corpo;
  try { corpo = await lerCorpo(req, 2000); } catch { return erro(res, 400, 'Requisição inválida.'); }
  if (typeof corpo.pagamento_id !== 'string' || !UUID.test(corpo.pagamento_id)) return erro(res, 400, 'Cobrança inválida.');

  try {
    const pag = await db.um('pagamentos', { select: 'id,cliente_id,status', id: 'eq.' + corpo.pagamento_id });
    if (!pag) return erro(res, 404, 'Cobrança não encontrada.');
    if (pag.cliente_id !== usuario.id) {
      const perfil = await db.um('profiles', { select: 'role', id: 'eq.' + usuario.id });
      if (!perfil || perfil.role !== 'admin') return erro(res, 404, 'Cobrança não encontrada.');
    }

    let mp = null;
    const paymentId = corpo.payment_id == null ? '' : String(corpo.payment_id);
    if (/^\d{1,30}$/.test(paymentId)) {
      mp = await buscarPagamento(paymentId);
      if (mp && String(mp.external_reference) !== pag.id) mp = null; // pagamento de outra cobrança: ignora
    }
    if (!mp) mp = tentativaRelevante(await buscarPorReferencia(pag.id));

    if (!mp) return json(res, 200, { ok: true, status: pag.status, mp_status: null, resultado: 'nenhum_pagamento_encontrado' });

    const resultado = await aplicarNoBanco(db, pag.id, mp, corpo.payment_id ? 'retorno' : 'verificacao');
    const atual = await db.um('pagamentos', { select: 'status,mp_ultimo_status', id: 'eq.' + pag.id });
    return json(res, 200, {
      ok: true,
      status: atual ? atual.status : pag.status,
      mp_status: mp.status,
      mp_status_detalhe: mp.status_detail || null,
      resultado
    });
  } catch (e) {
    registrarErro('verificar-pagamento', e);
    return erro(res, 502, 'Não foi possível consultar o Mercado Pago agora. Tente novamente em instantes.');
  }
}
