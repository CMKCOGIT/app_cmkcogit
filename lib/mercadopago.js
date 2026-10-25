// Integração com o Mercado Pago (Checkout Pro) via API REST, sem SDK.
// Documentação: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro
import crypto from 'node:crypto';

const API = 'https://api.mercadopago.com';

function tokenMp(env = process.env) {
  const t = env.MP_ACCESS_TOKEN;
  if (!t) throw new Error('MP_ACCESS_TOKEN não configurado.');
  return t;
}

async function chamar(caminho, { method = 'GET', body, env, idempotencia } = {}) {
  const headers = { Authorization: 'Bearer ' + tokenMp(env), Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencia) headers['X-Idempotency-Key'] = idempotencia;
  const r = await fetch(API + caminho, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const dados = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, dados };
}

export async function criarPreferencia(preferencia, env = process.env) {
  const r = await chamar('/checkout/preferences', { method: 'POST', body: preferencia, env });
  if (!r.ok || !r.dados.id) {
    const e = new Error('Mercado Pago recusou a preferência (' + r.status + '): ' + (r.dados.message || ''));
    e.status = r.status;
    throw e;
  }
  return r.dados;
}

// Com as credenciais de produção da CONTA DE TESTE (recomendado pelo Mercado Pago)
// o link é o init_point normal. Credenciais antigas "TEST-..." usam o sandbox_init_point.
export function linkDaPreferencia(pref, env = process.env) {
  const teste = String(env.MP_ACCESS_TOKEN || '').startsWith('TEST-');
  return teste ? pref.sandbox_init_point || pref.init_point : pref.init_point;
}

export async function buscarPagamento(id, env = process.env) {
  if (!/^\d{1,30}$/.test(String(id))) return null;
  const r = await chamar('/v1/payments/' + id, { env });
  if (r.status === 404) return null;
  if (!r.ok) {
    const e = new Error('Mercado Pago indisponível (' + r.status + ')');
    e.status = r.status;
    throw e;
  }
  return r.dados;
}

// Todos os pagamentos do Mercado Pago ligados a uma cobrança nossa (external_reference = pagamentos.id)
export async function buscarPorReferencia(ref, env = process.env) {
  const q = new URLSearchParams({ external_reference: ref, sort: 'date_created', criteria: 'desc', limit: '20' });
  const r = await chamar('/v1/payments/search?' + q, { env });
  if (!r.ok) {
    const e = new Error('Mercado Pago indisponível (' + r.status + ')');
    e.status = r.status;
    throw e;
  }
  return Array.isArray(r.dados.results) ? r.dados.results : [];
}

// Escolhe, entre várias tentativas, a que importa: aprovada > estornada > mais recente
export function tentativaRelevante(lista) {
  if (!lista.length) return null;
  return lista.find((p) => p.status === 'approved')
    || lista.find((p) => p.status === 'refunded' || p.status === 'charged_back')
    || lista[0];
}

export function metodoDe(p) {
  if (p.payment_method_id === 'pix') return 'pix';
  switch (p.payment_type_id) {
    case 'credit_card': case 'debit_card': case 'prepaid_card': return 'cartao';
    case 'ticket': return 'boleto';
    case 'bank_transfer': return 'pix';
    default: return 'outro';
  }
}

// Valida o cabeçalho x-signature do webhook.
// Modelo do Mercado Pago: "id:[data.id];request-id:[x-request-id];ts:[ts];" (HMAC-SHA256, hex)
export function assinaturaValida({ segredo, xSignature, xRequestId, dataId }) {
  if (!segredo || !xSignature) return false;
  const partes = {};
  for (const p of String(xSignature).split(',')) {
    const i = p.indexOf('=');
    if (i > 0) partes[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId || '') ? String(dataId).toLowerCase() : dataId;
  let manifesto = '';
  if (id) manifesto += 'id:' + id + ';';
  if (xRequestId) manifesto += 'request-id:' + xRequestId + ';';
  manifesto += 'ts:' + partes.ts + ';';
  const esperado = crypto.createHmac('sha256', segredo).update(manifesto).digest('hex');
  const a = Buffer.from(esperado);
  const b = Buffer.from(String(partes.v1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Leva o resultado consultado no Mercado Pago para o banco (função SQL aplicar_pagamento_mp).
export async function aplicarNoBanco(db, pagamentoId, mp, origem) {
  return db.rpc('aplicar_pagamento_mp', {
    p_pagamento_id: pagamentoId,
    p_mp_payment_id: String(mp.id),
    p_status: String(mp.status || ''),
    p_status_detalhe: mp.status_detail ? String(mp.status_detail).slice(0, 120) : null,
    p_metodo: metodoDe(mp),
    p_valor: mp.transaction_amount == null ? null : Number(mp.transaction_amount),
    p_moeda: mp.currency_id || null,
    p_pago_em: mp.date_approved || null,
    p_origem: origem
  });
}
