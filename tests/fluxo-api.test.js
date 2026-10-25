// Fluxo completo das rotas /api com Supabase e Mercado Pago SIMULADOS (sem internet):
// site -> solicitação -> checkout -> pagamento aprovado -> confirmação (verificação e webhook).
// A regra de confirmação real está no SQL (07_aplicar_pagamento_mp.sql); aqui ela é
// imitada de forma simples só para exercitar as rotas.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const SUPA = 'https://teste.supabase.co';
Object.assign(process.env, {
  SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon',
  MP_ACCESS_TOKEN: 'APP_USR-teste', MP_WEBHOOK_SECRET: 'segredo', APP_URL: 'https://app.cmkcogit.com.br'
});

const catalogo = JSON.parse(fs.readFileSync(new URL('./catalogo.fixture.json', import.meta.url)));
const USUARIOS = { 'tok-ana': { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'ana@ex.com' },
                   'tok-bia': { id: 'bbbbbbbb-0000-4000-8000-000000000002', email: 'bia@ex.com' } };
let banco, mp, seq;

beforeEach(() => {
  banco = { solicitacoes: [], pagamentos: [], projetos: [], profiles: [], catalogo_precos: catalogo, pagamento_eventos: [] };
  mp = { prefs: [], pagamentos: [] };
  seq = 0;
});

const uuid = () => crypto.randomUUID();
function resposta(status, corpo) {
  return new Response(corpo === undefined ? '' : JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}
function filtrar(linhas, params) {
  let r = linhas.filter((l) => [...params].every(([k, v]) => {
    if (['select', 'limit', 'order'].includes(k)) return true;
    const [op, ...resto] = v.split('.');
    const val = resto.join('.');
    if (op === 'eq') return String(l[k]) === val;
    if (op === 'gte') return String(l[k]) >= val;
    throw new Error('operador não simulado: ' + op);
  }));
  if (params.get('limit')) r = r.slice(0, Number(params.get('limit')));
  return r;
}

// Imita aplicar_pagamento_mp (simplificado)
function aplicar(a) {
  const pg = banco.pagamentos.find((p) => p.id === a.p_pagamento_id);
  if (!pg) return 'pagamento_inexistente';
  let res = 'sem_alteracao';
  if (a.p_status === 'approved') {
    if (a.p_moeda !== 'BRL' || Number(a.p_valor) !== Number(pg.valor)) res = 'valor_divergente';
    else if (pg.status === 'pago') res = pg.mp_payment_id === a.p_mp_payment_id ? 'ja_processado' : 'pago_em_duplicidade';
    else {
      Object.assign(pg, { status: 'pago', mp_payment_id: a.p_mp_payment_id, metodo: a.p_metodo });
      const s = banco.solicitacoes.find((x) => x.id === pg.solicitacao_id);
      if (s && !s.projeto_id) {
        const proj = { id: uuid(), cliente_id: s.cliente_id, solicitacao_id: s.id };
        banco.projetos.push(proj);
        Object.assign(s, { status: 'paga', projeto_id: proj.id });
        pg.projeto_id = proj.id;
      }
      res = 'pago';
    }
  } else if (pg.status === 'pendente') pg.mp_ultimo_status = a.p_status;
  banco.pagamento_eventos.push({ origem: a.p_origem, resultado: res });
  return res;
}

globalThis.fetch = async (url, op = {}) => {
  const u = new URL(url);
  const metodo = op.method || 'GET';
  const corpo = op.body ? JSON.parse(op.body) : undefined;

  if (u.origin === SUPA) {
    if (u.pathname === '/auth/v1/user') {
      const tok = (op.headers.Authorization || '').replace('Bearer ', '');
      return USUARIOS[tok] ? resposta(200, USUARIOS[tok]) : resposta(401, { msg: 'invalid' });
    }
    if (u.pathname === '/rest/v1/rpc/aplicar_pagamento_mp') return resposta(200, aplicar(corpo));
    const tabela = u.pathname.replace('/rest/v1/', '');
    const linhas = banco[tabela];
    if (metodo === 'GET') return resposta(200, filtrar(linhas, u.searchParams));
    if (metodo === 'POST') {
      if (tabela === 'solicitacoes' && linhas.some((l) => l.cliente_id === corpo.cliente_id && l.ref_site === corpo.ref_site)) return resposta(409, { code: '23505' });
      if (tabela === 'pagamentos' && linhas.some((l) => l.solicitacao_id === corpo.solicitacao_id && l.status === 'pendente')) return resposta(409, { code: '23505' });
      const nova = { id: uuid(), status: 'pendente', created_at: new Date().toISOString(), ...corpo };
      if (tabela === 'solicitacoes') nova.codigo = 'SOL-' + String(++seq).padStart(5, '0');
      linhas.push(nova);
      return resposta(201, [nova]);
    }
    if (metodo === 'PATCH') {
      const alvo = filtrar(linhas, u.searchParams);
      alvo.forEach((l) => Object.assign(l, corpo));
      return resposta(200, alvo);
    }
  }

  if (u.origin === 'https://api.mercadopago.com') {
    assert.equal(op.headers.Authorization, 'Bearer APP_USR-teste');
    if (u.pathname === '/checkout/preferences') {
      const id = 'pref-' + (mp.prefs.length + 1);
      mp.prefs.push({ id, ...corpo });
      return resposta(201, { id, init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=' + id });
    }
    if (u.pathname === '/v1/payments/search') {
      return resposta(200, { results: mp.pagamentos.filter((p) => p.external_reference === u.searchParams.get('external_reference')).reverse() });
    }
    const m = /^\/v1\/payments\/(\d+)$/.exec(u.pathname);
    if (m) {
      const p = mp.pagamentos.find((x) => String(x.id) === m[1]);
      return p ? resposta(200, p) : resposta(404, { message: 'not found' });
    }
  }
  throw new Error('fetch não simulado: ' + metodo + ' ' + url);
};

// req/res no formato da Vercel
async function chamar(rota, { token, corpo, metodo = 'POST', url, headers = {} } = {}) {
  const handler = (await import('../api/' + rota + '.js')).default;
  const req = {
    method: metodo, url: url || '/api/' + rota, body: corpo,
    headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }
  };
  const res = {
    statusCode: 200, cabecalhos: {}, corpo: '',
    setHeader(k, v) { this.cabecalhos[k.toLowerCase()] = v; },
    end(t) { this.corpo = t || ''; }
  };
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.corpo); } catch { /* texto */ }
  return { status: res.statusCode, json, texto: res.corpo };
}

const cfgSite = (servicos, ref = 'refdosite1234567890') => ({ v: 1, ref, origem: 'configurador', objetivos: ['atrair-vender'], servicos, complementos: [], notas: 'Clínica odontológica' });
function mpPagou(pagamentoId, valor, status = 'approved', id = 1000 + mp.pagamentos.length) {
  const p = { id, status, status_detail: 'accredited', external_reference: pagamentoId, transaction_amount: valor, currency_id: 'BRL', payment_type_id: 'credit_card', date_approved: new Date().toISOString() };
  mp.pagamentos.push(p);
  return p;
}

test('sem login: 401', async () => {
  const r = await chamar('solicitacoes', { corpo: { cfg: cfgSite([{ id: 'landing-page', modelo: 'modelos-prontos' }]) } });
  assert.equal(r.status, 401);
});

test('modelo pronto: salva com preço do servidor, recarregar não duplica, paga e confirma pela volta do checkout', async () => {
  const cfg = cfgSite([{ id: 'landing-page', modelo: 'modelos-prontos', nome: 'Landing', preco: 1 }]);
  const r1 = await chamar('solicitacoes', { token: 'tok-ana', corpo: { cfg } });
  assert.equal(r1.status, 201);
  assert.equal(r1.json.solicitacao.estruturado, true);
  assert.equal(r1.json.solicitacao.status, 'aguardando_pagamento');
  assert.equal(banco.solicitacoes[0].valor_final, 500);

  const r2 = await chamar('solicitacoes', { token: 'tok-ana', corpo: { cfg } });
  assert.equal(r2.status, 200);
  assert.equal(r2.json.nova, false);
  assert.equal(banco.solicitacoes.length, 1);

  // outra pessoa não paga a solicitação da Ana
  const alheio = await chamar('checkout', { token: 'tok-bia', corpo: { solicitacao_id: r1.json.solicitacao.id } });
  assert.equal(alheio.status, 404);

  const c1 = await chamar('checkout', { token: 'tok-ana', corpo: { solicitacao_id: r1.json.solicitacao.id } });
  assert.equal(c1.status, 200);
  assert.match(c1.json.url, /^https:\/\/www\.mercadopago\.com\.br\//);
  const pref = mp.prefs[0];
  assert.equal(pref.items[0].unit_price, 500);
  assert.equal(pref.external_reference, c1.json.pagamento_id);
  assert.equal(pref.auto_return, 'approved');
  assert.equal(pref.notification_url, 'https://app.cmkcogit.com.br/api/mp-webhook?source_news=webhooks');

  // segundo clique reaproveita a mesma cobrança e o mesmo link
  const c2 = await chamar('checkout', { token: 'tok-ana', corpo: { solicitacao_id: r1.json.solicitacao.id } });
  assert.equal(c2.json.url, c1.json.url);
  assert.equal(banco.pagamentos.length, 1);
  assert.equal(mp.prefs.length, 1);

  const pago = mpPagou(c1.json.pagamento_id, 500);
  const v = await chamar('verificar-pagamento', { token: 'tok-ana', corpo: { pagamento_id: c1.json.pagamento_id, payment_id: String(pago.id) } });
  assert.equal(v.status, 200);
  assert.equal(v.json.status, 'pago');
  assert.equal(v.json.resultado, 'pago');
  assert.equal(banco.solicitacoes[0].status, 'paga');
  assert.equal(banco.projetos.length, 1);
});

test('sob medida: fica em validação e não abre pagamento até o admin liberar', async () => {
  const r = await chamar('solicitacoes', { token: 'tok-ana', corpo: { cfg: cfgSite([{ id: 'site-institucional', modelo: 'sob-medida' }], 'outrarefdosite123456') } });
  assert.equal(r.json.solicitacao.status, 'em_validacao');
  assert.equal(banco.solicitacoes[0].valor_final, null);
  const c = await chamar('checkout', { token: 'tok-ana', corpo: { solicitacao_id: r.json.solicitacao.id } });
  assert.equal(c.status, 409);

  // admin aprova (via função SQL no app real) -> simulado aqui
  Object.assign(banco.solicitacoes[0], { status: 'aguardando_pagamento', valor_final: 1200 });
  const c2 = await chamar('checkout', { token: 'tok-ana', corpo: { solicitacao_id: r.json.solicitacao.id } });
  assert.equal(c2.status, 200);
  assert.equal(mp.prefs[0].items[0].unit_price, 1200);

  // admin muda o valor: a cobrança é atualizada e um novo link é criado
  banco.solicitacoes[0].valor_final = 1500;
  const c3 = await chamar('checkout', { token: 'tok-ana', corpo: { solicitacao_id: r.json.solicitacao.id } });
  assert.notEqual(c3.json.url, c2.json.url);
  assert.equal(mp.prefs[1].items[0].unit_price, 1500);
  assert.equal(banco.pagamentos.length, 1);

  // alguém paga o link ANTIGO (1200): nada é liberado
  mpPagou(c2.json.pagamento_id, 1200);
  const v = await chamar('verificar-pagamento', { token: 'tok-ana', corpo: { pagamento_id: c2.json.pagamento_id } });
  assert.equal(v.json.resultado, 'valor_divergente');
  assert.equal(banco.solicitacoes[0].status, 'aguardando_pagamento');
});

test('webhook: assinatura inválida é recusada; válida confirma; repetido não duplica', async () => {
  const r = await chamar('solicitacoes', { token: 'tok-ana', corpo: { cfg: cfgSite([{ id: 'portfolio', modelo: 'modelos-prontos' }], 'webhookref1234567890') } });
  const c = await chamar('checkout', { token: 'tok-ana', corpo: { solicitacao_id: r.json.solicitacao.id } });
  const pago = mpPagou(c.json.pagamento_id, 600, 'approved', 777);

  const url = '/api/mp-webhook?data.id=777&type=payment';
  const corpo = { type: 'payment', data: { id: '777' } };
  const ruim = await chamar('mp-webhook', { url, corpo, headers: { 'x-signature': 'ts=1,v1=errado', 'x-request-id': 'r1' } });
  assert.equal(ruim.status, 401);
  assert.equal(banco.pagamentos[0].status, 'pendente');

  const ts = '1700000000';
  const v1 = crypto.createHmac('sha256', 'segredo').update(`id:${pago.id};request-id:r1;ts:${ts};`).digest('hex');
  const ok = await chamar('mp-webhook', { url, corpo, headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'r1' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.texto, 'pago');
  assert.equal(banco.pagamentos[0].status, 'pago');

  const de_novo = await chamar('mp-webhook', { url, corpo, headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'r1' } });
  assert.equal(de_novo.texto, 'ja_processado');
  assert.equal(banco.projetos.length, 1);

  // evento de outro tipo ou id fictício do "simular" do painel: 200 sem efeito
  assert.equal((await chamar('mp-webhook', { url: '/api/mp-webhook?type=merchant_order&data.id=1', corpo: {} })).texto, 'ignorado');
  assert.equal((await chamar('mp-webhook', { url: '/api/mp-webhook?type=payment&data.id=123', corpo: {} })).texto, 'pagamento inexistente');
});

test('verificar: tentativa recusada mantém pendente; outro cliente não consulta', async () => {
  const r = await chamar('solicitacoes', { token: 'tok-ana', corpo: { cfg: cfgSite([{ id: 'consultoria' }], 'recusadoref123456789') } });
  const c = await chamar('checkout', { token: 'tok-ana', corpo: { solicitacao_id: r.json.solicitacao.id } });
  mpPagou(c.json.pagamento_id, 350, 'rejected');
  const v = await chamar('verificar-pagamento', { token: 'tok-ana', corpo: { pagamento_id: c.json.pagamento_id } });
  assert.equal(v.json.status, 'pendente');
  assert.equal(v.json.mp_status, 'rejected');
  const bia = await chamar('verificar-pagamento', { token: 'tok-bia', corpo: { pagamento_id: c.json.pagamento_id } });
  assert.equal(bia.status, 404);
});

test('localhost: sem auto_return e sem webhook (confirmação pela verificação)', async () => {
  process.env.APP_URL = 'http://localhost:3000';
  try {
    const r = await chamar('solicitacoes', { token: 'tok-ana', corpo: { cfg: cfgSite([{ id: 'landing-page', modelo: 'modelos-prontos' }], 'localhostref12345678') } });
    await chamar('checkout', { token: 'tok-ana', corpo: { solicitacao_id: r.json.solicitacao.id } });
    assert.equal(mp.prefs[0].auto_return, undefined);
    assert.equal(mp.prefs[0].notification_url, undefined);
    assert.equal(mp.prefs[0].back_urls.success, 'http://localhost:3000/pagamentos.html?mp=sucesso');
  } finally {
    process.env.APP_URL = 'https://app.cmkcogit.com.br';
  }
});

test('/config.js entrega só as chaves públicas', async () => {
  const handler = (await import('../api/config.js')).default;
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(t) { this.t = t; } };
  handler({ method: 'GET', headers: {} }, res);
  assert.match(res.t, /window\.COGIT_CONFIG/);
  assert.match(res.t, /"supabaseAnonKey":"anon"/);
  assert.doesNotMatch(res.t, /service|APP_USR|segredo/);
});
