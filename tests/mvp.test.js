// Orçamento detalhado do MVP (R$ 30): /api/mvp + webhook do Mercado Pago + geração com Claude + PDF.
// Supabase, Mercado Pago, Storage e Claude SIMULADOS (sem internet). As regras do banco (RLS,
// aplicar_pagamento_mp de verdade) são testadas em tests/sql com Postgres (npm run test:sql).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const SUPA = 'https://teste.supabase.co';
Object.assign(process.env, {
  SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'service', MP_ACCESS_TOKEN: 'APP_USR-teste', MP_WEBHOOK_SECRET: 'segredo',
  APP_URL: 'https://app.cmkcogit.com.br', MVP_ORIGENS: 'https://mvp.cmkcogit.com.br', CLAUDE_MODEL: 'claude-opus-5-5',
  CLAUDE_PRECO_ENTRADA: '4', CLAUDE_PRECO_SAIDA: '20', CLAUDE_PRECO_CACHE_LEITURA: '0.2', CLAUDE_PRECO_CACHE_ESCRITA: '5'
});
delete process.env.PUBLIC_URL;
const { default: notificacoes } = await import('../api/notificacoes.js');
const { default: webhook } = await import('../api/mp-webhook.js');
const { default: checkout } = await import('../api/checkout.js');
const { dependenciasPadrao } = await import('../lib/mvp-geracao.js');
const { custoDoUso } = await import('../lib/custo.js');
const { validarDocumento, ESQUEMA_DOCUMENTO } = await import('../lib/mvp-documento.js');

const ANA = 'aaaaaaaa-0000-4000-8000-000000000001';
const BIA = 'bbbbbbbb-0000-4000-8000-000000000002';
const ADM = 'cccccccc-0000-4000-8000-000000000003';
const MEN = 'dddddddd-0000-4000-8000-000000000004';
const J1 = '11111111-0000-4000-8000-000000000001';
const TOKENS = { 'tok-ana': ANA, 'tok-bia': BIA, 'tok-adm': ADM, 'tok-men': MEN };
const DOC = JSON.parse(readFileSync(new URL('./fixtures/documento-mvp.json', import.meta.url), 'utf8'));
const ORC = {
  resumo: 'Agenda online para salões.', valor_min: 9600, valor_max: 12480,
  mvp: { quantidade: 3, semanas: 6, valor: 9600 }, evolucao: { quantidade: 0 },
  itens: [
    { nome: 'Cadastro e login', descricao: 'Conta', complexidade: 'baixa', prioridade: 'essencial', horas: 16, valor: 1600 },
    { nome: 'Agendamento online', descricao: 'Horário', complexidade: 'media', prioridade: 'essencial', horas: 32, valor: 3200 },
    { nome: 'Pagamento por Pix', descricao: 'Pix', complexidade: 'alta', prioridade: 'essencial', horas: 48, valor: 4800 }
  ]
};

let banco, mp, claude, storage, rpcs;

beforeEach(() => {
  rpcs = [];
  banco = {
    profiles: [
      { id: ANA, nome: 'Ana Souza', email: 'ana@ex.com', role: 'cliente', documento: '52998224725', cadastro_concluido_em: '2026-01-01' },
      { id: BIA, nome: 'Bia', email: 'bia@ex.com', role: 'cliente', documento: null, cadastro_concluido_em: '2026-01-01' },
      { id: ADM, nome: 'Adm', email: 'adm@ex.com', role: 'admin', cadastro_concluido_em: '2026-01-01' },
      { id: MEN, nome: 'Marta', email: 'marta@ex.com', role: 'cliente', documento: '52998224725', cadastro_concluido_em: '2026-01-01' }
    ],
    jornadas: [{ id: J1, cliente_id: ANA, titulo: 'Agenda Salão', status: 'concluida' }],
    jornada_modulos: [{ jornada_id: J1, modulo: 'bases-projeto', status: 'aprovado', respostas: { slogan: 'Agenda para salões' } }],
    jornada_orcamentos: [{ id: '22222222-0000-4000-8000-000000000001', jornada_id: J1, dados: ORC, created_at: '2026-11-01' }],
    mvp_pricing_config: [{ id: 1, price_brl: 30, usd_brl: 5, max_output_tokens: 12000, credit_valid_days: 90, max_tentativas: 3, validade_orcamento_dias: 30 }],
    mvp_budget_orders: [], mvp_budget_generations: [], mvp_mentor_comments: [], mvp_project_shares: [], user_roles: [],
    pagamentos: [], pagamento_eventos: [], notificacoes: [], solicitacoes: [],
    catalogo_precos: [{ id: 'mvp', tipo: 'servico', nome: 'MVP e Produto Digital', preco: 3990, tipo_preco: 'from', ativo: true, complementos_permitidos: [] }]
  };
  mp = { preferencias: [], pagamentos: new Map(), estornos: [] };
  storage = { enviados: [], assinados: [] };
  claude = { pedidos: [], resposta: () => mensagemClaude(DOC) };
  dependenciasPadrao.claude = {
    beta: { messages: { stream: (p) => { claude.pedidos.push(p); return { finalMessage: async () => claude.resposta(p) }; } } }
  };
});

function mensagemClaude(dados, extra = {}) {
  return {
    model: 'claude-opus-5-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text: typeof dados === 'string' ? dados : JSON.stringify(dados) }],
    usage: { input_tokens: 5000, output_tokens: 6000, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
    ...extra
  };
}

// ---------------------------------------------------------------- Supabase simulado
const agoraIso = () => new Date().toISOString();
function filtrar(linhas, params) {
  let r = linhas.filter((l) => [...params].every(([k, v]) => {
    if (['select', 'limit', 'order', 'or'].includes(k)) return true;
    const [op, ...resto] = v.split('.');
    const val = resto.join('.');
    if (op === 'eq') return String(l[k]) === val;
    if (op === 'in') return val.slice(1, -1).split(',').includes(String(l[k]));
    if (op === 'is') return val === 'null' ? l[k] == null : String(l[k]) === val;
    if (op === 'gte') return l[k] != null && String(l[k]) >= val;
    throw new Error('operador não simulado: ' + op);
  }));
  if (/\.desc$/.test(params.get('order') || '')) r = r.slice().reverse();
  if (params.get('limit')) r = r.slice(0, Number(params.get('limit')));
  return r;
}
const pedidoPorId = (id) => banco.mvp_budget_orders.find((o) => o.id === id);

const RPC = {
  consumir_limite: () => true,
  mvp_reservar_geracao({ p_order }) {
    const o = pedidoPorId(p_order);
    if (!o || !o.paid_at || o.status !== 'paid' || o.tentativas >= 3 + o.tentativas_liberadas) return [];
    Object.assign(o, { status: 'generating', tentativas: o.tentativas + 1, gerando_desde: agoraIso(), erro: null });
    return [{ ...o }];
  },
  mvp_concluir_geracao({ p_order, p_path }) {
    const o = pedidoPorId(p_order);
    if (!o || o.status !== 'generating') return [];
    Object.assign(o, { status: 'ready', document_path: p_path, ready_at: agoraIso(), valid_until: '2026-12-11' });
    return [{ ...o }];
  },
  mvp_falhar_geracao({ p_order, p_erro }) {
    const o = pedidoPorId(p_order);
    if (!o || o.status !== 'generating') return [];
    Object.assign(o, { status: o.tentativas >= 3 + o.tentativas_liberadas ? 'failed' : 'paid', erro: p_erro });
    return [{ ...o }];
  },
  mvp_liberar_tentativa({ p_order, p_admin }) {
    const o = pedidoPorId(p_order);
    if (!o || o.status !== 'failed' || !o.paid_at || (!p_admin && o.tentativas_liberadas > 0)) return [];
    Object.assign(o, { status: 'paid', tentativas_liberadas: o.tentativas_liberadas + 1 });
    return [{ ...o }];
  },
  // versão resumida do sql/31 (a de verdade é testada em tests/sql)
  aplicar_pagamento_mp(a) {
    const pg = banco.pagamentos.find((p) => p.id === a.p_pagamento_id);
    if (!pg) return 'pagamento_inexistente';
    if (a.p_status === 'approved') {
      if (a.p_moeda !== 'BRL' || Number(a.p_valor) !== Number(pg.valor)) return 'valor_divergente';
      if (pg.status === 'pago') return 'ja_processado';
      Object.assign(pg, { status: 'pago', mp_payment_id: a.p_mp_payment_id });
      for (const o of banco.mvp_budget_orders) if (o.pagamento_id === pg.id && o.status === 'pending_payment') Object.assign(o, { status: 'paid', mp_payment_id: a.p_mp_payment_id, paid_at: agoraIso() });
      if (pg.credito_order_id) Object.assign(pedidoPorId(pg.credito_order_id), { credito_usado_em: agoraIso() });
      return 'pago';
    }
    if (a.p_status === 'refunded' && pg.status === 'pago') {
      pg.status = 'reembolsado';
      for (const o of banco.mvp_budget_orders) if (o.pagamento_id === pg.id) Object.assign(o, { status: 'refunded', refunded_at: agoraIso() });
      return 'reembolsado';
    }
    return 'sem_alteracao';
  }
};

const PADRAO = {
  mvp_budget_orders: () => ({ status: 'pending_payment', tentativas: 0, tentativas_liberadas: 0, paid_at: null, credito_usado_em: null }),
  pagamentos: () => ({ status: 'pendente', link_pagamento: null, mp_preference_id: null, credito_order_id: null }),
  solicitacoes: () => ({ codigo: 'PLN-2026-0001' })
};
const resposta = (status, corpo) => new Response(corpo === undefined ? null : JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (url, op = {}) => {
  const u = new URL(url);
  const metodo = op.method || 'GET';
  // Mercado Pago
  if (u.hostname === 'api.mercadopago.com') {
    if (u.pathname === '/checkout/preferences') {
      const pref = JSON.parse(op.body);
      mp.preferencias.push(pref);
      return resposta(201, { id: 'pref-' + mp.preferencias.length, init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=' + mp.preferencias.length });
    }
    const est = /^\/v1\/payments\/(\d+)\/refunds$/.exec(u.pathname);
    if (est) {
      mp.estornos.push({ id: est[1], chave: op.headers['X-Idempotency-Key'] });
      mp.pagamentos.get(est[1]).status = 'refunded';
      return resposta(201, { id: 1, status: 'approved' });
    }
    const pg = /^\/v1\/payments\/(\d+)$/.exec(u.pathname);
    if (pg) return mp.pagamentos.has(pg[1]) ? resposta(200, mp.pagamentos.get(pg[1])) : resposta(404, {});
    throw new Error('MP não simulado: ' + url);
  }
  if (u.origin !== SUPA) throw new Error('fetch não simulado: ' + url);
  if (u.pathname === '/auth/v1/user') {
    const id = TOKENS[(op.headers.Authorization || '').replace('Bearer ', '')];
    return id ? resposta(200, { id, email: banco.profiles.find((p) => p.id === id).email }) : resposta(401, {});
  }
  if (u.pathname.startsWith('/storage/v1/object/sign/')) {
    storage.assinados.push(u.pathname);
    return resposta(200, { signedURL: '/object/sign/' + u.pathname.split('/sign/')[1] + '?token=abc' });
  }
  if (u.pathname.startsWith('/storage/v1/object/')) {
    storage.enviados.push({ caminho: u.pathname.replace('/storage/v1/object/', ''), bytes: op.body, tipo: op.headers['Content-Type'] });
    return resposta(200, { Key: 'ok' });
  }
  if (u.pathname.startsWith('/rest/v1/rpc/')) {
    const nome = u.pathname.replace('/rest/v1/rpc/', '');
    rpcs.push(nome);
    if (!RPC[nome]) throw new Error('rpc não simulada: ' + nome);
    return resposta(200, RPC[nome](JSON.parse(op.body || '{}')));
  }
  const tabela = u.pathname.replace('/rest/v1/', '');
  if (!banco[tabela]) throw new Error('tabela não simulada: ' + tabela);
  if (metodo === 'GET') return resposta(200, filtrar(banco[tabela], u.searchParams));
  if (metodo === 'POST') {
    const corpo = JSON.parse(op.body);
    if (tabela === 'mvp_budget_orders' && banco.mvp_budget_orders.some((o) => o.project_id === corpo.project_id && ['pending_payment', 'paid', 'generating'].includes(o.status))) {
      return resposta(409, { code: '23505', message: 'uq_mvp_order_aberto' });
    }
    const nova = { id: crypto.randomUUID(), created_at: agoraIso(), ...(PADRAO[tabela] ? PADRAO[tabela]() : {}), ...corpo };
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

// ---------------------------------------------------------------- chamadas
function criarRes() {
  return { statusCode: 200, cab: {}, setHeader(k, v) { this.cab[k.toLowerCase()] = v; }, end(t) { this.texto = t; } };
}
async function api(token, acao, { corpo, query = '', origin, method } = {}) {
  const url = '/api/notificacoes?rota=mvp&acao=' + acao + query;
  const req = { method: method || (corpo ? 'POST' : 'GET'), url, headers: { authorization: 'Bearer ' + token, ...(origin ? { origin } : {}) }, body: corpo, query: Object.fromEntries(new URL(url, 'http://x').searchParams) };
  const res = criarRes();
  await notificacoes(req, res);
  return { status: res.statusCode, cab: res.cab, ...(res.texto ? JSON.parse(res.texto) : {}) };
}
async function chamarWebhook(dataId, { assinar = true } = {}) {
  const ts = '1700000000';
  const headers = {};
  if (assinar) {
    headers['x-request-id'] = 'req-' + dataId;
    headers['x-signature'] = 'ts=' + ts + ',v1=' + crypto.createHmac('sha256', 'segredo').update(`id:${dataId};request-id:req-${dataId};ts:${ts};`).digest('hex');
  }
  const res = criarRes();
  await webhook({ method: 'POST', url: '/api/mp-webhook?data.id=' + dataId + '&type=payment', headers, body: { type: 'payment', data: { id: dataId } } }, res);
  return { status: res.statusCode, texto: res.texto };
}
// o cliente paga no Mercado Pago (aprovado) e o aviso chega
function mpAprovou(pagamentoId, valor, id = '9001') {
  mp.pagamentos.set(id, { id: Number(id), status: 'approved', transaction_amount: valor, currency_id: 'BRL', external_reference: pagamentoId, payment_method_id: 'pix', payment_type_id: 'bank_transfer', date_approved: agoraIso() });
  return id;
}
async function pedidoPago() {
  const p = await api('tok-ana', 'pedir', { corpo: { projeto_id: J1 } });
  const pg = banco.pagamentos[0];
  const w = await chamarWebhook(mpAprovou(pg.id, 30));
  assert.equal(w.texto, 'pago');
  return p.pedido.id;
}

// ---------------------------------------------------------------- testes
test('pedir: preço do banco (R$ 30), CPF/CNPJ obrigatório, resumo antes, admin não compra, um pagamento por projeto', async () => {
  assert.equal((await api('tok-bia', 'pedir', { corpo: { projeto_id: J1 } })).codigo, 'documento_pendente');
  assert.equal((await api('tok-men', 'pedir', { corpo: { projeto_id: J1 } })).status, 404); // projeto de outra pessoa
  assert.equal((await api('tok-adm', 'pedir', { corpo: { projeto_id: J1 } })).codigo, 'somente_cliente');
  assert.equal((await api('tok-ana', 'pedir')).status, 405); // GET não

  const r = await api('tok-ana', 'pedir', { corpo: { projeto_id: J1, preco: 1 }, origin: 'https://mvp.cmkcogit.com.br' });
  assert.equal(r.status, 200);
  assert.match(r.url, /^https:\/\/www\.mercadopago\.com\.br\//);
  assert.equal(r.pedido.status, 'pending_payment');
  assert.equal(r.cab['access-control-allow-origin'], 'https://mvp.cmkcogit.com.br');
  const pref = mp.preferencias[0];
  assert.equal(pref.items[0].unit_price, 30); // o "preco: 1" do navegador é ignorado
  assert.equal(pref.external_reference, banco.pagamentos[0].id);
  assert.equal(pref.back_urls.success, 'https://mvp.cmkcogit.com.br/projeto.html?id=' + J1 + '&mp=sucesso');
  assert.equal(pref.payer.identification.type, 'CPF');
  assert.equal(banco.mvp_budget_orders[0].orcamento_id, '22222222-0000-4000-8000-000000000001');

  // clicar de novo reaproveita o mesmo pedido e o mesmo link
  const de_novo = await api('tok-ana', 'pedir', { corpo: { projeto_id: J1 } });
  assert.equal(de_novo.url, r.url);
  assert.equal(banco.pagamentos.length, 1);
  assert.equal(banco.mvp_budget_orders.length, 1);

  // preço configurável: mudou no banco, a próxima cobrança acompanha
  banco.mvp_pricing_config[0].price_brl = 45;
  await api('tok-ana', 'pedir', { corpo: { projeto_id: J1 } });
  assert.equal(mp.preferencias.at(-1).items[0].unit_price, 45);
  assert.equal(banco.pagamentos.filter((p) => p.status === 'pendente').length, 1);

  // sem resumo grátis não vende o documento
  banco.jornada_orcamentos = [];
  banco.jornadas.push({ id: '11111111-0000-4000-8000-000000000002', cliente_id: ANA, titulo: 'Outro' });
  assert.equal((await api('tok-ana', 'pedir', { corpo: { projeto_id: '11111111-0000-4000-8000-000000000002' } })).codigo, 'sem_resumo');
});

test('webhook: só com assinatura válida; confirma o pedido e é idempotente; a geração não começa antes do pagamento', async () => {
  const p = await api('tok-ana', 'pedir', { corpo: { projeto_id: J1 } });
  // gerar antes de pagar: nada acontece
  const cedo = await api('tok-ana', 'gerar', { corpo: { pedido_id: p.pedido.id } });
  assert.equal(cedo.pedido.status, 'pending_payment');
  assert.equal(claude.pedidos.length, 0);

  const id = mpAprovou(banco.pagamentos[0].id, 30);
  assert.equal((await chamarWebhook(id, { assinar: false })).status, 401);
  assert.equal(banco.mvp_budget_orders[0].status, 'pending_payment');

  const w = await chamarWebhook(id);
  assert.deepEqual([w.status, w.texto], [200, 'pago']);
  assert.equal(banco.mvp_budget_orders[0].status, 'paid');
  assert.equal((await chamarWebhook(id)).texto, 'ja_processado');
  assert.equal(claude.pedidos.length, 0); // o webhook responde na hora; a geração é disparada depois

  // pagamento com valor diferente não libera
  mp.pagamentos.get(id).transaction_amount = 1;
  banco.pagamentos[0].status = 'pendente';
  banco.mvp_budget_orders[0].status = 'pending_payment';
  assert.equal((await chamarWebhook(id)).texto, 'valor_divergente');
  assert.equal(banco.mvp_budget_orders[0].status, 'pending_payment');
});

test('gerar: Claude com JSON por schema, teto de tokens e cache; custo real gravado; PDF no bucket privado; só o dono baixa', async () => {
  const pedidoId = await pedidoPago();
  assert.equal((await api('tok-bia', 'gerar', { corpo: { pedido_id: pedidoId } })).status, 404);

  const g = await api('tok-ana', 'gerar', { corpo: { pedido_id: pedidoId } });
  assert.equal(g.status, 200);
  assert.equal(g.pedido.status, 'ready');
  assert.equal(g.pedido.tem_pdf, true);

  const req = claude.pedidos[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.max_tokens, 12000); // mvp_pricing_config.max_output_tokens
  assert.deepEqual(req.output_config.format, { type: 'json_schema', schema: ESQUEMA_DOCUMENTO });
  assert.equal(req.output_config.effort, 'medium');
  assert.deepEqual(req.system[0].cache_control, { type: 'ephemeral' });
  assert.equal(req.fallbacks, 'default');
  assert.match(req.messages[0].content, /Agendamento online/);
  assert.doesNotMatch(req.messages[0].content, /1600|3200|4800/); // horas/valor por item não vão para a IA

  const custo = banco.mvp_budget_generations[0];
  // 5000*4 + 6000*20 + 1000*0.2 = 140200 / 1e6 = US$ 0,1402 -> x 5 (cotação do banco) = R$ 0,701
  assert.deepEqual([custo.provider, custo.input_tokens, custo.output_tokens, custo.cache_read_tokens, custo.cost_usd, custo.cost_brl, custo.sucesso],
    ['anthropic', 5000, 6000, 1000, 0.1402, 0.701, true]);
  assert.equal(custo.order_id, pedidoId);

  assert.equal(storage.enviados.length, 1);
  assert.equal(storage.enviados[0].caminho, 'orcamentos-mvp/' + ANA + '/' + pedidoId + '.pdf');
  assert.equal(Buffer.from(storage.enviados[0].bytes).subarray(0, 5).toString(), '%PDF-');
  assert.ok(banco.notificacoes.some((n) => n.usuario_id === ANA && /pronto/.test(n.titulo)));

  // gerar de novo não chama a IA outra vez
  await api('tok-ana', 'gerar', { corpo: { pedido_id: pedidoId } });
  assert.equal(claude.pedidos.length, 1);

  const pdf = await api('tok-ana', 'pdf', { query: '&pedido_id=' + pedidoId });
  assert.match(pdf.url, /^https:\/\/teste\.supabase\.co\/storage\/v1\/object\/sign\/orcamentos-mvp\/.+token=abc&download=orcamento-mvp-/);
  assert.equal((await api('tok-bia', 'pdf', { query: '&pedido_id=' + pedidoId })).status, 404);
  assert.equal((await api('tok-men', 'pdf', { query: '&pedido_id=' + pedidoId })).status, 404); // mentor não baixa o PDF
  assert.equal((await api('tok-adm', 'pdf', { query: '&pedido_id=' + pedidoId })).status, 200);
});

test('falhas: nova tentativa automática até 3; depois "failed", o cliente libera 1 vez; o custo das falhas também conta', async () => {
  const pedidoId = await pedidoPago();
  claude.resposta = () => mensagemClaude('isto não é json');
  for (const esperado of ['paid', 'paid', 'failed']) {
    const r = await api('tok-ana', 'gerar', { corpo: { pedido_id: pedidoId } });
    assert.equal(r.pedido.status, esperado);
  }
  assert.equal(banco.mvp_budget_generations.length, 3);
  assert.ok(banco.mvp_budget_generations.every((g) => g.sucesso === false && g.output_tokens === 6000));
  assert.match(banco.mvp_budget_orders[0].erro, /ia_formato/);
  assert.ok(banco.notificacoes.some((n) => /Não conseguimos/.test(n.titulo)));

  const st = await api('tok-ana', 'status', { query: '&projeto_id=' + J1 });
  assert.equal(st.pedido.pode_tentar_novamente, true);

  // recusa de segurança e documento cortado também viram falha (não PDF quebrado)
  claude.resposta = () => mensagemClaude(DOC, { stop_reason: 'refusal' });
  const t1 = await api('tok-ana', 'tentar_novamente', { corpo: { pedido_id: pedidoId } });
  assert.equal(t1.pedido.status, 'failed');
  assert.match(banco.mvp_budget_orders[0].erro, /ia_recusa/);
  assert.equal((await api('tok-ana', 'tentar_novamente', { corpo: { pedido_id: pedidoId } })).codigo, 'sem_tentativas');

  // o admin ainda pode reprocessar
  claude.resposta = () => mensagemClaude(DOC);
  const adm = await api('tok-adm', 'admin_reprocessar', { corpo: { pedido_id: pedidoId } });
  assert.equal(adm.pedido.status, 'ready');
});

test('documento genérico ou incompleto não vira PDF', async () => {
  const pedidoId = await pedidoPago();
  claude.resposta = () => mensagemClaude({ ...DOC, premissas: [{ premissa: 'Prazos podem variar.', base: 'geral' }], pontos_de_atencao: [] });
  const r = await api('tok-ana', 'gerar', { corpo: { pedido_id: pedidoId } });
  assert.equal(r.pedido.status, 'paid'); // volta para nova tentativa
  assert.match(banco.mvp_budget_orders[0].erro, /ia_incompleta.*premissas.*pontos de atenção/);
  assert.equal(storage.enviados.length, 0);
});

test('estorno pelo admin: chama o Mercado Pago com chave de idempotência e o pedido vira refunded', async () => {
  const pedidoId = await pedidoPago();
  claude.resposta = () => mensagemClaude('{}');
  for (let i = 0; i < 3; i++) await api('tok-ana', 'gerar', { corpo: { pedido_id: pedidoId } });
  assert.equal(banco.mvp_budget_orders[0].status, 'failed');
  assert.equal((await api('tok-ana', 'admin_estornar', { corpo: { pedido_id: pedidoId } })).status, 403);
  const r = await api('tok-adm', 'admin_estornar', { corpo: { pedido_id: pedidoId } });
  assert.equal(r.pedido.status, 'refunded');
  assert.deepEqual(mp.estornos, [{ id: '9001', chave: 'mvp-estorno-' + pedidoId }]);
  // o aviso "refunded" do Mercado Pago depois não muda nada
  assert.equal((await chamarWebhook('9001')).texto, 'sem_alteracao');
});

test('construir: solicitação a partir do orçamento salvo (idempotente) e crédito de R$ 30 abatido na contratação', async () => {
  const pedidoId = await pedidoPago();
  await api('tok-ana', 'gerar', { corpo: { pedido_id: pedidoId } });
  assert.equal((await api('tok-bia', 'construir', { corpo: { projeto_id: J1 } })).status, 404);

  const c = await api('tok-ana', 'construir', { corpo: { projeto_id: J1 } });
  assert.equal(c.nova, true);
  const s = banco.solicitacoes[0];
  assert.deepEqual([s.origem, s.jornada_id, s.status, s.valor_final, s.ref_site], ['jornada_mvp', J1, 'em_validacao', null, 'jornada-' + J1]);
  assert.equal(s.resumo.jornada.valor_min, 9600);
  assert.deepEqual(s.resumo.jornada.funcionalidades, ['Cadastro e login', 'Agendamento online', 'Pagamento por Pix']);
  assert.ok(banco.notificacoes.some((n) => n.usuario_id === ADM && n.link === 'admin.html'));
  assert.equal((await api('tok-ana', 'construir', { corpo: { projeto_id: J1 } })).nova, false);
  assert.equal(banco.solicitacoes.length, 1);

  const st = await api('tok-ana', 'status', { query: '&projeto_id=' + J1 });
  assert.equal(st.credito.valor, 30);

  // a equipe valida e define R$ 10.000; o checkout cobra R$ 9.970 e liga o crédito
  Object.assign(s, { status: 'aguardando_pagamento', valor_final: 10000 });
  const res = criarRes();
  await checkout({ method: 'POST', headers: { authorization: 'Bearer tok-ana' }, body: { solicitacao_id: s.id } }, res);
  assert.equal(res.statusCode, 200);
  const cobranca = banco.pagamentos.find((p) => p.solicitacao_id === s.id);
  assert.deepEqual([cobranca.valor, cobranca.credito_mvp, cobranca.credito_order_id], [9970, 30, pedidoId]);
  assert.equal(mp.preferencias.at(-1).items[0].unit_price, 9970);

  // pagou a contratação: crédito consumido, não aparece mais
  await chamarWebhook(mpAprovou(cobranca.id, 9970, '9002'));
  assert.ok(banco.mvp_budget_orders[0].credito_usado_em);
  assert.equal((await api('tok-ana', 'status', { query: '&projeto_id=' + J1 })).credito, null);
});

test('crédito vence depois de credit_valid_days', async () => {
  const pedidoId = await pedidoPago();
  pedidoPorId(pedidoId).paid_at = new Date(Date.now() - 91 * 86400000).toISOString();
  assert.equal((await api('tok-ana', 'status', { query: '&projeto_id=' + J1 })).credito, null);
});

test('admin_pedidos só para admin, com custo somado', async () => {
  const pedidoId = await pedidoPago();
  await api('tok-ana', 'gerar', { corpo: { pedido_id: pedidoId } });
  assert.equal((await api('tok-ana', 'admin_pedidos')).status, 403);
  const r = await api('tok-adm', 'admin_pedidos');
  assert.equal(r.pedidos[0].custo_brl, 0.701);
  assert.equal(r.pedidos[0].titulo, 'Agenda Salão');
});

test('custoDoUso: usa o preço do modelo de cada tentativa (fallback) e a cotação informada', () => {
  const precos = (m) => (m === 'reserva' ? { entrada: 5, saida: 25, cache_leitura: 0.5, cache_escrita: 6.25 } : { entrada: 4, saida: 20, cache_leitura: 0.2, cache_escrita: 5 });
  const c = custoDoUso({
    input_tokens: 0, output_tokens: 0,
    iterations: [{ model: 'principal', input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      { model: 'reserva', input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }]
  }, 'principal', { precos, usdBrl: 5 });
  // (1000*4 + 100*20) + (1000*5 + 1000*25) = 6000 + 30000 = 36000 / 1e6
  assert.deepEqual([c.input_tokens, c.output_tokens, c.cost_usd, c.cost_brl], [2000, 1100, 0.036, 0.18]);
});

test('validarDocumento: funcionalidades só da lista do servidor; itens inventados ficam fora', () => {
  const doc = validarDocumento({ ...DOC, funcionalidades: [...DOC.funcionalidades, { nome: 'App de loja', detalhamento: 'novo', criterios_aceite: [] }] }, ORC);
  assert.deepEqual(doc.funcionalidades.map((f) => f.nome), ['Cadastro e login', 'Agendamento online', 'Pagamento por Pix']);
  assert.equal(doc.funcionalidades[1].criterios_aceite.length, 1);
  assert.ok(!JSON.stringify(doc).includes('App de loja'));
});

test('CORS em /api/mvp: preflight do mvp ok; outra origem sem permissão', async () => {
  const pre = await api('tok-ana', 'pedir', { method: 'OPTIONS', origin: 'https://mvp.cmkcogit.com.br' });
  assert.equal(pre.status, 204);
  assert.equal(pre.cab['access-control-allow-methods'], 'GET, POST, OPTIONS');
  const fora = await api('tok-ana', 'config', { origin: 'https://evil.example' });
  assert.equal(fora.cab['access-control-allow-origin'], undefined);
  assert.equal(fora.preco, 30);
});

test('modo de teste: só os e-mails da lista recebem sem pagar; os outros continuam pagando', async () => {
  process.env.MVP_TESTE_SEM_PAGAMENTO = ' ANA@ex.com , outro@ex.com';
  try {
    const r = await api('tok-ana', 'pedir', { corpo: { projeto_id: J1 } });
    assert.deepEqual([r.status, r.teste, r.url, r.pedido.status], [200, true, null, 'paid']);
    assert.equal(mp.preferencias.length, 0);           // nada de Mercado Pago
    assert.equal(banco.pagamentos.length, 0);          // nenhuma cobrança criada
    assert.equal(banco.mvp_budget_orders[0].mp_payment_id, 'TESTE-SEM-PAGAMENTO');
    assert.equal(banco.mvp_budget_orders[0].price_brl, 0.01);
    const g = await api('tok-ana', 'gerar', { corpo: { pedido_id: r.pedido.id } });
    assert.equal(g.pedido.status, 'ready');            // a geração roda normalmente
    // fora da lista: paga
    banco.jornadas.push({ id: '11111111-0000-4000-8000-000000000009', cliente_id: MEN, titulo: 'Da Marta' });
    banco.jornada_orcamentos.push({ id: 'o9', jornada_id: '11111111-0000-4000-8000-000000000009', dados: ORC, created_at: '2026-11-01' });
    const pago = await api('tok-men', 'pedir', { corpo: { projeto_id: '11111111-0000-4000-8000-000000000009' } });
    assert.ok(pago.url && !pago.teste);
  } finally {
    delete process.env.MVP_TESTE_SEM_PAGAMENTO;
  }
});
