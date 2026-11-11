// Jornada MVP (/api/notificacoes?rota=jornada) com o Supabase e a IA SIMULADOS (sem internet): trilha completa
// cliente responde -> envia -> equipe aprova/pede ajustes -> orçamento do MVP.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import handler from '../api/notificacoes.js';
import { MODULOS, PARAMETROS, moduloPorId, oportunidade, sanitizarRespostas, etapasPendentes, normalizarEscopo, calcularOrcamento, montarPrompt } from '../lib/jornada.js';

const SUPA = 'https://teste.supabase.co';
Object.assign(process.env, { SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'service', GROQ_API_KEY: 'chave-teste' });
delete process.env.GEMINI_API_KEY;
delete process.env.JORNADA_VALOR_HORA;

const ANA = 'aaaaaaaa-0000-4000-8000-000000000001';
const BIA = 'bbbbbbbb-0000-4000-8000-000000000002';
const ADM = 'cccccccc-0000-4000-8000-000000000003';
const MEN = 'dddddddd-0000-4000-8000-000000000004';
const TOKENS = { 'tok-ana': ANA, 'tok-bia': BIA, 'tok-adm': ADM, 'tok-men': MEN };
let banco, pedidosIA, respostaIA, limiteLiberado;

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
  limiteLiberado = true;
  respostaIA = () => ({ status: 200, corpo: { choices: [{ message: { content: JSON.stringify(ESCOPO) } }], usage: { prompt_tokens: 1200, completion_tokens: 800 } } });
  banco = {
    profiles: [
      { id: ANA, nome: 'Ana Souza', email: 'ana@ex.com', role: 'cliente', cadastro_concluido_em: '2026-01-01T00:00:00Z' },
      { id: BIA, nome: 'Bia', email: 'bia@ex.com', role: 'cliente', cadastro_concluido_em: '2026-01-01T00:00:00Z' },
      { id: ADM, nome: 'Kaike', email: 'adm@ex.com', role: 'admin', cadastro_concluido_em: '2026-01-01T00:00:00Z' },
      { id: MEN, nome: 'Marta Mentora', email: 'marta@ex.com', role: 'cliente', cadastro_concluido_em: '2026-01-01T00:00:00Z' }
    ],
    jornadas: [], jornada_modulos: [], jornada_orcamentos: [], notificacoes: [],
    user_roles: [], mvp_project_shares: [], mvp_budget_generations: [],
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
  if (/\.desc$/.test(params.get('order') || '')) r = r.slice().reverse();
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
  if (u.pathname === '/rest/v1/rpc/consumir_limite') return resposta(200, limiteLiberado);
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

async function chamar(token, corpo, extra = '', { method, origin } = {}) {
  const query = '?rota=jornada' + extra.replace('?', '&');
  const headers = { authorization: 'Bearer ' + token, ...(origin ? { origin } : {}) };
  const req = { method: method || (corpo ? 'POST' : 'GET'), url: '/api/notificacoes' + query, headers, body: corpo || undefined, query: Object.fromEntries(new URLSearchParams(query.slice(1))) };
  const res = { statusCode: 200, cab: {}, setHeader(k, v) { this.cab[k.toLowerCase()] = v; }, end(t) { this.texto = t; } };
  await handler(req, res);
  return { status: res.statusCode, cab: res.cab, ...(res.texto ? JSON.parse(res.texto) : {}) };
}

// respostas mínimas válidas de um módulo
function preencher(m) {
  const r = {};
  for (const e of m.etapas) {
    if (e.tipo === 'mapa') continue;
    r[e.id] = e.tipo === 'multipla' ? [e.opcoes[0].id] : e.tipo === 'unica' ? e.opcoes[0].id
      : e.tipo === 'arvore' ? [[{ texto: 'Agenda no papel', alvo: true }, { texto: 'Falta de sistema simples', alvo: false }]]
        : e.tipo === 'segmentos' ? [{ nome: 'Donos de salão', problemas: 'Faltas', beneficios: 'Agenda cheia', foco: true, objetivos: [{ texto: 'Reduzir faltas', importancia: 9, satisfacao: 2 }] }]
          : 'Resposta de ' + e.titulo;
  }
  return r;
}
async function jornadaAprovada() {
  const { jornada } = await chamar('tok-ana', { acao: 'iniciar', titulo: 'Agenda Fácil' });
  for (const m of MODULOS) {
    await chamar('tok-ana', { acao: 'salvar', jornada_id: jornada.id, modulo: m.id, respostas: preencher(m) });
    await chamar('tok-ana', { acao: 'enviar', jornada_id: jornada.id, modulo: m.id }); // sem mentor: já fica aprovado
  }
  return jornada;
}

test('a trilha é coerente: ids únicos e opções onde o tipo pede', () => {
  assert.equal(new Set(MODULOS.map((m) => m.id)).size, MODULOS.length);
  for (const m of MODULOS) {
    assert.match(m.id, /^[a-z0-9-]+$/);
    assert.equal(new Set(m.etapas.map((e) => e.id)).size, m.etapas.length, m.id);
    assert.ok(m.etapas.some((e) => !e.opcional), m.id + ' precisa de ao menos uma etapa obrigatória');
    for (const e of m.etapas) {
      if (e.tipo === 'multipla' || e.tipo === 'unica') assert.ok(e.opcoes.length >= 2, e.id);
      if (e.tipo === 'mapa') assert.ok(e.opcional && m.etapas.some((x) => x.id === e.fonte && x.tipo === 'segmentos'), e.id);
    }
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

test('árvore do problema e segmentos: limites, linhas vazias fora e notas entre 0 e 10', () => {
  const m = moduloPorId('proposta-valor');
  const r = sanitizarRespostas(m, {
    arvore: [[{ texto: ' Causa A ', alvo: 1 }, { texto: '' }, { texto: 'B' }, { texto: 'C' }, { texto: 'D' }, { texto: 'E' }, { texto: 'F' }], [], [{ texto: 'Z' }], [{ texto: 'quarto ramo' }]],
    segmentos: [
      { nome: 'Cidadão', problemas: 'p', beneficios: 'b', foco: 'sim', objetivos: [{ texto: 'Saber do clima', importancia: 99, satisfacao: -3 }, { texto: ' ' }, { texto: 'Outro', importancia: 'x' }] },
      { nome: '  ', objetivos: [{ texto: 'sem dono' }] }
    ],
    mapa: 'não guarda'
  });
  assert.deepEqual(r.arvore, [[{ texto: 'Causa A', alvo: true }, { texto: 'B', alvo: false }, { texto: 'C', alvo: false }, { texto: 'D', alvo: false }], [{ texto: 'Z', alvo: false }]]);
  assert.equal(r.segmentos.length, 1);
  assert.deepEqual(r.segmentos[0].objetivos, [{ texto: 'Saber do clima', importancia: 10, satisfacao: 0 }, { texto: 'Outro', importancia: 5, satisfacao: 5 }]);
  assert.equal(r.segmentos[0].foco, true);
  assert.equal(r.mapa, undefined);
  assert.equal(oportunidade({ importancia: 10, satisfacao: 0 }), 20);
  assert.equal(oportunidade({ importancia: 4, satisfacao: 9 }), 4);
  assert.ok(!etapasPendentes(m, r).some((e) => e.id === 'mapa' || e.id === 'arvore' || e.id === 'segmentos'));
  const p = montarPrompt('X', [{ modulo: m.id, respostas: r }]);
  assert.match(p, /Causa 1: Causa A \[o produto ataca\] <- porque B/);
  assert.match(p, /Segmento Cidadão \(foco da primeira versão\).*Saber do clima \(importância 10\/10, já atendido 0\/10\)/);
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

test('cliente cria vários projetos, salva e envia; sem mentor o módulo já fica aprovado; quem não é dono não vê nem mexe', async () => {
  const vazio = await chamar('tok-ana');
  assert.equal(vazio.jornada, null);
  assert.deepEqual(vazio.projetos, []);
  assert.equal((await chamar('tok-ana', { acao: 'iniciar', titulo: ' ' })).status, 400);
  const ini = await chamar('tok-ana', { acao: 'iniciar', titulo: 'Agenda Fácil' });
  assert.equal(ini.status, 200);
  assert.equal(ini.papel, 'dono');
  assert.equal(ini.modulos.length, MODULOS.length);
  assert.equal(banco.notificacoes.length, 0); // o admin não revisa mais: nada de aviso para a equipe
  const outro = await chamar('tok-ana', { acao: 'iniciar', titulo: 'Outro projeto' });
  assert.notEqual(outro.jornada.id, ini.jornada.id);
  assert.equal(banco.jornadas.length, 2);
  const lista = await chamar('tok-ana');
  assert.equal(lista.projetos.length, 2);

  const id = ini.jornada.id;
  const m = moduloPorId('proposta-valor');
  assert.equal((await chamar('tok-bia', { acao: 'salvar', jornada_id: id, modulo: m.id, respostas: preencher(m) })).status, 404);
  assert.equal((await chamar('tok-adm', { acao: 'salvar', jornada_id: id, modulo: m.id, respostas: preencher(m) })).status, 403);
  assert.equal((await chamar('tok-ana', { acao: 'salvar', jornada_id: id, modulo: 'nao-existe', respostas: {} })).status, 400);

  await chamar('tok-ana', { acao: 'salvar', jornada_id: id, modulo: m.id, respostas: { problema: 'Fila no salão' } });
  const incompleto = await chamar('tok-ana', { acao: 'enviar', jornada_id: id, modulo: m.id });
  assert.equal(incompleto.status, 400);
  assert.match(incompleto.erro, /Árvore do problema.*Segmentos de clientes/);
  assert.doesNotMatch(incompleto.erro, /Mapa de oportunidades/);

  await chamar('tok-ana', { acao: 'salvar', jornada_id: id, modulo: m.id, respostas: preencher(m) });
  const env = await chamar('tok-ana', { acao: 'enviar', jornada_id: id, modulo: m.id });
  assert.equal(env.modulos.find((x) => x.modulo === m.id).status, 'aprovado');
  assert.equal((await chamar('tok-ana', { acao: 'salvar', jornada_id: id, modulo: m.id, respostas: {} })).status, 409);
  assert.equal((await chamar('tok-ana', { acao: 'enviar', jornada_id: id, modulo: m.id })).status, 409);
  assert.equal((await chamar('tok-bia')).jornada, null);
  assert.equal((await chamar('tok-bia', null, '?id=' + id)).status, 404);
  // o admin não aprova módulo
  assert.equal((await chamar('tok-adm', { acao: 'avaliar', jornada_id: id, modulo: m.id, decisao: 'aprovado' })).status, 403);
});

const MVP = { origin: 'https://mvp.cmkcogit.com.br' };

test('projeto do mvp: cada módulo espera o mentor liberar; só ele aprova ou pede ajustes', async () => {
  const { jornada } = await chamar('tok-ana', { acao: 'iniciar', titulo: 'Agenda Fácil' }, '', MVP);
  assert.equal(banco.jornadas[0].origem, 'mvp');
  // sem mentor ainda: o módulo enviado fica esperando (não é aprovado sozinho)
  const m0 = MODULOS[1];
  await chamar('tok-ana', { acao: 'salvar', jornada_id: jornada.id, modulo: m0.id, respostas: preencher(m0) }, '', MVP);
  const semMentor = await chamar('tok-ana', { acao: 'enviar', jornada_id: jornada.id, modulo: m0.id }, '', MVP);
  assert.deepEqual([semMentor.modulos[1].status, semMentor.exige_mentor, semMentor.tem_mentor], ['enviado', true, false]);
  banco.user_roles.push({ user_id: MEN, role: 'mentor' });
  banco.mvp_project_shares.push({ project_id: jornada.id, owner_user_id: ANA, mentor_user_id: MEN });
  const m = MODULOS[0];
  assert.equal((await chamar('tok-men', { acao: 'avaliar', jornada_id: jornada.id, modulo: m.id, decisao: 'aprovado' })).status, 409); // nem foi enviado
  await chamar('tok-ana', { acao: 'salvar', jornada_id: jornada.id, modulo: m.id, respostas: preencher(m) });
  const env = await chamar('tok-ana', { acao: 'enviar', jornada_id: jornada.id, modulo: m.id });
  assert.equal(env.modulos[0].status, 'enviado');
  assert.equal((await chamar('tok-ana', { acao: 'salvar', jornada_id: jornada.id, modulo: m.id, respostas: {} })).status, 409);

  const visto = await chamar('tok-men', null, '?id=' + jornada.id);
  assert.equal(visto.papel, 'mentor');
  assert.equal(visto.cliente.nome, 'Ana Souza');
  assert.equal(visto.cliente.email, null); // o mentor não recebe o e-mail do dono
  assert.equal((await chamar('tok-men', { acao: 'salvar', jornada_id: jornada.id, modulo: m.id, respostas: {} })).status, 404); // mentor não escreve as respostas

  assert.equal((await chamar('tok-adm', { acao: 'avaliar', jornada_id: jornada.id, modulo: m.id, decisao: 'aprovado' })).status, 403);
  assert.equal((await chamar('tok-ana', { acao: 'avaliar', jornada_id: jornada.id, modulo: m.id, decisao: 'aprovado' })).status, 403);
  assert.equal((await chamar('tok-bia', { acao: 'avaliar', jornada_id: jornada.id, modulo: m.id, decisao: 'aprovado' })).status, 404);
  assert.equal((await chamar('tok-men', { acao: 'avaliar', jornada_id: jornada.id, modulo: m.id, decisao: 'ajustes' })).status, 400);
  const aj = await chamar('tok-men', { acao: 'avaliar', jornada_id: jornada.id, modulo: m.id, decisao: 'ajustes', comentario: 'Detalhe o público.' });
  assert.equal(aj.modulos[0].status, 'ajustes');
  assert.equal(banco.notificacoes.at(-1).usuario_id, ANA);
  assert.equal(banco.notificacoes.at(-1).link, 'jornada.html?id=' + jornada.id);

  assert.equal((await chamar('tok-ana', { acao: 'salvar', jornada_id: jornada.id, modulo: m.id, respostas: preencher(m) })).status, 200);
  await chamar('tok-ana', { acao: 'enviar', jornada_id: jornada.id, modulo: m.id });
  const ap = await chamar('tok-men', { acao: 'avaliar', jornada_id: jornada.id, modulo: m.id, decisao: 'aprovado' });
  assert.equal(ap.modulos[0].status, 'aprovado');

  // a equipe continua vendo tudo (lista com contagem)
  const lista = await chamar('tok-adm');
  assert.deepEqual([lista.jornadas[0].cliente.nome, lista.jornadas[0].aprovados], ['Ana Souza', 1]);

  // sem a permissão de mentor, o compartilhamento não vale
  banco.user_roles = [];
  assert.equal((await chamar('tok-men', null, '?id=' + jornada.id)).status, 404);
});

test('projeto do app: só o cliente; módulo concluído já aprovado mesmo se houver mentor; mentor não aprova', async () => {
  const { jornada } = await chamar('tok-ana', { acao: 'iniciar', titulo: 'Loja' });
  assert.equal(banco.jornadas[0].origem, 'app');
  banco.user_roles.push({ user_id: MEN, role: 'mentor' });
  banco.mvp_project_shares.push({ project_id: jornada.id, owner_user_id: ANA, mentor_user_id: MEN });
  const m = MODULOS[0];
  await chamar('tok-ana', { acao: 'salvar', jornada_id: jornada.id, modulo: m.id, respostas: preencher(m) });
  const env = await chamar('tok-ana', { acao: 'enviar', jornada_id: jornada.id, modulo: m.id });
  assert.deepEqual([env.modulos[0].status, env.exige_mentor], ['aprovado', false]);
  assert.equal((await chamar('tok-men', { acao: 'avaliar', jornada_id: jornada.id, modulo: m.id, decisao: 'ajustes', comentario: 'x' })).status, 409);
});

test('cada site lista os próprios projetos', async () => {
  await chamar('tok-ana', { acao: 'iniciar', titulo: 'Do app' });
  await chamar('tok-ana', { acao: 'iniciar', titulo: 'Do mvp' }, '', MVP);
  assert.deepEqual((await chamar('tok-ana')).projetos.map((p) => p.titulo), ['Do app']);
  assert.deepEqual((await chamar('tok-ana', null, '', MVP)).projetos.map((p) => p.titulo), ['Do mvp']);
});

test('CORS: só o mvp.cmkcogit.com.br recebe permissão; preflight responde 204', async () => {
  const pre = await chamar('tok-ana', null, '', { method: 'OPTIONS', origin: 'https://mvp.cmkcogit.com.br' });
  assert.equal(pre.status, 204);
  assert.equal(pre.cab['access-control-allow-origin'], 'https://mvp.cmkcogit.com.br');
  assert.match(pre.cab['access-control-allow-headers'], /Authorization/);
  const outro = await chamar('tok-ana', null, '', { origin: 'https://malicioso.example' });
  assert.equal(outro.cab['access-control-allow-origin'], undefined);
  assert.equal(outro.cab.vary, 'Origin');
});

test('limite por usuário: criar projetos em excesso devolve 429', async () => {
  limiteLiberado = false;
  const r = await chamar('tok-ana', { acao: 'iniciar', titulo: 'Agenda' });
  assert.equal(r.status, 429);
  assert.equal(banco.jornadas.length, 0);
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
  assert.match(pedidosIA[0].messages[0].content, /Proibido texto genérico/);
  assert.equal(r.jornada.status, 'concluida');
  // tokens reais do resumo grátis ficam registrados (custo zero no plano gratuito da Groq)
  assert.deepEqual([banco.mvp_budget_generations.length, banco.mvp_budget_generations[0].provider, banco.mvp_budget_generations[0].input_tokens, banco.mvp_budget_generations[0].order_id], [1, 'groq', 1200, null]);

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
