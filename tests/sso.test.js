// Login único app <-> mvp sem cookie compartilhado: /api/sso emite um código de uso único
// (generate_link do Supabase) SÓ para os destinos do ambiente. Supabase simulado.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const SUPA = 'https://teste.supabase.co';
Object.assign(process.env, { SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'service', APP_URL: 'https://app.cmkcogit.com.br', MVP_ORIGENS: 'https://mvp.cmkcogit.com.br' });
delete process.env.MVP_URL;
const { default: handler } = await import('../api/notificacoes.js');
const { caminhoSeguro, urlMvp } = await import('../lib/sso.js');

let pedidosLink, limite;
beforeEach(() => { pedidosLink = []; limite = true; });
globalThis.fetch = async (url, op = {}) => {
  const u = new URL(url);
  const ok = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
  if (u.pathname === '/auth/v1/user') {
    return (op.headers.Authorization || '') === 'Bearer tok-ana' ? ok({ id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'ana@ex.com' }) : ok({}, 401);
  }
  if (u.pathname === '/auth/v1/admin/generate_link') {
    assert.equal(op.headers.Authorization, 'Bearer service'); // só o servidor, com a service_role
    pedidosLink.push(JSON.parse(op.body));
    return ok({ id: 'u1', email: 'ana@ex.com', properties: { hashed_token: 'hash-123', action_link: 'https://x' } });
  }
  if (u.pathname === '/rest/v1/rpc/consumir_limite') return ok(limite);
  throw new Error('não simulado: ' + url);
};

async function chamar(corpo, { token = 'tok-ana', origin, method = 'POST' } = {}) {
  const req = { method, url: '/api/notificacoes?rota=sso', query: { rota: 'sso' }, headers: { authorization: 'Bearer ' + token, ...(origin ? { origin } : {}) }, body: corpo };
  const res = { statusCode: 200, cab: {}, setHeader(k, v) { this.cab[k.toLowerCase()] = v; }, end(t) { this.texto = t; } };
  await handler(req, res);
  return { status: res.statusCode, cab: res.cab, ...(res.texto ? JSON.parse(res.texto) : {}) };
}

test('logado: código de uso único para o mvp, no fragmento (#), com caminho de volta', async () => {
  const r = await chamar({ para: 'mvp', volta: '/projeto.html?id=abc' });
  assert.equal(r.status, 200);
  assert.equal(r.url, 'https://mvp.cmkcogit.com.br/sso.html#token_hash=hash-123&volta=%2Fprojeto.html%3Fid%3Dabc');
  assert.deepEqual(pedidosLink, [{ type: 'magiclink', email: 'ana@ex.com' }]); // o e-mail vem do token, nunca do corpo
});

test('o mvp pede para o app (CORS só da origem do mvp)', async () => {
  const r = await chamar({ para: 'app', volta: '/inicio.html' }, { origin: 'https://mvp.cmkcogit.com.br' });
  assert.match(r.url, /^https:\/\/app\.cmkcogit\.com\.br\/sso\.html#token_hash=hash-123/);
  assert.equal(r.cab['access-control-allow-origin'], 'https://mvp.cmkcogit.com.br');
  const outro = await chamar({ para: 'app' }, { origin: 'https://artenos.cmkcogit.com.br' });
  assert.equal(outro.cab['access-control-allow-origin'], undefined); // outro subdomínio não usa a rota pelo navegador
});

test('destino só do ambiente: nada de URL vinda do navegador', async () => {
  for (const para of ['https://evil.example', 'artenos', '', undefined, '__proto__']) {
    assert.equal((await chamar({ para, volta: '/' })).status, 400, String(para));
  }
  assert.equal(pedidosLink.length, 0);
});

test('volta perigosa vira "/" (sem domínio, sem //, sem javascript:)', async () => {
  for (const v of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '/\\evil', '/a b']) assert.equal(caminhoSeguro(v), '/', v);
  assert.equal(caminhoSeguro('/projeto/11111111-0000-4000-8000-000000000001'), '/projeto/11111111-0000-4000-8000-000000000001');
  const r = await chamar({ para: 'mvp', volta: '//evil.example/x' });
  assert.match(r.url, /&volta=%2F$/);
});

test('sem login: 401; GET diz se o login único está ligado; limite por usuário: 429', async () => {
  assert.equal((await chamar({ para: 'mvp' }, { token: 'roubado' })).status, 401);
  assert.equal((await chamar(null, { method: 'PUT' })).status, 405);
  const disp = await chamar(null, { method: 'GET', origin: 'https://mvp.cmkcogit.com.br' });
  assert.deepEqual([disp.status, disp.disponivel, disp.cab['access-control-allow-origin']], [200, true, 'https://mvp.cmkcogit.com.br']);
  limite = false;
  assert.equal((await chamar({ para: 'mvp' })).status, 429);
  assert.equal(pedidosLink.length, 0);
});

test('fora da produção, sem MVP_URL não há login único (nunca manda para o mvp de produção)', () => {
  assert.equal(urlMvp({ APP_URL: 'http://localhost:3000' }), '');
  assert.equal(urlMvp({ APP_URL: 'http://localhost:3000', MVP_URL: 'http://localhost:3001/' }), 'http://localhost:3001');
  assert.equal(urlMvp({ APP_URL: 'https://app.cmkcogit.com.br' }), 'https://mvp.cmkcogit.com.br');
});
