// /api/admin-solicitacao (modal de validação) e /api/comprovante (link público).
// Supabase SIMULADO (sem internet).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { calcular } from '../lib/selecao.js';

const SUPA = 'https://teste.supabase.co';
Object.assign(process.env, { SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon', APP_URL: 'https://app.cmkcogit.com.br' });

const catalogo = JSON.parse(fs.readFileSync(new URL('./catalogo.fixture.json', import.meta.url)));
const ANA = 'aaaaaaaa-0000-4000-8000-000000000001';
const ADM = 'cccccccc-0000-4000-8000-000000000003';
const TOKENS = { 'tok-ana': ANA, 'tok-adm': ADM };
let banco;

beforeEach(() => {
  banco = {
    profiles: [
      { id: ANA, role: 'cliente', nome: 'Ana Souza', email: 'ana@ex.com', telefone: '1731983769', cadastro_concluido_em: '2026-01-01T00:00:00Z' },
      { id: ADM, role: 'admin', nome: 'Kaike', email: 'adm@ex.com', cadastro_concluido_em: '2026-01-01T00:00:00Z' }
    ],
    solicitacoes: [], pagamentos: [], notificacoes: [], solicitacao_eventos: [], catalogo_precos: catalogo
  };
});

function criar(servicos, extra = {}) {
  const calc = calcular({ servicos, complementos: [] }, catalogo);
  const s = {
    id: crypto.randomUUID(), codigo: 'PLN-2026-0013', cliente_id: ANA, created_at: '2026-10-27T20:09:43Z',
    selecao: { objetivos: [], servicos, complementos: [] }, resumo: calc.resumo, estruturado: calc.estruturado,
    tipo_preco: calc.tipo_preco, valor_calculado: calc.valor, valor_final: calc.estruturado ? calc.valor : null,
    status: calc.estruturado ? 'aguardando_pagamento' : 'em_validacao', updated_at: '2026-10-30T10:00:00.123456+00:00', ...extra
  };
  banco.solicitacoes.push(s);
  return s;
}

const resposta = (status, corpo) => new Response(corpo === undefined ? '' : JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
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
  if (metodo === 'POST') { const n = { id: crypto.randomUUID(), ...corpo }; linhas.push(n); return resposta(201, [n]); }
  if (metodo === 'PATCH') {
    const alvo = filtrar(linhas, u.searchParams);
    alvo.forEach((l) => Object.assign(l, corpo, tabela === 'solicitacoes' ? { updated_at: new Date().toISOString() } : {}));
    return resposta(200, alvo);
  }
  throw new Error('método não simulado');
};

async function chamar(rota, { token, corpo, metodo = 'POST', query } = {}) {
  const handler = (await import('../api/' + rota + '.js')).default;
  const req = { method: metodo, url: '/api/' + rota, query: query || {}, body: corpo, headers: token ? { authorization: 'Bearer ' + token } : {} };
  const res = { statusCode: 200, cabecalhos: {}, corpo: '', setHeader(k, v) { this.cabecalhos[k] = v; }, end(t) { this.corpo = t || ''; } };
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.corpo || 'null') };
}
const admin = (corpo) => chamar('admin-solicitacao', { token: 'tok-adm', corpo });

const itensDe = (s) => ({ servicos: s.selecao.servicos, complementos: s.selecao.complementos, personalizados: s.selecao.personalizados || [] });

test('só admin usa o modal', async () => {
  const s = criar([{ id: 'portfolio', modelo: 'sob-medida' }]);
  const r = await chamar('admin-solicitacao', { token: 'tok-ana', corpo: { acao: 'simular', solicitacao_id: s.id, itens: itensDe(s) } });
  assert.equal(r.status, 403);
});

test('simular: remover e adicionar (catálogo + personalizado) recalcula sem gravar; item novo vem marcado como da equipe', async () => {
  const s = criar([{ id: 'landing-page', modelo: 'modelos-prontos' }, { id: 'portfolio', modelo: 'sob-medida' }]);
  const antes = JSON.stringify(s);
  const itens = {
    servicos: [{ id: 'portfolio', modelo: 'sob-medida' }, { id: 'identidade-essencial', modelo: null }],
    complementos: [],
    personalizados: [{ id: 'custom-abc12345', nome: 'Página extra', descricao: 'Serviços', valor: 250 }]
  };
  const r = await admin({ acao: 'simular', solicitacao_id: s.id, itens });
  assert.equal(r.status, 200);
  assert.equal(r.json.valor, 700 + 500 + 250);
  const identidade = r.json.resumo.itens.find((i) => i.id === 'identidade-essencial');
  assert.equal(identidade.adicionado, 'equipe');
  assert.equal(r.json.resumo.itens.find((i) => i.id === 'portfolio').adicionado, undefined);
  assert.equal(r.json.resumo.itens.find((i) => i.personalizado).adicionado, 'equipe');
  assert.equal(JSON.stringify(s), antes); // nada gravado
});

test('aprovar com itens retirados pela equipe: vai para "Aguardando aprovação do cliente"; grava valor, quem/quando, comprovante e WhatsApp', async () => {
  const s = criar([{ id: 'landing-page', modelo: 'modelos-prontos' }, { id: 'portfolio', modelo: 'sob-medida' }]);
  banco.pagamentos.push({ id: 'pg', solicitacao_id: s.id, status: 'pendente', valor: 1, link_pagamento: 'x', mp_preference_id: 'y' });
  const r = await admin({
    acao: 'aprovar', solicitacao_id: s.id, updated_at: s.updated_at, valor_final: 950, mensagem: 'Inclui 2 rodadas de ajuste.',
    itens: { servicos: [{ id: 'portfolio', modelo: 'sob-medida' }], complementos: [], personalizados: [] }
  });
  assert.equal(r.status, 200);
  assert.equal(s.status, 'aguardando_cliente'); // a equipe tirou a Landing Page: o cliente confirma antes de pagar
  assert.equal(s.valor_final, 950);
  assert.equal(banco.solicitacao_eventos.at(-1).tipo, 'aguardando_cliente');
  assert.equal(banco.solicitacao_eventos.at(-1).autor_id, ADM);
  assert.equal(s.aprovado_por, ADM);
  assert.ok(s.aprovado_em);
  assert.match(s.comprovante_token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(s.comprovante.mensagem, 'Inclui 2 rodadas de ajuste.');
  assert.equal(s.comprovante.valor_final, 950);
  assert.equal(s.comprovante.itens.length, 1);
  assert.equal(s.resumo.removidos[0].nome, 'Landing Page');
  assert.equal(banco.pagamentos[0].valor, 950);
  assert.equal(banco.pagamentos[0].link_pagamento, null);

  assert.equal(r.json.comprovante_url, 'https://app.cmkcogit.com.br/comprovante.html?t=' + s.comprovante_token);
  assert.ok(r.json.whatsapp_url.startsWith('https://wa.me/551731983769?text='));
  const texto = decodeURIComponent(r.json.whatsapp_url.split('?text=')[1]);
  assert.match(texto, /Olá, Ana!/);
  assert.match(texto, /PLN-2026-0013/);
  assert.match(texto, /R\$\s?950,00/);
  assert.match(texto, /Inclui 2 rodadas de ajuste\./);
  assert.ok(texto.includes(r.json.comprovante_url));
  assert.equal(banco.notificacoes[0].usuario_id, ANA);

  // página pública do comprovante
  const c = await chamar('comprovante', { metodo: 'GET', query: { t: s.comprovante_token } });
  assert.equal(c.status, 200);
  assert.equal(c.json.comprovante.codigo, 'PLN-2026-0013');
  assert.equal(c.json.pagamento.codigo, 'aguardando_cliente');
  assert.equal((await chamar('comprovante', { metodo: 'GET', query: { t: 'x'.repeat(32) } })).status, 404);
  assert.equal((await chamar('comprovante', { metodo: 'GET', query: { t: 'curto' } })).status, 404);

  // reenviar usa o mesmo link
  const re = await admin({ acao: 'reenviar', solicitacao_id: s.id });
  assert.equal(re.json.comprovante_url, r.json.comprovante_url);
});

test('aprovar: valor zero, sem itens ou com o modal desatualizado é recusado', async () => {
  const s = criar([{ id: 'portfolio', modelo: 'sob-medida' }]);
  const itens = itensDe(s);
  assert.equal((await admin({ acao: 'aprovar', solicitacao_id: s.id, itens, valor_final: 0 })).status, 400);
  assert.equal((await admin({ acao: 'aprovar', solicitacao_id: s.id, valor_final: 100, itens: { servicos: [], complementos: [], personalizados: [] } })).status, 400);
  assert.equal((await admin({ acao: 'aprovar', solicitacao_id: s.id, itens, valor_final: 100, updated_at: '2020-01-01T00:00:00+00:00' })).status, 409);
  assert.equal(s.status, 'em_validacao');
});

test('aprovar sem mudar os itens libera o pagamento direto', async () => {
  const s = criar([{ id: 'landing-page', modelo: 'modelos-prontos' }]);
  const r = await admin({ acao: 'aprovar', solicitacao_id: s.id, updated_at: s.updated_at, valor_final: 600, itens: { servicos: [{ id: 'landing-page', modelo: 'modelos-prontos' }], complementos: [], personalizados: [] } });
  assert.equal(r.status, 200);
  assert.equal(s.status, 'aguardando_pagamento');
  assert.equal(banco.solicitacao_eventos.at(-1).tipo, 'aprovada');
  assert.match(banco.notificacoes.at(-1).titulo, /pagamento liberado/);
});

test('analisar, solicitar ajustes e observação: status, histórico com o admin e aviso ao cliente', async () => {
  const s = criar([{ id: 'landing-page', modelo: 'modelos-prontos' }], { status: 'em_validacao', valor_final: null });
  const a = await admin({ acao: 'analisar', solicitacao_id: s.id });
  assert.equal(a.status, 200);
  assert.equal(s.status, 'em_analise');
  assert.equal(s.analise_por, ADM);
  assert.equal((await admin({ acao: 'ajustes', solicitacao_id: s.id })).status, 400); // precisa da mensagem
  const aj = await admin({ acao: 'ajustes', solicitacao_id: s.id, mensagem: 'Troque a foto do banner.' });
  assert.equal(aj.status, 200);
  assert.equal(s.status, 'ajustes_solicitados');
  const ob = await admin({ acao: 'observacao', solicitacao_id: s.id, mensagem: 'Pode usar fotos do celular.' });
  assert.equal(ob.status, 200);
  assert.equal(s.status, 'ajustes_solicitados');
  assert.deepEqual(banco.solicitacao_eventos.map((e) => e.tipo), ['analise_iniciada', 'ajustes_solicitados', 'observacao']);
  assert.ok(banco.solicitacao_eventos.every((e) => e.autor_id === ADM && e.autor_papel === 'admin'));
  assert.equal(banco.notificacoes.filter((n) => n.usuario_id === ANA).length, 3);
});

test('salvar não libera pagamento: o status só muda pela aprovação', async () => {
  const s = criar([{ id: 'portfolio', modelo: 'sob-medida' }, { id: 'landing-page', modelo: 'modelos-prontos' }]);
  const r1 = await admin({ acao: 'salvar', solicitacao_id: s.id, itens: { servicos: [{ id: 'portfolio', modelo: 'sob-medida' }], complementos: [], personalizados: [] } });
  assert.equal(r1.status, 200);
  assert.equal(s.status, 'em_validacao');
  assert.equal(s.valor_final, null);
  const r2 = await admin({ acao: 'salvar', solicitacao_id: s.id, itens: { servicos: [{ id: 'landing-page', modelo: 'modelos-prontos' }], complementos: [], personalizados: [] } });
  assert.equal(r2.status, 200);
  assert.equal(s.status, 'em_validacao');
  assert.equal(s.valor_final, null);
});

test('cancelar: motivo, quem/quando, cobrança cancelada e WhatsApp só com mensagem', async () => {
  const s = criar([{ id: 'portfolio', modelo: 'sob-medida' }]);
  banco.pagamentos.push({ id: 'pg', solicitacao_id: s.id, status: 'pendente', valor: 800 });
  const r = await admin({ acao: 'cancelar', solicitacao_id: s.id, motivo: 'Cliente desistiu', mensagem: 'Quando quiser retomar, é só chamar.' });
  assert.equal(r.status, 200);
  assert.equal(s.status, 'cancelada');
  assert.equal(s.motivo_cancelamento, 'Cliente desistiu');
  assert.equal(s.cancelado_por, ADM);
  assert.equal(banco.pagamentos[0].status, 'cancelado');
  assert.match(decodeURIComponent(r.json.whatsapp_url), /Quando quiser retomar/);

  const s2 = criar([{ id: 'portfolio', modelo: 'sob-medida' }]);
  const r2 = await admin({ acao: 'cancelar', solicitacao_id: s2.id });
  assert.equal(r2.json.whatsapp_url, null);
  assert.equal((await admin({ acao: 'cancelar', solicitacao_id: s2.id })).status, 409); // já cancelada
});

test('cliente tira um item personalizado que a equipe adicionou', async () => {
  const s = criar([{ id: 'portfolio', modelo: 'modelos-prontos' }]);
  await admin({ acao: 'salvar', solicitacao_id: s.id, itens: { servicos: s.selecao.servicos, complementos: [], personalizados: [{ id: 'custom-zz99zz99', nome: 'Página extra', valor: 250 }] } });
  assert.equal(s.valor_final, 750); // já estava aprovada: acompanha o novo preço fechado
  const r = await chamar('solicitacao-itens', { token: 'tok-ana', corpo: { solicitacao_id: s.id, tipo: 'servico', id: 'custom-zz99zz99' } });
  assert.equal(r.status, 200);
  assert.equal(s.valor_calculado, 500);
  assert.equal(s.status, 'em_validacao'); // o cliente mudou: volta para a análise da CMK
  assert.equal(s.selecao.personalizados.length, 0);
});
