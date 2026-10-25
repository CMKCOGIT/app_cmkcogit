import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { assinaturaValida, metodoDe, tentativaRelevante, linkDaPreferencia } from '../lib/mercadopago.js';

function assinar(segredo, id, requestId, ts) {
  const manifesto = `id:${id};request-id:${requestId};ts:${ts};`;
  return `ts=${ts},v1=${crypto.createHmac('sha256', segredo).update(manifesto).digest('hex')}`;
}

test('assinatura do webhook (modelo id;request-id;ts) é validada', () => {
  const xSignature = assinar('segredo', '123456', 'req-1', '1700000000');
  assert.equal(assinaturaValida({ segredo: 'segredo', xSignature, xRequestId: 'req-1', dataId: '123456' }), true);
  assert.equal(assinaturaValida({ segredo: 'outro', xSignature, xRequestId: 'req-1', dataId: '123456' }), false);
  assert.equal(assinaturaValida({ segredo: 'segredo', xSignature, xRequestId: 'req-1', dataId: '999' }), false);
  assert.equal(assinaturaValida({ segredo: 'segredo', xSignature: 'ts=1', xRequestId: 'req-1', dataId: '123456' }), false);
});

test('método de pagamento', () => {
  assert.equal(metodoDe({ payment_method_id: 'pix', payment_type_id: 'bank_transfer' }), 'pix');
  assert.equal(metodoDe({ payment_type_id: 'credit_card' }), 'cartao');
  assert.equal(metodoDe({ payment_type_id: 'ticket' }), 'boleto');
  assert.equal(metodoDe({ payment_type_id: 'account_money' }), 'outro');
});

test('entre várias tentativas, vale a aprovada', () => {
  const lista = [{ id: 3, status: 'rejected' }, { id: 2, status: 'approved' }, { id: 1, status: 'pending' }];
  assert.equal(tentativaRelevante(lista).id, 2);
  assert.equal(tentativaRelevante([{ id: 9, status: 'pending' }]).id, 9);
  assert.equal(tentativaRelevante([]), null);
});

test('link: conta de teste usa init_point; credencial TEST- usa sandbox', () => {
  const pref = { init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=1', sandbox_init_point: 'https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=1' };
  assert.equal(linkDaPreferencia(pref, { MP_ACCESS_TOKEN: 'APP_USR-123' }), pref.init_point);
  assert.equal(linkDaPreferencia(pref, { MP_ACCESS_TOKEN: 'TEST-123' }), pref.sandbox_init_point);
});
