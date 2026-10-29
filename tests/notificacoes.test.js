// Notificações: regra de "compra de oferta" (placeholder), serviço createNotification
// e a rota /api/notificacoes com o Supabase SIMULADO (sem internet).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { COMPRA_OFERTA, shouldNotifyOnOfferPurchase } from '../lib/notificacoes.config.js';
import { createNotification, notificarCompraOferta } from '../lib/notificacoes.js';

const SUPA = 'https://teste.supabase.co';
Object.assign(process.env, { SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' });

const ANA = 'aaaaaaaa-0000-4000-8000-000000000001';
const BIA = 'bbbbbbbb-0000-4000-8000-000000000002';
const ADM = 'cccccccc-0000-4000-8000-000000000003';
const TOKENS = { 'tok-ana': ANA, 'tok-bia': BIA };
let banco;

beforeEach(() => {
  banco = {
    profiles: [
      { id: ANA, nome: 'Ana', email: 'ana@ex.com', role: 'cliente', cadastro_concluido_em: '2026-01-01T00:00:00Z' },
      { id: BIA, nome: 'Bia', email: 'bia@ex.com', role: 'cliente', cadastro_concluido_em: '2026-01-01T00:00:00Z' },
      { id: ADM, nome: 'Adm', email: 'adm@ex.com', role: 'admin', cadastro_concluido_em: '2026-01-01T00:00:00Z' }
    ],
    notificacoes: [],
    pagamentos: [],
    projeto_funcionalidades: []
  };
  const n = (usuario, titulo, lida, minutos) => ({
    id: crypto.randomUUID(), usuario_id: usuario, tipo: 'compra_oferta', titulo, mensagem: null, link: 'inicio.html',
    lida, lida_em: null, metadados: {}, created_at: new Date(Date.now() - minutos * 60000).toISOString()
  });
  banco.notificacoes.push(n(ANA, 'antiga', false, 30), n(ANA, 'nova', false, 1), n(ANA, 'lida', true, 60), n(BIA, 'da bia', false, 5));
});

function resposta(status, corpo) {
  return new Response(corpo === undefined ? '' : JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}
function filtrar(linhas, params) {
  let r = linhas.filter((l) => [...params].every(([k, v]) => {
    if (['select', 'limit', 'order'].includes(k)) return true;
    const [op, ...resto] = v.split('.');
    const val = resto.join('.');
    if (op === 'eq') return String(l[k]) === val;
    if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').includes(String(l[k]));
    throw new Error('operador não simulado: ' + op);
  }));
  const ordem = params.get('order');
  if (ordem) {
    const [campo, dir] = ordem.split('.');
    r = [...r].sort((a, b) => (a[campo] < b[campo] ? -1 : 1) * (dir === 'desc' ? -1 : 1));
  }
  if (params.get('limit')) r = r.slice(0, Number(params.get('limit')));
  return r;
}

globalThis.fetch = async (url, op = {}) => {
  const u = new URL(url);
  const metodo = op.method || 'GET';
  const corpo = op.body ? JSON.parse(op.body) : undefined;
  if (u.origin !== SUPA) throw new Error('fetch não simulado: ' + url);
  if (u.pathname === '/auth/v1/user') {
    const id = TOKENS[(op.headers.Authorization || '').replace('Bearer ', '')];
    return id ? resposta(200, { id }) : resposta(401, { msg: 'invalid' });
  }
  const linhas = banco[u.pathname.replace('/rest/v1/', '')];
  if (metodo === 'GET') return resposta(200, filtrar(linhas, u.searchParams));
  if (metodo === 'POST') {
    const nova = { id: crypto.randomUUID(), lida: false, created_at: new Date().toISOString(), ...corpo };
    linhas.push(nova);
    return resposta(201, [nova]);
  }
  if (metodo === 'PATCH') {
    const alvo = filtrar(linhas, u.searchParams);
    alvo.forEach((l) => Object.assign(l, corpo));
    return resposta(200, alvo);
  }
  throw new Error('método não simulado');
};

async function chamar({ token, metodo = 'GET', corpo, query = {} } = {}) {
  const handler = (await import('../api/notificacoes.js')).default;
  const req = { method: metodo, url: '/api/notificacoes', query, body: corpo, headers: token ? { authorization: 'Bearer ' + token } : {} };
  const res = { statusCode: 200, corpo: '', setHeader() {}, end(t) { this.corpo = t || ''; } };
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.corpo || 'null') };
}

const evento = { pagamentoId: crypto.randomUUID(), clienteId: ANA, projetoId: null, valor: 900, pagoEm: null, oferta: { id: null, slug: 'blog-seo', nome: 'Blog + SEO' } };

test('regra de compra de oferta: placeholder desligado até as regras serem definidas', () => {
  assert.equal(COMPRA_OFERTA.tipo, 'compra_oferta');
  assert.equal(shouldNotifyOnOfferPurchase(evento), false);
  assert.equal(shouldNotifyOnOfferPurchase(evento, { ...COMPRA_OFERTA, habilitado: true }), true);
  assert.equal(shouldNotifyOnOfferPurchase(null, { ...COMPRA_OFERTA, habilitado: true }), false);
});

test('createNotification valida destinatário/tipo e descarta link externo', async () => {
  const db = { inserir: async (t, linha) => ({ tabela: t, ...linha }) };
  const r = await createNotification(db, { destinatarioId: ANA, tipo: 'compra_oferta', titulo: ' Oi ', link: 'https://mal.com', metadados: { a: 1 } });
  assert.equal(r.tabela, 'notificacoes');
  assert.equal(r.usuario_id, ANA);
  assert.equal(r.titulo, 'Oi');
  assert.equal(r.link, null);
  assert.deepEqual(r.metadados, { a: 1 });
  await assert.rejects(createNotification(db, { destinatarioId: 'x', tipo: 'compra_oferta', titulo: 'a' }));
  await assert.rejects(createNotification(db, { destinatarioId: ANA, tipo: 'Tipo Ruim!', titulo: 'a' }));
});

test('compra de oferta: só notifica quando a regra deixa; cliente + admins', async () => {
  const { criarDb } = await import('../lib/supabase.js');
  const db = criarDb();
  const pf = crypto.randomUUID();
  banco.projeto_funcionalidades.push({ id: pf, funcionalidade_id: 'f1', funcionalidades: { slug: 'blog-seo', nome: 'Blog + SEO' } });
  const pag = { id: crypto.randomUUID(), cliente_id: ANA, projeto_id: null, projeto_funcionalidade_id: pf, valor: 900, status: 'pago' };
  banco.pagamentos.push(pag);
  const antes = banco.notificacoes.length;

  assert.equal(await notificarCompraOferta(db, pag.id), 0); // regra padrão: desligada
  assert.equal(banco.notificacoes.length, antes);

  const n = await notificarCompraOferta(db, pag.id, { config: { ...COMPRA_OFERTA, habilitado: true } });
  assert.equal(n, 2);
  const novas = banco.notificacoes.slice(antes);
  assert.deepEqual(novas.map((x) => x.usuario_id).sort(), [ANA, ADM].sort());
  assert.ok(novas.every((x) => x.tipo === 'compra_oferta' && x.metadados.oferta_slug === 'blog-seo'));

  // pagamento que não é de oferta (solução do site) não gera nada
  const outro = { id: crypto.randomUUID(), cliente_id: ANA, projeto_funcionalidade_id: null, valor: 500, status: 'pago' };
  banco.pagamentos.push(outro);
  assert.equal(await notificarCompraOferta(db, outro.id, { config: { ...COMPRA_OFERTA, habilitado: true } }), 0);
});

test('/api/notificacoes: sem login 401; lista só as próprias, mais novas primeiro', async () => {
  assert.equal((await chamar()).status, 401);
  const r = await chamar({ token: 'tok-ana' });
  assert.equal(r.status, 200);
  assert.equal(r.json.nao_lidas, 2);
  assert.deepEqual(r.json.notificacoes.map((n) => n.titulo), ['nova', 'antiga', 'lida']);
});

test('/api/notificacoes: marcar uma, marcar todas; não mexe nas de outra pessoa', async () => {
  const nova = banco.notificacoes.find((n) => n.titulo === 'nova');
  const daBia = banco.notificacoes.find((n) => n.titulo === 'da bia');
  const r1 = await chamar({ token: 'tok-ana', metodo: 'POST', corpo: { acao: 'marcar_lida', ids: [nova.id, daBia.id] } });
  assert.equal(r1.json.nao_lidas, 1);
  assert.equal(nova.lida, true);
  assert.ok(nova.lida_em);
  assert.equal(daBia.lida, false);

  const r2 = await chamar({ token: 'tok-ana', metodo: 'POST', corpo: { acao: 'marcar_todas' } });
  assert.equal(r2.json.nao_lidas, 0);
  assert.equal(daBia.lida, false);

  assert.equal((await chamar({ token: 'tok-ana', metodo: 'POST', corpo: { acao: 'apagar' } })).status, 400);
});
