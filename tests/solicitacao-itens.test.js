// /api/solicitacao-itens: tirar um item de uma solicitação ainda não paga, com o
// preço recalculado pelo catálogo. Supabase SIMULADO (sem internet).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { calcular } from '../lib/selecao.js';

const SUPA = 'https://teste.supabase.co';
Object.assign(process.env, { SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' });

const catalogo = JSON.parse(fs.readFileSync(new URL('./catalogo.fixture.json', import.meta.url)));
const ANA = 'aaaaaaaa-0000-4000-8000-000000000001';
const BIA = 'bbbbbbbb-0000-4000-8000-000000000002';
const ADM = 'cccccccc-0000-4000-8000-000000000003';
const TOKENS = { 'tok-ana': ANA, 'tok-bia': BIA, 'tok-adm': ADM };
let banco;
let corrida = null; // simula outra edição entre a leitura e a gravação

beforeEach(() => {
  corrida = null;
  const perfil = (id, role) => ({ id, role, nome: id.slice(0, 3), email: id.slice(0, 3) + '@ex.com', cadastro_concluido_em: '2026-01-01T00:00:00Z' });
  banco = { profiles: [perfil(ANA, 'cliente'), perfil(BIA, 'cliente'), perfil(ADM, 'admin')], solicitacoes: [], pagamentos: [], notificacoes: [], catalogo_precos: catalogo };
});

function criarSolicitacao(servicos, complementos = [], extra = {}) {
  const calc = calcular({ servicos, complementos }, catalogo);
  assert.ok(calc.ok, calc.erro);
  const s = {
    id: crypto.randomUUID(), codigo: 'SOL-0000' + (banco.solicitacoes.length + 1), cliente_id: ANA,
    selecao: { objetivos: [], servicos, complementos }, resumo: calc.resumo, estruturado: calc.estruturado,
    tipo_preco: calc.tipo_preco, valor_calculado: calc.valor, valor_final: calc.estruturado ? calc.valor : null,
    status: calc.estruturado ? 'aguardando_pagamento' : 'em_validacao', updated_at: '2026-10-30T10:00:00.123456+00:00', ...extra
  };
  banco.solicitacoes.push(s);
  return s;
}

function resposta(status, corpo) {
  return new Response(corpo === undefined ? '' : JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}
function filtrar(linhas, params) {
  let r = linhas.filter((l) => [...params].every(([k, v]) => {
    if (['select', 'limit', 'order'].includes(k)) return true;
    const [op, ...resto] = v.split('.');
    if (op === 'eq') return String(l[k]) === resto.join('.');
    throw new Error('operador não simulado: ' + op);
  }));
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
    return id ? resposta(200, { id }) : resposta(401, {});
  }
  const tabela = u.pathname.replace('/rest/v1/', '');
  const linhas = banco[tabela];
  if (metodo === 'GET') return resposta(200, filtrar(linhas, u.searchParams));
  if (metodo === 'POST') { const n = { id: crypto.randomUUID(), lida: false, ...corpo }; linhas.push(n); return resposta(201, [n]); }
  if (metodo === 'PATCH') {
    if (tabela === 'solicitacoes' && corrida) corrida();
    const alvo = filtrar(linhas, u.searchParams);
    alvo.forEach((l) => Object.assign(l, corpo, tabela === 'solicitacoes' ? { updated_at: new Date().toISOString() } : {}));
    return resposta(200, alvo);
  }
  throw new Error('método não simulado');
};

async function remover(token, corpo) {
  const handler = (await import('../api/solicitacao-itens.js')).default;
  const req = { method: 'POST', url: '/api/solicitacao-itens', body: corpo, headers: token ? { authorization: 'Bearer ' + token } : {} };
  const res = { statusCode: 200, corpo: '', setHeader() {}, end(t) { this.corpo = t || ''; } };
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.corpo || 'null') };
}

test('cliente tira a Landing Page e fica só com o Portfólio: novo preço e cobrança atualizada', async () => {
  const s = criarSolicitacao([{ id: 'landing-page', modelo: 'modelos-prontos' }, { id: 'portfolio', modelo: 'modelos-prontos' }]);
  assert.equal(s.valor_final, 1100);
  banco.pagamentos.push({ id: 'pg1', solicitacao_id: s.id, status: 'pendente', valor: 1100, link_pagamento: 'https://www.mercadopago.com.br/x', mp_preference_id: 'p1' });

  const r = await remover('tok-ana', { solicitacao_id: s.id, tipo: 'servico', id: 'landing-page' });
  assert.equal(r.status, 200);
  assert.equal(r.json.solicitacao.valor_final, 600);
  assert.equal(s.status, 'aguardando_pagamento');
  assert.deepEqual(s.selecao.servicos.map((x) => x.id), ['portfolio']);
  assert.equal(s.resumo.itens.length, 1);
  assert.equal(s.resumo.removidos[0].por, 'cliente');
  assert.equal(banco.pagamentos[0].valor, 600);
  assert.equal(banco.pagamentos[0].link_pagamento, null); // link antigo (R$ 1.100) descartado
  assert.deepEqual(banco.notificacoes.map((n) => n.usuario_id), [ADM]); // a equipe é avisada
});

test('admin tira um item: sob medida volta para validação, cobrança pendente cancelada, cliente avisado', async () => {
  const s = criarSolicitacao([{ id: 'landing-page', modelo: 'modelos-prontos' }, { id: 'site-institucional', modelo: 'sob-medida' }],
    [], { status: 'aguardando_pagamento', valor_final: 2000 });
  banco.pagamentos.push({ id: 'pg1', solicitacao_id: s.id, status: 'pendente', valor: 2000 });

  const r = await remover('tok-adm', { solicitacao_id: s.id, tipo: 'servico', id: 'landing-page' });
  assert.equal(r.status, 200);
  assert.equal(s.status, 'em_validacao');
  assert.equal(s.valor_final, null);
  assert.equal(banco.pagamentos[0].status, 'cancelado');
  assert.equal(s.resumo.removidos[0].por, 'equipe');
  assert.deepEqual(banco.notificacoes.map((n) => n.usuario_id), [ANA]);
});

test('complemento que dependia da solução removida sai junto', async () => {
  const s = criarSolicitacao([{ id: 'landing-page', modelo: 'modelos-prontos' }, { id: 'consultoria' }], [{ id: 'integracao-externa', qtd: 1 }]);
  const r = await remover('tok-ana', { solicitacao_id: s.id, tipo: 'servico', id: 'landing-page' });
  assert.equal(r.status, 200);
  assert.deepEqual(s.selecao.complementos, []);
  assert.equal(r.json.removidos_junto.length, 1);
  assert.equal(s.valor_final, 350);
});

test('recusas: última solução, outra pessoa, já paga, item inexistente, edição simultânea', async () => {
  const s = criarSolicitacao([{ id: 'landing-page', modelo: 'modelos-prontos' }, { id: 'portfolio', modelo: 'modelos-prontos' }]);
  const unica = criarSolicitacao([{ id: 'portfolio', modelo: 'modelos-prontos' }]);
  assert.equal((await remover('tok-ana', { solicitacao_id: unica.id, tipo: 'servico', id: 'portfolio' })).status, 409);
  assert.equal((await remover('tok-bia', { solicitacao_id: s.id, tipo: 'servico', id: 'portfolio' })).status, 404);
  assert.equal((await remover('tok-ana', { solicitacao_id: s.id, tipo: 'servico', id: 'loja-virtual' })).status, 404);
  assert.equal((await remover(null, { solicitacao_id: s.id, tipo: 'servico', id: 'portfolio' })).status, 401);

  corrida = () => { s.updated_at = '2026-10-30T11:00:00+00:00'; corrida = null; };
  assert.equal((await remover('tok-ana', { solicitacao_id: s.id, tipo: 'servico', id: 'portfolio' })).status, 409);
  assert.equal(s.selecao.servicos.length, 2);

  s.status = 'paga';
  assert.equal((await remover('tok-ana', { solicitacao_id: s.id, tipo: 'servico', id: 'portfolio' })).status, 409);
});
