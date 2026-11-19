import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarAmbiente } from '../lib/ambiente.js';

test('preview da Vercel usa o token de TESTE do Mercado Pago e a URL do próprio preview', () => {
  const env = aplicarAmbiente({ VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'app-git-teste.vercel.app', MP_ACCESS_TOKEN: 'APP_USR-producao', MP_ACCESS_TOKEN_TESTE: 'APP_USR-teste', MP_WEBHOOK_SECRET: 'prod', APP_URL: 'https://app.cmkcogit.com.br' });
  assert.equal(env.MP_ACCESS_TOKEN, 'APP_USR-teste');
  assert.equal(env.MP_WEBHOOK_SECRET, '');
  assert.equal(env.APP_URL, 'https://app-git-teste.vercel.app');
  assert.equal(env.PUBLIC_URL, 'https://app-git-teste.vercel.app');
});

test('preview sem token de teste NUNCA usa o de produção (pagamento fica indisponível)', () => {
  const env = aplicarAmbiente({ VERCEL_ENV: 'preview', MP_ACCESS_TOKEN: 'APP_USR-producao' });
  assert.equal(env.MP_ACCESS_TOKEN, '');
});

test('produção e computador local não mudam', () => {
  const prod = aplicarAmbiente({ VERCEL_ENV: 'production', MP_ACCESS_TOKEN: 'APP_USR-producao', MP_ACCESS_TOKEN_TESTE: 'x', APP_URL: 'https://app.cmkcogit.com.br' });
  assert.equal(prod.MP_ACCESS_TOKEN, 'APP_USR-producao');
  assert.equal(prod.APP_URL, 'https://app.cmkcogit.com.br');
  assert.equal(aplicarAmbiente({ MP_ACCESS_TOKEN: 'APP_USR-local' }).MP_ACCESS_TOKEN, 'APP_USR-local');
});
