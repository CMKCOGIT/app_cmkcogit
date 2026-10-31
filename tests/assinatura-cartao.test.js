// Renovação automática no cartão (sql/20): rota /api/assinatura e sincronização na rotina diária,
// com Supabase e Mercado Pago SIMULADOS.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { estadoAssinaturaMp } from '../lib/mercadopago.js';

const SUPA = 'https://teste.supabase.co';
Object.assign(process.env, {
  SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'service', MP_ACCESS_TOKEN: 'APP_USR-teste',
  APP_URL: 'https://app.cmkcogit.com.br', CRON_SECRET: 'segredo-cron'
});
const ANA = { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'ana@ex.com' };
const ASS = 'dddddddd-0000-4000-8000-000000000001';
let banco, mp, rpcs;

beforeEach(() => {
  banco = {
    profiles: [{ id: ANA.id, cadastro_concluido_em: '2026-01-01T00:00:00Z', role: 'cliente', documento: '52998224725', nome: 'Ana', email: ANA.email }],
    assinaturas: [{ id: ASS, cliente_id: ANA.id, nome: 'Landing Page', plano: 'mensal', valor: 30, status: 'ativa', proximo_vencimento: '2030-01-10', renovacao_automatica: false, mp_preapproval_id: null, mp_status: null }]
  };
  mp = { criadas: [], canceladas: [], pre: {} };
  rpcs = [];
});

const resp = (s, d) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, op = {}) => {
  const u = new URL(url);
  const corpo = op.body ? JSON.parse(op.body) : undefined;
  if (u.origin === SUPA) {
    if (u.pathname === '/auth/v1/user') return (op.headers.Authorization === 'Bearer tok-ana') ? resp(200, ANA) : resp(401, {});
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const f = u.pathname.split('/').pop();
      rpcs.push({ f, corpo });
      const a = banco.assinaturas.find((x) => x.id === corpo.p_assinatura_id);
      if (f === 'atualizar_renovacao_cartao') Object.assign(a, { mp_preapproval_id: corpo.p_preapproval_id, mp_status: corpo.p_status, renovacao_automatica: corpo.p_status === 'authorized' });
      if (f === 'registrar_cobrancas_cartao') return resp(200, 1);
      if (f === 'cancelar_assinatura') { a.status = 'cancelada'; return resp(200, a.proximo_vencimento); }
      if (f === 'gerar_renovacoes') return resp(200, []);
      return resp(200, null);
    }
    const tabela = u.pathname.replace('/rest/v1/', '');
    const filtros = [...u.searchParams].filter(([k]) => k !== 'select' && k !== 'limit');
    const linhas = (banco[tabela] || []).filter((l) => filtros.every(([k, v]) => {
      const [opr, ...r] = v.split('.'); const val = r.join('.');
      if (opr === 'eq') return String(l[k]) === val;
      if (opr === 'neq') return String(l[k]) !== val;
      if (opr === 'not') return l[k] != null;
      if (opr === 'in') return val.replace(/[()]/g, '').split(',').includes(String(l[k]));
      throw new Error('filtro ' + v);
    }));
    return resp(200, linhas);
  }
  if (u.origin === 'https://api.mercadopago.com') {
    if (u.pathname === '/preapproval' && op.method === 'POST') {
      mp.criadas.push(corpo);
      return resp(201, { id: 'pre-1', status: 'pending', init_point: 'https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-1' });
    }
    const m = /^\/preapproval\/(.+)$/.exec(u.pathname);
    if (m && op.method === 'PUT') { mp.canceladas.push(m[1]); return resp(200, { id: m[1], status: 'cancelled' }); }
    if (m) return resp(200, mp.pre[m[1]] || { id: m[1], status: 'pending' });
  }
  throw new Error('fetch não simulado: ' + url);
};

async function chamar(rota, { token, corpo, metodo = 'POST', headers = {} } = {}) {
  const handler = (await import('../api/' + rota + '.js')).default;
  const req = { method: metodo, url: '/api/' + rota, body: corpo, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } };
  const res = { statusCode: 200, corpo: '', setHeader() {}, end(t) { this.corpo = t || ''; } };
  await handler(req, res);
  return { status: res.statusCode, json: res.corpo ? JSON.parse(res.corpo) : null };
}

test('estado da assinatura do Mercado Pago: status e quantidade cobrada', () => {
  assert.deepEqual(estadoAssinaturaMp({ status: 'authorized', summarized: { charged_quantity: 2, last_charged_date: '2026-11-10T10:00:00.000-04:00' } }),
    { status: 'authorized', cobrancas: 2, ultimaCobranca: '2026-11-10T14:00:00.000Z' });
  assert.equal(estadoAssinaturaMp({ status: 'estranho' }).status, 'pending');
  assert.equal(estadoAssinaturaMp({}).cobrancas, null);
});

test('ativar: cria a assinatura no Mercado Pago com valor e período do plano e devolve o link', async () => {
  const r = await chamar('assinatura', { token: 'tok-ana', corpo: { assinatura_id: ASS, acao: 'ativar_cartao' } });
  assert.equal(r.status, 200);
  assert.match(r.json.url, /^https:\/\/www\.mercadopago\.com\.br\//);
  const c = mp.criadas[0];
  assert.equal(c.external_reference, ASS);
  assert.equal(c.payer_email, ANA.email);
  assert.deepEqual([c.auto_recurring.frequency, c.auto_recurring.frequency_type, c.auto_recurring.transaction_amount], [1, 'months', 30]);
  assert.equal(c.auto_recurring.start_date.slice(0, 10), '2030-01-10');
  assert.equal(banco.assinaturas[0].renovacao_automatica, false); // só liga quando o cartão for autorizado
});

test('plano anual cobra a cada 12 meses', async () => {
  Object.assign(banco.assinaturas[0], { plano: 'anual', valor: 324 });
  await chamar('assinatura', { token: 'tok-ana', corpo: { assinatura_id: ASS, acao: 'ativar_cartao' } });
  assert.deepEqual([mp.criadas[0].auto_recurring.frequency, mp.criadas[0].auto_recurring.transaction_amount], [12, 324]);
});

test('verificar: autorizado no Mercado Pago liga a renovação automática', async () => {
  Object.assign(banco.assinaturas[0], { mp_preapproval_id: 'pre-1', mp_status: 'pending' });
  mp.pre['pre-1'] = { id: 'pre-1', status: 'authorized' };
  const r = await chamar('assinatura', { token: 'tok-ana', corpo: { assinatura_id: ASS, acao: 'verificar_cartao' } });
  assert.equal(r.json.renovacao_automatica, true);
  assert.equal(banco.assinaturas[0].renovacao_automatica, true);
});

test('cancelar plano com cartão: cancela no Mercado Pago e depois no banco', async () => {
  Object.assign(banco.assinaturas[0], { mp_preapproval_id: 'pre-1', mp_status: 'authorized', renovacao_automatica: true });
  const r = await chamar('assinatura', { token: 'tok-ana', corpo: { assinatura_id: ASS, acao: 'cancelar' } });
  assert.equal(r.status, 200);
  assert.deepEqual(mp.canceladas, ['pre-1']);
  assert.equal(banco.assinaturas[0].status, 'cancelada');
});

test('plano de outra pessoa: 404 e nada é criado', async () => {
  banco.assinaturas[0].cliente_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  const r = await chamar('assinatura', { token: 'tok-ana', corpo: { assinatura_id: ASS, acao: 'ativar_cartao' } });
  assert.equal(r.status, 404);
  assert.equal(mp.criadas.length, 0);
});

test('rotina diária registra as cobranças feitas no cartão', async () => {
  Object.assign(banco.assinaturas[0], { mp_preapproval_id: 'pre-1', mp_status: 'authorized', renovacao_automatica: true });
  mp.pre['pre-1'] = { id: 'pre-1', status: 'authorized', summarized: { charged_quantity: 1, last_charged_date: '2030-01-10T12:00:00Z' } };
  const r = await chamar('renovacoes', { metodo: 'GET', headers: { authorization: 'Bearer segredo-cron' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.cartao, { registradas: 1, voltaram_manual: 0 });
  assert.deepEqual(rpcs.find((x) => x.f === 'registrar_cobrancas_cartao').corpo.p_total_cobrado, 1);
});

test('rotina diária: cartão sem cobrança 5 dias após o vencimento volta para a cobrança manual', async () => {
  Object.assign(banco.assinaturas[0], { proximo_vencimento: '2020-01-01', mp_preapproval_id: 'pre-1', mp_status: 'authorized', renovacao_automatica: true });
  banco.notificacoes = [];
  mp.pre['pre-1'] = { id: 'pre-1', status: 'authorized', summarized: { charged_quantity: 0 } };
  const r = await chamar('renovacoes', { metodo: 'GET', headers: { authorization: 'Bearer segredo-cron' } });
  assert.equal(r.json.cartao.voltaram_manual, 1);
  assert.deepEqual(mp.canceladas, ['pre-1']);
  assert.equal(banco.assinaturas[0].renovacao_automatica, false);
});
