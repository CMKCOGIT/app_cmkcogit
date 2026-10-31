// Integração com o Mercado Pago (Checkout Pro) via API REST, sem SDK.
// Documentação: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro
import crypto from 'node:crypto';
import { notificarCompraOferta } from './notificacoes.js';

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
// Pagamento confirmado agora: avisa a compra de oferta (regras em lib/notificacoes.config.js).
export async function aplicarNoBanco(db, pagamentoId, mp, origem) {
  const resultado = await db.rpc('aplicar_pagamento_mp', {
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
  if (resultado === 'pago') await notificarCompraOferta(db, pagamentoId);
  return resultado;
}

// ---------------------------------------------------------------------
// Renovação automática no cartão: assinatura do Mercado Pago sem plano
// associado (POST /preapproval, status "pending"). O cliente cadastra o
// cartão no link (init_point); depois o Mercado Pago cobra sozinho.
// https://www.mercadopago.com.br/developers/pt/docs/subscriptions
// ---------------------------------------------------------------------
export async function criarAssinaturaMp({ referencia, motivo, email, valor, plano, inicio, voltarPara }, env = process.env) {
  const corpo = {
    reason: String(motivo).slice(0, 120),
    external_reference: referencia,
    payer_email: email,
    auto_recurring: {
      frequency: plano === 'anual' ? 12 : 1,
      frequency_type: 'months',
      start_date: inicio.toISOString(),
      transaction_amount: Number(valor),
      currency_id: 'BRL'
    },
    back_url: voltarPara,
    status: 'pending'
  };
  const r = await chamar('/preapproval', { method: 'POST', body: corpo, env, idempotencia: 'cmk-pre-' + referencia + '-' + inicio.toISOString().slice(0, 10) });
  if (!r.ok || !r.dados.id) {
    const e = new Error('Mercado Pago recusou a assinatura (' + r.status + '): ' + (r.dados.message || ''));
    e.status = r.status;
    throw e;
  }
  return r.dados;
}

export async function buscarAssinaturaMp(id, env = process.env) {
  const r = await chamar('/preapproval/' + encodeURIComponent(id), { env });
  if (!r.ok) {
    const e = new Error('Assinatura não encontrada no Mercado Pago (' + r.status + ')');
    e.status = r.status;
    throw e;
  }
  return r.dados;
}

export async function cancelarAssinaturaMp(id, env = process.env) {
  const r = await chamar('/preapproval/' + encodeURIComponent(id), { method: 'PUT', body: { status: 'cancelled' }, env });
  // já cancelada lá também serve
  if (!r.ok && r.status !== 404) throw new Error('Não foi possível cancelar no Mercado Pago (' + r.status + ')');
  return r.dados;
}

// Estado que importa da assinatura: status e quantas cobranças o cartão já pagou
export function estadoAssinaturaMp(pre) {
  const p = pre && typeof pre === 'object' ? pre : {};
  const resumo = p.summarized && typeof p.summarized === 'object' ? p.summarized : {};
  const num = (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null);
  const cobrancas = num(resumo.charged_quantity) ?? num(p.charged_quantity);
  const ultima = resumo.last_charged_date || p.last_charged_date || null;
  return {
    status: ['pending', 'authorized', 'paused', 'cancelled'].includes(p.status) ? p.status : 'pending',
    cobrancas,
    ultimaCobranca: ultima && !Number.isNaN(Date.parse(ultima)) ? new Date(ultima).toISOString() : null
  };
}
