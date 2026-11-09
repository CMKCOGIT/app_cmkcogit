// /api/mensagens-ia com o Supabase, a Groq e o Gemini SIMULADOS (sem internet).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarSugestoes, instrucoesSistema } from '../api/mensagens-ia.js';

const SUPA = 'https://teste.supabase.co';
Object.assign(process.env, { SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' });

const CLI = 'aaaaaaaa-0000-4000-8000-000000000001';
const ADM = 'cccccccc-0000-4000-8000-000000000003';
const CONV = 'dddddddd-0000-4000-8000-000000000004';
const TOKENS = { 'tok-cli': CLI, 'tok-adm': ADM };
let banco;
let pedidosGemini;
let respostaGemini;
let pedidosGroq;
let respostaGroq;

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'chave-teste';
  delete process.env.GEMINI_MODEL;
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_MODEL;
  pedidosGemini = [];
  pedidosGroq = [];
  respostaGroq = (modelo) => ({ status: 200, corpo: { choices: [{ message: { content: JSON.stringify({ sugestoes: [
    { titulo: 'Groq', texto: 'Oi, Ana!\nResposta via ' + modelo }
  ] }) } }] } });
  respostaGemini = (modelo) => ({
    status: 200,
    corpo: { candidates: [{ content: { parts: [{ text: JSON.stringify({ sugestoes: [
      { titulo: 'Direta', texto: 'Olá, Ana! Seu site fica pronto em [data].' },
      { titulo: 'Cordial', texto: 'Oi, Ana! Tudo bem? ' + modelo },
      { titulo: 'Vazia', texto: '   ' },
      { titulo: 'Extra', texto: 'quarta' },
      { titulo: 'Extra 2', texto: 'quinta' }
    ] }) }] } }] }
  });
  banco = {
    profiles: [
      { id: CLI, nome: 'Ana Souza', role: 'cliente', cadastro_concluido_em: '2026-01-01T00:00:00Z' },
      { id: ADM, nome: 'Kaike', role: 'admin', cadastro_concluido_em: '2026-01-01T00:00:00Z' }
    ],
    conversas: [{ id: CONV, tipo: 'cliente', cliente_id: CLI, membros: null }],
    mensagens: [
      { conversa_id: CONV, autor_id: CLI, autor_nome: 'Ana Souza', autor_papel: 'cliente', tipo: 'texto', corpo: 'Quando fica pronto?', interna: false, apagada_em: null, created_at: '2026-11-01T10:00:00Z' },
      { conversa_id: CONV, autor_id: ADM, autor_nome: 'Kaike', autor_papel: 'admin', tipo: 'texto', corpo: 'atrasado por causa do domínio', interna: true, apagada_em: null, created_at: '2026-11-01T10:05:00Z' }
    ]
  };
});

const resposta = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (url, op = {}) => {
  const u = new URL(url);
  if (u.hostname === 'api.groq.com') {
    const corpo = JSON.parse(op.body);
    pedidosGroq.push({ modelo: corpo.model, auth: op.headers.Authorization, corpo });
    const r = respostaGroq(corpo.model);
    return resposta(r.status, r.corpo);
  }
  if (u.hostname === 'generativelanguage.googleapis.com') {
    const modelo = decodeURIComponent(u.pathname.split('/').pop().replace(':generateContent', ''));
    pedidosGemini.push({ modelo, chave: op.headers['x-goog-api-key'], corpo: JSON.parse(op.body) });
    const r = respostaGemini(modelo);
    return resposta(r.status, r.corpo);
  }
  if (u.origin !== SUPA) throw new Error('fetch não simulado: ' + url);
  if (u.pathname === '/auth/v1/user') {
    const id = TOKENS[(op.headers.Authorization || '').replace('Bearer ', '')];
    return id ? resposta(200, { id }) : resposta(401, { msg: 'invalid' });
  }
  const tabela = u.pathname.replace('/rest/v1/', '');
  let linhas = banco[tabela].filter((l) => [...u.searchParams].every(([k, v]) => {
    if (['select', 'limit', 'order'].includes(k)) return true;
    if (v === 'is.null') return l[k] == null;
    return String(l[k]) === v.replace(/^eq\./, '');
  }));
  if (u.searchParams.get('order') === 'created_at.desc') linhas = linhas.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return resposta(200, linhas);
};

async function chamar(token, corpo) {
  const handler = (await import('../api/mensagens-ia.js')).default;
  const req = { method: 'POST', url: '/api/mensagens-ia', query: {}, body: corpo, headers: token ? { authorization: 'Bearer ' + token } : {} };
  const res = { statusCode: 200, corpo: '', setHeader() {}, end(t) { this.corpo = t || ''; } };
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.corpo || 'null') };
}

test('sem login 401; cliente não usa a IA (403 somente_admin)', async () => {
  assert.equal((await chamar(null, { acao: 'reescrever', texto: 'oi' })).status, 401);
  const r = await chamar('tok-cli', { acao: 'reescrever', texto: 'oi' });
  assert.equal(r.status, 403);
  assert.equal(r.json.codigo, 'somente_admin');
  assert.equal(pedidosGemini.length, 0);
});

test('sem nenhuma chave de IA: 503 ia_indisponivel, sem chamar ninguém', async () => {
  delete process.env.GEMINI_API_KEY;
  const r = await chamar('tok-adm', { acao: 'reescrever', texto: 'oi' });
  assert.equal(r.status, 503);
  assert.equal(r.json.codigo, 'ia_indisponivel');
  assert.equal(pedidosGemini.length, 0);
});

test('sugerir: manda o histórico (com nota marcada como interna) e devolve até 3 sugestões válidas', async () => {
  const r = await chamar('tok-adm', { acao: 'sugerir', conversa_id: CONV, tom: 'cordial' });
  assert.equal(r.status, 200);
  assert.equal(r.json.sugestoes.length, 3);
  assert.ok(r.json.sugestoes.every((s) => s.texto && s.titulo));
  const p = pedidosGemini[0];
  assert.equal(p.chave, 'chave-teste');
  assert.equal(p.modelo, 'gemini-flash-latest');
  const prompt = p.corpo.contents[0].parts[0].text;
  assert.match(prompt, /Cliente: Quando fica pronto\?/);
  assert.match(prompt, /Nota interna da equipe/);
  assert.match(prompt, /nunca as revele ao cliente/);
  assert.equal(p.corpo.generationConfig.responseMimeType, 'application/json');
});

test('modelo inexistente (404): tenta o próximo da lista', async () => {
  process.env.GEMINI_MODEL = 'modelo-velho';
  respostaGemini = (modelo) => (modelo === 'modelo-velho'
    ? { status: 404, corpo: { error: { message: 'not found' } } }
    : { status: 200, corpo: { candidates: [{ content: { parts: [{ text: '{"sugestoes":[{"titulo":"A","texto":"ok ' + modelo + '"}]}' }] } }] } });
  const r = await chamar('tok-adm', { acao: 'construir', objetivo: 'boas-vindas', canal: 'whatsapp' });
  assert.equal(r.status, 200);
  assert.deepEqual(pedidosGemini.map((x) => x.modelo), ['modelo-velho', 'gemini-flash-latest']);
  assert.match(r.json.sugestoes[0].texto, /gemini-flash-latest/);
  assert.match(pedidosGemini[1].corpo.systemInstruction.parts[0].text, /WhatsApp/);
});

test('pedidos inválidos: 400 sem chamar a IA', async () => {
  assert.equal((await chamar('tok-adm', { acao: 'reescrever', texto: '  ' })).status, 400);
  assert.equal((await chamar('tok-adm', { acao: 'construir' })).status, 400);
  assert.equal((await chamar('tok-adm', { acao: 'sugerir', conversa_id: 'x' })).status, 400);
  assert.equal((await chamar('tok-adm', { acao: 'hackear' })).status, 400);
  assert.equal(pedidosGemini.length, 0);
});

test('limite do Google (429) vira mensagem amigável', async () => {
  respostaGemini = () => ({ status: 429, corpo: {} });
  const r = await chamar('tok-adm', { acao: 'reescrever', texto: 'oi tudo bem' });
  assert.equal(r.status, 429);
  assert.equal(r.json.codigo, 'ia_limite');
});

test('normalizarSugestoes e instruções', () => {
  assert.deepEqual(normalizarSugestoes(null), []);
  assert.equal(normalizarSugestoes({ sugestoes: [{ texto: 'a' }] })[0].titulo, 'Sugestão');
  assert.doesNotMatch(instrucoesSistema('plataforma'), /emoji, só se/);
  assert.match(instrucoesSistema('plataforma'), /Nunca invente fatos/);
});

test('Groq configurada: usa a Groq (modo JSON, prompt com o formato) e não o Gemini', async () => {
  process.env.GROQ_API_KEY = 'gsk-teste';
  const r = await chamar('tok-adm', { acao: 'reescrever', texto: 'oi tudo bem', tom: 'formal' });
  assert.equal(r.status, 200);
  assert.equal(pedidosGemini.length, 0);
  const p = pedidosGroq[0];
  assert.equal(p.auth, 'Bearer gsk-teste');
  assert.equal(p.modelo, 'openai/gpt-oss-120b');
  assert.equal(p.corpo.reasoning_effort, 'low');
  assert.deepEqual(p.corpo.response_format, { type: 'json_object' });
  assert.match(p.corpo.messages[0].content, /JSON/);
  assert.match(p.corpo.messages[1].content, /formal e respeitoso/);
  assert.match(r.json.sugestoes[0].texto, /Resposta via openai\/gpt-oss-120b/);
});

test('Groq: modelo aposentado tenta o próximo; limite (429) cai para o Gemini', async () => {
  process.env.GROQ_API_KEY = 'gsk-teste';
  process.env.GROQ_MODEL = 'modelo-velho';
  respostaGroq = (modelo) => (modelo === 'modelo-velho'
    ? { status: 400, corpo: { error: { code: 'model_decommissioned', message: 'x' } } }
    : { status: 200, corpo: { choices: [{ message: { content: '{"sugestoes":[{"titulo":"A","texto":"ok"}]}' } }] } });
  let r = await chamar('tok-adm', { acao: 'construir', objetivo: 'boas-vindas' });
  assert.equal(r.status, 200);
  assert.deepEqual(pedidosGroq.map((x) => x.modelo), ['modelo-velho', 'openai/gpt-oss-120b']);

  // um modelo no limite: passa para o próximo da Groq
  pedidosGroq = [];
  delete process.env.GROQ_MODEL;
  respostaGroq = (modelo) => (modelo === 'openai/gpt-oss-120b'
    ? { status: 429, corpo: { error: { message: 'rate limit' } } }
    : { status: 200, corpo: { choices: [{ message: { content: '{"sugestoes":[{"titulo":"A","texto":"ok"}]}' } }] } });
  r = await chamar('tok-adm', { acao: 'construir', objetivo: 'boas-vindas' });
  assert.equal(r.status, 200);
  assert.deepEqual(pedidosGroq.map((x) => x.modelo), ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b']);
  assert.equal(pedidosGemini.length, 0);

  // todos os modelos da Groq no limite: usa o Gemini de reserva
  respostaGroq = () => ({ status: 429, corpo: { error: { message: 'rate limit' } } });
  r = await chamar('tok-adm', { acao: 'construir', objetivo: 'boas-vindas' });
  assert.equal(r.status, 200);
  assert.equal(pedidosGemini.length, 1); // reserva

  delete process.env.GEMINI_API_KEY;
  r = await chamar('tok-adm', { acao: 'construir', objetivo: 'boas-vindas' });
  assert.equal(r.status, 429);
  assert.equal(r.json.codigo, 'ia_limite');
});
