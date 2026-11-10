// Jornada MVP (/api/notificacoes?rota=jornada) com o Supabase e a IA SIMULADOS (sem internet): trilha completa
// cliente responde -> envia -> equipe aprova/pede ajustes -> orçamento do MVP.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import handler from '../api/notificacoes.js';
import { MODULOS, PARAMETROS, sanitizarRespostas, etapasPendentes, normalizarEscopo, calcularOrcamento, montarPrompt } from '../lib/jornada.js';

const SUPA = 'https://teste.supabase.co';
Object.assign(process.env, { SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'service', GROQ_API_KEY: 'chave-teste' });
delete process.env.GEMINI_API_KEY;
delete process.env.JORNADA_VALOR_HORA;

const ANA = 'aaaaaaaa-0000-4000-8000-000000000001';
const BIA = 'bbbbbbbb-0000-4000-8000-000000000002';
const ADM = 'cccccccc-0000-4000-8000-000000000003';
const TOKENS = { 'tok-ana': ANA, 'tok-bia': BIA, 'tok-adm': ADM };
let banco, pedidosIA, respostaIA;

const ESCOPO = {
  resumo: 'Agenda online para salões.',
  funcionalidades: [
    { nome: 'Cadastro e login', descricao: 'Conta do cliente.', complexidade: 'baixa', prioridade: 'essencial', modulo: 'jornada-usuario' },
    { nome: 'Agendamento online', descricao: 'Escolher horário.', complexidade: 'média', prioridade: 'essencial', modulo: 'funcionalidades' },
    { nome: 'Pagamento por Pix', descricao: 'Pagar ao agendar.', complexidade: 'alta', prioridade: 'essencial', modulo: 'inventado' },
    { nome: 'cadastro e login', descricao: 'repetida', complexidade: 'baixa', prioridade: 'essencial' },
    { nome: 'Programa de pontos', descricao: 'Fidelidade.', complexidade: 'media', prioridade: 'desejavel' },
    { nome: 'Aplicativo de loja', descricao: 'Depois.', complexidade: 'alta', prioridade: 'futuro' },
    { nome: 'Esquisita', descricao: '', complexidade: 'gigante', prioridade: 'urgente', valor: 1 }
  ],
  premissas: ['O cliente fornece a marca.'], riscos: [], perguntas: ['Quantos salões no início?', 7]
};

beforeEach(() => {
  pedidosIA = [];
  respostaIA = () => ({ status: 200, corpo: { choices: [{ message: { content: JSON.stringify(ESCOPO) } }] } });
  banco = {
    profiles: [
      { id: ANA, nome: 'Ana Souza', email: 'ana@ex.com', role: 'cliente', cadastro_concluido_em: '2026-01-01T00:00:00Z' },
      { id: BIA, nome: 'Bia', email: 'bia@ex.com', role: 'cliente', cadastro_concluido_em: '2026-01-01T00:00:00Z' },
      { id: ADM, nome: 'Kaike', email: 'adm@ex.com', role: 'admin', cadastro_concluido_em: '2026-01-01T00:00:00Z' }
    ],
    jornadas: [], jornada_modulos: [], jornada_orcamentos: [], notificacoes: [],
    catalogo_precos: [{ id: 'mvp', preco: 3990, ativo: true }]
  };
});

const resposta = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
function filtrar(linhas, params) {
  let r = linhas.filter((l) => [...params].every(([k, v]) => {
    if (['select', 'limit', 'order'].includes(k)) return true;
    const [op, ...resto] = v.split('.');
    const val = resto.join('.');
    if (op === 'eq') return String(l[k]) === val;
    if (op === 'in') return val.slice(1, -1).split(',').includes(String(l[k]));
    throw new Error('operador não simulado: ' + op);
  }));
  if (params.get('order') === 'created_at.desc') r = r.slice().reverse();
  if (params.get('limit')) r = r.slice(0, Number(params.get('limit')));
  return r;
}
const PADRAO = { jornadas: { status: 'em_andamento' }, jornada_modulos: { status: 'aberto', respostas: {}, comentario: null } };

globalThis.fetch = async (url, op = {}) => {
  const u = new URL(url);
  if (u.hostname === 'api.groq.com') {
    const corpo = JSON.parse(op.body);
    pedidosIA.push(corpo);
    const r = respostaIA();
    return resposta(r.status, r.corpo);
  }
  if (u.origin !== SUPA) throw new Error('fetch não simulado: ' + url);
  if (u.pathname === '/auth/v1/user') {
    const id = TOKENS[(op.headers.Authorization || '').replace('Bearer ', '')];
    return id ? resposta(200, { id }) : resposta(401, {});
  }
  const tabela = u.pathname.replace('/rest/v1/', '');
  if (!banco[tabela]) throw new Error('tabela não simulada: ' + tabela);
  const metodo = op.method || 'GET';
  if (metodo === 'GET') return resposta(200, filtrar(banco[tabela], u.searchParams));
  if (metodo === 'POST') {
    const nova = { id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...PADRAO[tabela], ...JSON.parse(op.body) };
    if (tabela === 'jornadas' && banco.jornadas.some((j) => j.cliente_id === nova.cliente_id)) return resposta(409, { code: '23505', message: 'duplicate' });
    banco[tabela].push(nova);
    return resposta(201, [nova]);
  }
  if (metodo === 'PATCH') {
    const alvo = filtrar(banco[tabela], u.searchParams);
    alvo.forEach((l) => Object.assign(l, JSON.parse(op.body)));
    return resposta(200, alvo);
  }
  throw new Error('método não simulado: ' + metodo);
};

async function chamar(token, corpo, extra = '') {
  const query = '?rota=jornada' + extra.replace('?', '&');
  const req = { method: corpo ? 'POST' : 'GET', url: '/api/notificacoes' + query, headers: { authorization: 'Bearer ' + token }, body: corpo || undefined, query: Object.fromEntries(new URLSearchParams(query.slice(1))) };
  const res = { statusCode: 200, setHeader() {}, end(t) { this.texto = t; } };
  await handler(req, res);
  return { status: res.statusCode, ...JSON.parse(res.texto) };
}

// respostas mínimas válidas de um módulo
function preencher(m) {
  const r = {};
  for (const e of m.etapas) r[e.id] = e.tipo === 'multipla' ? [e.opcoes[0].id] : e.tipo === 'unica' ? e.opcoes[0].id : 'Resposta de ' + e.titulo;
  return r;
}
async function jornadaAprovada() {
  const { jornada } = await chamar('tok-ana', { acao: 'iniciar', titulo: 'Agenda Fácil' });
  for (const m of MODULOS) {
    await chamar('tok-ana', { acao: 'salvar', jornada_id: jornada.id, modulo: m.id, respostas: preencher(m) });
    await chamar('tok-ana', { acao: 'enviar', jornada_id: jornada.id, modulo: m.id });
    await chamar('tok-adm', { acao: 'avaliar', jornada_id: jornada.id, modulo: m.id, decisao: 'aprovado' });
  }
  return jornada;
}

test('a trilha é coerente: ids únicos e opções onde o tipo pede', () => {
  assert.equal(new Set(MODULOS.map((m) => m.id)).size, MODULOS.length);
  for (const m of MODULOS) {
    assert.match(m.id, /^[a-z0-9-]+$/);
    assert.equal(new Set(m.etapas.map((e) => e.id)).size, m.etapas.length, m.id);
    assert.ok(m.etapas.some((e) => !e.opcional), m.id + ' precisa de ao menos uma etapa obrigatória');
    for (const e of m.etapas) if (e.tipo === 'multipla' || e.tipo === 'unica') assert.ok(e.opcoes.length >= 2, e.id);
  }
});

test('sanitizarRespostas descarta etapas e opções desconhecidas e corta o tamanho', () => {
  const m = MODULOS.find((x) => x.id === 'modelo-negocio');
  const r = sanitizarRespostas(m, { receita: ['assinatura', 'hack', 'assinatura'], cobranca: 'talvez', canais: 'x'.repeat(5000), outra: 'oi', metas: '   ' });
  assert.deepEqual(r.receita, ['assinatura']);
  assert.equal(r.cobranca, undefined);
  assert.equal(r.canais.length, 1500);
  assert.equal(r.outra, undefined);
  assert.equal(r.metas, undefined);
  assert.deepEqual(etapasPendentes(m, r).map((e) => e.id), ['cobranca', 'metas']);
});

test('normalizarEscopo e calcularOrcamento: a IA não define preço', () => {
  const escopo = normalizarEscopo(ESCOPO);
  assert.equal(escopo.funcionalidades.length, 6); // a repetida saiu
  assert.equal(escopo.funcionalidades[1].complexidade, 'media'); // "média" com acento
  assert.equal(escopo.funcionalidades[2].modulo, null); // módulo inventado
  assert.deepEqual([escopo.funcionalidades[5].complexidade, escopo.funcionalidades[5].prioridade], ['media', 'desejavel']);
  assert.deepEqual(escopo.perguntas, ['Quantos salões no início?']);

  const o = calcularOrcamento(escopo, { valorHora: 100 });
  const H = PARAMETROS.horas;
  const horas = H.baixa + H.media + H.alta;
  assert.equal(o.mvp.horas_funcionalidades, horas);
  assert.equal(o.mvp.horas, horas + Math.ceil(horas * PARAMETROS.basePercentual / 100));
  assert.equal(o.valor_min, o.mvp.horas * 100);
  assert.ok(o.valor_max > o.valor_min);
  assert.equal(o.itens.find((i) => i.prioridade === 'futuro').valor, null);
  assert.equal(o.evolucao.quantidade, 2);
  assert.equal(o.evolucao.horas_base, 0);

  const comPiso = calcularOrcamento(escopo, { valorHora: 20, piso: 3990 });
  assert.equal(comPiso.piso_aplicado, true);
  assert.equal(comPiso.valor_min, 3990);
});

test('montarPrompt leva as respostas com o nome das opções', () => {
  const m = MODULOS.find((x) => x.id === 'operacao-prazo');
  const p = montarPrompt('Agenda Fácil', [{ modulo: m.id, respostas: { plataformas: ['web', 'android'], prazo: '60', existente: 'Tenho a marca.' } }]);
  assert.match(p, /Produto: Agenda Fácil/);
  assert.match(p, /\[operacao-prazo\]/);
  assert.match(p, /Aplicativo Android/);
  assert.match(p, /Em até 60 dias/);
});

test('cliente inicia, salva e envia; quem não é dono não vê nem mexe', async () => {
  assert.equal((await chamar('tok-ana')).jornada, null);
  assert.equal((await chamar('tok-ana', { acao: 'iniciar', titulo: ' ' })).status, 400);
  const ini = await chamar('tok-ana', { acao: 'iniciar', titulo: 'Agenda Fácil' });
  assert.equal(ini.status, 200);
  assert.equal(ini.modulos.length, MODULOS.length);
  assert.equal(banco.notificacoes.filter((n) => n.usuario_id === ADM).length, 1);
  // iniciar de novo não duplica
  assert.equal((await chamar('tok-ana', { acao: 'iniciar', titulo: 'Outra' })).jornada.id, ini.jornada.id);
  assert.equal(banco.jornadas.length, 1);

  const id = ini.jornada.id;
  const m = MODULOS[0];
  assert.equal((await chamar('tok-bia', { acao: 'salvar', jornada_id: id, modulo: m.id, respostas: preencher(m) })).status, 404);
  assert.equal((await chamar('tok-adm', { acao: 'salvar', jornada_id: id, modulo: m.id, respostas: preencher(m) })).status, 403);
  assert.equal((await chamar('tok-ana', { acao: 'salvar', jornada_id: id, modulo: 'nao-existe', respostas: {} })).status, 400);

  await chamar('tok-ana', { acao: 'salvar', jornada_id: id, modulo: m.id, respostas: { problema: 'Fila no salão' } });
  const incompleto = await chamar('tok-ana', { acao: 'enviar', jornada_id: id, modulo: m.id });
  assert.equal(incompleto.status, 400);
  assert.match(incompleto.erro, /Para quem/);

  await chamar('tok-ana', { acao: 'salvar', jornada_id: id, modulo: m.id, respostas: preencher(m) });
  const env = await chamar('tok-ana', { acao: 'enviar', jornada_id: id, modulo: m.id });
  assert.equal(env.modulos[0].status, 'enviado');
  // em revisão: não edita nem reenvia
  assert.equal((await chamar('tok-ana', { acao: 'salvar', jornada_id: id, modulo: m.id, respostas: {} })).status, 409);
  assert.equal((await chamar('tok-ana', { acao: 'enviar', jornada_id: id, modulo: m.id })).status, 409);
  assert.equal((await chamar('tok-bia')).jornada, null);
});

test('equipe lista, pede ajustes (com motivo) e aprova; cliente é avisado', async () => {
  const { jornada } = await chamar('tok-ana', { acao: 'iniciar', titulo: 'Agenda Fácil' });
  const m = MODULOS[0];
  assert.equal((await chamar('tok-adm', { acao: 'avaliar', jornada_id: jornada.id, modulo: m.id, decisao: 'aprovado' })).status, 409); // nem foi enviado
  await chamar('tok-ana', { acao: 'salvar', jornada_id: jornada.id, modulo: m.id, respostas: preencher(m) });
  await chamar('tok-ana', { acao: 'enviar', jornada_id: jornada.id, modulo: m.id });

  const lista = await chamar('tok-adm');
  assert.equal(lista.jornadas.length, 1);
  assert.deepEqual([lista.jornadas[0].cliente.nome, lista.jornadas[0].para_revisar], ['Ana Souza', 1]);
  assert.equal((await chamar('tok-adm', null, '?id=' + jornada.id)).cliente.email, 'ana@ex.com');

  assert.equal((await chamar('tok-ana', { acao: 'avaliar', jornada_id: jornada.id, modulo: m.id, decisao: 'aprovado' })).status, 403);
  assert.equal((await chamar('tok-adm', { acao: 'avaliar', jornada_id: jornada.id, modulo: m.id, decisao: 'ajustes' })).status, 400);
  const aj = await chamar('tok-adm', { acao: 'avaliar', jornada_id: jornada.id, modulo: m.id, decisao: 'ajustes', comentario: 'Detalhe o público.' });
  assert.equal(aj.modulos[0].status, 'ajustes');
  assert.equal(banco.notificacoes.at(-1).usuario_id, ANA);
  assert.equal(banco.notificacoes.at(-1).link, 'jornada.html');

  // com ajustes pedidos, o cliente volta a editar e reenvia
  assert.equal((await chamar('tok-ana', { acao: 'salvar', jornada_id: jornada.id, modulo: m.id, respostas: preencher(m) })).status, 200);
  await chamar('tok-ana', { acao: 'enviar', jornada_id: jornada.id, modulo: m.id });
  const ap = await chamar('tok-adm', { acao: 'avaliar', jornada_id: jornada.id, modulo: m.id, decisao: 'aprovado' });
  assert.equal(ap.modulos[0].status, 'aprovado');
  assert.equal((await chamar('tok-ana', { acao: 'salvar', jornada_id: jornada.id, modulo: m.id, respostas: {} })).status, 409);
});

test('orçamento: só com tudo aprovado, uma vez para o cliente, sem horas nem valor por item', async () => {
  const { jornada } = await chamar('tok-ana', { acao: 'iniciar', titulo: 'Agenda Fácil' });
  assert.equal((await chamar('tok-ana', { acao: 'gerar_orcamento', jornada_id: jornada.id })).status, 409);
  assert.equal((await chamar('tok-adm', { acao: 'gerar_orcamento', jornada_id: jornada.id })).status, 409); // sem respostas
  assert.equal(pedidosIA.length, 0);
  banco.jornadas = []; banco.jornada_modulos = [];

  const j = await jornadaAprovada();
  assert.equal((await chamar('tok-bia', { acao: 'gerar_orcamento', jornada_id: j.id })).status, 404);
  const r = await chamar('tok-ana', { acao: 'gerar_orcamento', jornada_id: j.id });
  assert.equal(r.status, 200);
  assert.equal(pedidosIA.length, 1);
  assert.equal(pedidosIA[0].max_tokens, 3000);
  assert.match(pedidosIA[0].messages[1].content, /Produto: Agenda Fácil/);
  assert.equal(r.jornada.status, 'concluida');

  const o = r.orcamento;
  const horas = PARAMETROS.horas.baixa + PARAMETROS.horas.media + PARAMETROS.horas.alta;
  const total = (horas + Math.ceil(horas * PARAMETROS.basePercentual / 100)) * PARAMETROS.valorHora;
  assert.equal(o.valor_min, Math.max(3990, total));
  assert.equal(o.mvp.quantidade, 3);
  assert.equal(o.itens.length, 6);
  assert.ok(o.itens.every((i) => !('horas' in i) && !('valor' in i)));
  assert.equal(o.parametros, undefined);
  assert.equal(o.mvp.horas, undefined);

  // a equipe vê os números internos e pode gerar de novo; o cliente não
  const visto = await chamar('tok-adm', null, '?id=' + j.id);
  assert.equal(visto.orcamento.parametros.valor_hora, PARAMETROS.valorHora);
  assert.ok(visto.orcamento.itens[0].horas > 0);
  assert.equal((await chamar('tok-ana', { acao: 'gerar_orcamento', jornada_id: j.id })).status, 409);
  assert.equal((await chamar('tok-adm', { acao: 'gerar_orcamento', jornada_id: j.id })).status, 200);
  assert.equal(banco.jornada_orcamentos.length, 2);
});

test('falha da IA não grava orçamento', async () => {
  const j = await jornadaAprovada();
  respostaIA = () => ({ status: 429, corpo: { error: { code: 'rate_limit_exceeded' } } });
  const r = await chamar('tok-ana', { acao: 'gerar_orcamento', jornada_id: j.id });
  assert.equal(r.status, 429);
  assert.equal(r.codigo, 'ia_limite');
  respostaIA = () => ({ status: 200, corpo: { choices: [{ message: { content: '{"resumo":"x","funcionalidades":[]}' } }] } });
  assert.equal((await chamar('tok-ana', { acao: 'gerar_orcamento', jornada_id: j.id })).status, 502);
  assert.equal(banco.jornada_orcamentos.length, 0);
  assert.equal(banco.jornadas[0].status, 'em_andamento');
});

test('cabe no plano Hobby da Vercel: no máximo 12 funções em /api', async () => {
  const { readdirSync } = await import('node:fs');
  assert.ok(readdirSync(new URL('../api', import.meta.url)).length <= 12);
});

test('sem login: 401', async () => {
  assert.equal((await chamar('tok-ninguem')).status, 401);
});
