// Rota da Jornada MVP (trilha de módulos + resumo do orçamento do MVP gerado com IA). Ver lib/jornada.js.
// Endereço: /api/notificacoes?rota=jornada (também /api/jornada pelo vercel.json) — não é um arquivo em
// /api porque o plano Hobby da Vercel aceita no máximo 12 funções; api/notificacoes.js repassa para cá.
// Usada pelo app e pelo mvp.cmkcogit.com.br (CORS em lib/cors.js).
//   GET                      cliente: o projeto mais recente + a lista dos seus projetos · admin: lista de todos
//   GET &id=<jornada>        dono, admin ou MENTOR com compartilhamento: um projeto
//   POST { acao: 'iniciar', titulo }                                   cliente: cria um projeto (pode ter vários)
//   POST { acao: 'salvar', jornada_id, modulo, respostas }             dono: guarda as respostas do módulo
//   POST { acao: 'enviar', jornada_id, modulo }                        dono: envia o módulo. Projeto do app (origem 'app'):
//                                                                      já fica aprovado (só o cliente, orçamento automático).
//                                                                      Projeto do mvp (origem 'mvp'): espera o MENTOR liberar.
//   POST { acao: 'avaliar', jornada_id, modulo, decisao, comentario }  MENTOR do projeto: 'aprovado' | 'ajustes'
//   POST { acao: 'gerar_orcamento', jornada_id }                       resumo GRÁTIS: IA (Groq) lê as respostas; o servidor calcula o valor
// O dono gera o resumo com todos os módulos aprovados, uma única vez; a equipe pode gerar uma prévia.
// O documento detalhado (pago, Claude + PDF) fica em lib/mvp-rota.js.
// Toda escrita passa por aqui (service_role): as tabelas não têm política de escrita no RLS.
import { criarDb } from './supabase.js';
import { json, erro, lerCorpo, exigirUsuario, exigirCadastroCompleto, registrarErro, UUID } from './http.js';
import { gerarJson, ErroIA } from './ia.js';
import { createNotification } from './notificacoes.js';
import { aplicarCors, origemPermitida } from './cors.js';
import { dentroDoLimite } from './limite.js';
import { custoDoUso } from './custo.js';
import {
  MODULOS, PARAMETROS, LIMITE_TITULO, moduloPorId, limpar, sanitizarRespostas, etapasPendentes,
  montarPrompt, normalizarEscopo, calcularOrcamento, valorHora,
  SISTEMA_ORCAMENTO, ESQUEMA_ORCAMENTO, FORMATO_ORCAMENTO
} from './jornada.js';

class Recusa extends Error {
  constructor(status, mensagem, codigo) { super(mensagem); this.status = status; this.codigo = codigo; }
}

const agora = () => new Date().toISOString();
const link = (id) => 'jornada.html?id=' + id;
const MAX_PROJETOS = 20;

// Aviso no sino: nunca derruba a ação principal.
async function avisar(db, destinatarios, n) {
  await Promise.all(destinatarios.map((id) => createNotification(db, { ...n, destinatarioId: id, tipo: 'jornada' })
    .catch((e) => registrarErro('jornada:aviso', e))));
}
// Mentores ATIVOS do projeto (compartilhamento + permissão de mentor)
async function mentoresDo(db, jornadaId) {
  const shares = await db.select('mvp_project_shares', { select: 'mentor_user_id', project_id: 'eq.' + jornadaId });
  if (!shares.length) return [];
  const ativos = await db.select('user_roles', { select: 'user_id', role: 'eq.mentor', user_id: 'in.(' + shares.map((x) => x.mentor_user_id).join(',') + ')' });
  return ativos.map((x) => x.user_id);
}
async function limitar(db, usuarioId, acao) {
  if (!(await dentroDoLimite(db, usuarioId, acao))) throw new Recusa(429, 'Muitas ações em pouco tempo. Aguarde alguns minutos.', 'limite');
}

// O cliente vê o escopo, a faixa de valor e o prazo; horas e valor por item ficam só para a equipe.
function orcamentoPublico(linha, admin) {
  const d = linha.dados || {};
  const comum = { id: linha.id, created_at: linha.created_at };
  if (admin) return { ...comum, ...d };
  const fase = (f) => (f ? { quantidade: f.quantidade, valor: f.valor, semanas: f.semanas } : null);
  return {
    ...comum, resumo: d.resumo, premissas: d.premissas, riscos: d.riscos, perguntas: d.perguntas,
    itens: (d.itens || []).map(({ nome, descricao, complexidade, prioridade, modulo }) => ({ nome, descricao, complexidade, prioridade, modulo })),
    mvp: fase(d.mvp), evolucao: fase(d.evolucao), valor_min: d.valor_min, valor_max: d.valor_max
  };
}

async function carregar(db, jornada, admin) {
  const [modulos, orcamentos] = await Promise.all([
    db.select('jornada_modulos', { select: '*', jornada_id: 'eq.' + jornada.id }),
    db.select('jornada_orcamentos', { select: '*', jornada_id: 'eq.' + jornada.id, order: 'created_at.desc', limit: '1' })
  ]);
  const porId = new Map(modulos.map((m) => [m.modulo, m]));
  return {
    jornada: { id: jornada.id, titulo: jornada.titulo, status: jornada.status, origem: jornada.origem || 'app', created_at: jornada.created_at, updated_at: jornada.updated_at },
    modulos: MODULOS.map((def) => {
      const m = porId.get(def.id) || {};
      return {
        modulo: def.id, status: m.status || 'aberto', respostas: m.respostas || {}, comentario: m.comentario || null,
        enviado_em: m.enviado_em || null, avaliado_em: m.avaliado_em || null
      };
    }),
    orcamento: orcamentos[0] ? orcamentoPublico(orcamentos[0], admin) : null
  };
}

// A jornada do pedido, já conferindo de quem é. comMentor: o mentor com compartilhamento também acessa.
async function jornadaDe(db, id, usuario, admin, { comMentor = false } = {}) {
  if (!UUID.test(id || '')) throw new Recusa(400, 'Projeto inválido.');
  const j = await db.um('jornadas', { select: '*', id: 'eq.' + id });
  if (j && (admin || j.cliente_id === usuario.id)) return j;
  if (j && comMentor && (await mentoresDo(db, j.id)).includes(usuario.id)) return Object.assign(j, { _mentor: true });
  throw new Recusa(404, 'Projeto não encontrado.');
}
// Cada site lista os próprios projetos: o mvp os de origem 'mvp', o app os de origem 'app'
const origemDa = (req) => (origemPermitida(req) ? 'mvp' : 'app');
async function listaDoCliente(db, usuarioId, origem) {
  return db.select('jornadas', { select: 'id,titulo,status,origem,created_at,updated_at', cliente_id: 'eq.' + usuarioId, origem: 'eq.' + origem, order: 'updated_at.desc', limit: String(MAX_PROJETOS) });
}
const exigeMentor = (j) => j.origem === 'mvp';
async function linhaDoModulo(db, jornada, moduloId) {
  const def = moduloPorId(moduloId);
  if (!def) throw new Recusa(400, 'Módulo inválido.');
  const linha = await db.um('jornada_modulos', { select: '*', jornada_id: 'eq.' + jornada.id, modulo: 'eq.' + def.id })
    || await db.inserir('jornada_modulos', { jornada_id: jornada.id, modulo: def.id });
  return { def, linha };
}
const tocar = (db, jornada, campos = {}) => db.atualizar('jornadas', { id: 'eq.' + jornada.id }, { updated_at: agora(), ...campos });

async function listar(db) {
  const jornadas = await db.select('jornadas', { select: '*', order: 'updated_at.desc', limit: '200' });
  if (!jornadas.length) return [];
  const ids = jornadas.map((j) => j.id).join(',');
  const [modulos, orcamentos, clientes] = await Promise.all([
    db.select('jornada_modulos', { select: 'jornada_id,status', jornada_id: 'in.(' + ids + ')' }),
    db.select('jornada_orcamentos', { select: 'jornada_id', jornada_id: 'in.(' + ids + ')' }),
    db.select('profiles', { select: 'id,nome,email', id: 'in.(' + [...new Set(jornadas.map((j) => j.cliente_id))].join(',') + ')' })
  ]);
  const nomes = new Map(clientes.map((c) => [c.id, c]));
  const comOrcamento = new Set(orcamentos.map((o) => o.jornada_id));
  return jornadas.map((j) => {
    const meus = modulos.filter((m) => m.jornada_id === j.id);
    const conta = (st) => meus.filter((m) => m.status === st).length;
    const c = nomes.get(j.cliente_id) || {};
    return {
      id: j.id, titulo: j.titulo, status: j.status, updated_at: j.updated_at,
      cliente: { nome: c.nome || 'Cliente', email: c.email || null },
      total: MODULOS.length, aprovados: conta('aprovado'), para_revisar: conta('enviado'), em_ajuste: conta('ajustes'),
      tem_orcamento: comOrcamento.has(j.id)
    };
  });
}

const ACOES = {
  async iniciar({ db, usuario, admin, corpo, req }) {
    if (admin) throw new Recusa(403, 'A jornada é iniciada pelo cliente.', 'somente_cliente');
    const titulo = limpar(corpo.titulo, LIMITE_TITULO);
    if (titulo.length < 2) throw new Recusa(400, 'Dê um nome ao seu produto ou ideia.');
    await limitar(db, usuario.id, 'jornada_iniciar');
    const origem = origemDa(req);
    if ((await listaDoCliente(db, usuario.id, origem)).length >= MAX_PROJETOS) throw new Recusa(409, 'Você chegou ao limite de ' + MAX_PROJETOS + ' projetos.');
    return db.inserir('jornadas', { cliente_id: usuario.id, titulo, origem });
  },

  async salvar({ db, usuario, admin, corpo }) {
    if (admin) throw new Recusa(403, 'As respostas são do cliente.', 'somente_cliente');
    const j = await jornadaDe(db, corpo.jornada_id, usuario, false);
    await limitar(db, usuario.id, 'jornada_salvar');
    const { def, linha } = await linhaDoModulo(db, j, corpo.modulo);
    if (linha.status === 'enviado') throw new Recusa(409, 'Este módulo está em revisão pelo seu mentor. Aguarde o retorno.');
    if (linha.status === 'aprovado') throw new Recusa(409, 'Este módulo já foi aprovado.');
    await db.atualizar('jornada_modulos', { id: 'eq.' + linha.id }, { respostas: sanitizarRespostas(def, corpo.respostas), updated_at: agora() });
    await tocar(db, j);
    return j;
  },

  async enviar({ db, usuario, admin, corpo }) {
    if (admin) throw new Recusa(403, 'Quem envia o módulo é o cliente.', 'somente_cliente');
    const j = await jornadaDe(db, corpo.jornada_id, usuario, false);
    const { def, linha } = await linhaDoModulo(db, j, corpo.modulo);
    if (linha.status === 'enviado' || linha.status === 'aprovado') throw new Recusa(409, 'Este módulo já foi enviado.');
    const falta = etapasPendentes(def, linha.respostas || {});
    if (falta.length) throw new Recusa(400, 'Falta responder: ' + falta.map((e) => e.titulo).join(', ') + '.');
    // mvp: o mentor libera cada fase; app: só o cliente, o módulo completo já fica aprovado
    await db.atualizar('jornada_modulos', { id: 'eq.' + linha.id }, exigeMentor(j)
      ? { status: 'enviado', enviado_em: agora(), updated_at: agora() }
      : { status: 'aprovado', enviado_em: agora(), avaliado_em: agora(), avaliado_por: null, comentario: null, updated_at: agora() });
    await tocar(db, j);
    return j;
  },

  async avaliar({ db, usuario, admin, corpo }) {
    if (admin) throw new Recusa(403, 'A revisão dos módulos é do mentor do projeto.', 'somente_mentor');
    const j = await jornadaDe(db, corpo.jornada_id, usuario, false, { comMentor: true });
    if (!j._mentor) throw new Recusa(403, 'Só o mentor com quem o projeto foi compartilhado revisa os módulos.', 'somente_mentor');
    if (!exigeMentor(j)) throw new Recusa(409, 'Este projeto é do app: os módulos não passam por mentor.');
    const { def, linha } = await linhaDoModulo(db, j, corpo.modulo);
    const decisao = corpo.decisao === 'aprovado' ? 'aprovado' : corpo.decisao === 'ajustes' ? 'ajustes' : null;
    if (!decisao) throw new Recusa(400, 'Escolha aprovar ou pedir ajustes.');
    if (linha.status !== 'enviado') throw new Recusa(409, linha.status === 'aprovado' ? 'Este módulo já foi aprovado.' : 'Este módulo ainda não foi enviado para revisão.');
    const comentario = limpar(corpo.comentario, 1000);
    if (decisao === 'ajustes' && comentario.length < 3) throw new Recusa(400, 'Escreva o que precisa ser ajustado.');
    await db.atualizar('jornada_modulos', { id: 'eq.' + linha.id }, {
      status: decisao, comentario: comentario || null, avaliado_em: agora(), avaliado_por: usuario.id, updated_at: agora()
    });
    await tocar(db, j);
    await avisar(db, [j.cliente_id], decisao === 'aprovado'
      ? { titulo: 'Seu mentor aprovou: ' + def.nome, mensagem: comentario || 'Pode seguir para o próximo módulo.', link: link(j.id) }
      : { titulo: 'Seu mentor pediu ajustes: ' + def.nome, mensagem: comentario, link: link(j.id) });
    return j;
  },

  async gerar_orcamento({ db, usuario, admin, corpo }) {
    const j = await jornadaDe(db, corpo.jornada_id, usuario, admin);
    await limitar(db, usuario.id, 'jornada_gerar');
    const modulos = await db.select('jornada_modulos', { select: 'modulo,status,respostas', jornada_id: 'eq.' + j.id });
    if (!admin) {
      const aprovados = modulos.filter((m) => m.status === 'aprovado' && moduloPorId(m.modulo)).length;
      if (aprovados < MODULOS.length) throw new Recusa(409, 'O orçamento é liberado quando todos os módulos forem aprovados.');
      const jaTem = await db.um('jornada_orcamentos', { select: 'id', jornada_id: 'eq.' + j.id });
      if (jaTem) throw new Recusa(409, 'O resumo do orçamento já foi gerado. Para refazer, fale com a equipe.');
    } else if (!modulos.some((m) => Object.keys(m.respostas || {}).length)) {
      throw new Recusa(409, 'Ainda não há respostas para a IA ler.');
    }

    const usos = [];
    const bruto = await gerarJson({
      sistema: SISTEMA_ORCAMENTO, prompt: montarPrompt(j.titulo, modulos),
      esquema: ESQUEMA_ORCAMENTO, formatoJson: FORMATO_ORCAMENTO, maxTokens: 3000, aoUsar: (u) => usos.push(u)
    });
    // custo real do resumo grátis (sem pedido ligado): entra na conta de margem
    for (const u of usos) {
      const precoGratis = () => ({ entrada: Number(process.env.GROQ_PRECO_ENTRADA) || 0, saida: Number(process.env.GROQ_PRECO_SAIDA) || 0, cache_leitura: 0, cache_escrita: 0 });
      const c = custoDoUso(u.usage, u.model, { precos: precoGratis, usdBrl: Number(process.env.USD_BRL) || 5.4 });
      await db.inserir('mvp_budget_generations', {
        order_id: null, provider: u.provider, model: u.model, input_tokens: c.input_tokens, output_tokens: c.output_tokens,
        cost_usd: c.cost_usd, cost_brl: c.cost_brl, usd_brl: c.usd_brl
      }).catch((e) => registrarErro('jornada:custo', e));
    }
    const escopo = normalizarEscopo(bruto);
    if (escopo.funcionalidades.length < 1) throw new ErroIA('ia_vazia', 'A IA não conseguiu montar o escopo desta vez. Tente de novo.');

    const mvp = await db.um('catalogo_precos', { select: 'preco,ativo', id: 'eq.mvp' }).catch(() => null);
    const calculo = calcularOrcamento(escopo, { valorHora: valorHora(), piso: mvp && mvp.ativo !== false ? mvp.preco : null });
    const dados = { resumo: escopo.resumo, premissas: escopo.premissas, riscos: escopo.riscos, perguntas: escopo.perguntas, ...calculo };
    await db.inserir('jornada_orcamentos', {
      jornada_id: j.id, dados, valor_min: calculo.valor_min, valor_max: calculo.valor_max, horas: calculo.mvp.horas, gerado_por: usuario.id
    });
    await tocar(db, j, { status: 'concluida' });
    if (admin) {
      await avisar(db, [j.cliente_id], {
        titulo: 'Resumo do orçamento do MVP pronto: ' + j.titulo, mensagem: 'O escopo e a estimativa do MVP já podem ser vistos.', link: link(j.id)
      });
    }
    return j;
  }
};

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') return erro(res, 405, 'Método não permitido.');

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('jornada:config', e); return erro(res, 500, 'Indisponível no momento.'); }

  const usuario = await exigirUsuario(req, res, db);
  if (!usuario) return;
  const perfil = await exigirCadastroCompleto(usuario, res, db);
  if (!perfil) return;
  const admin = perfil.role === 'admin';
  const base = { ok: true, admin, definicao: MODULOS, parametros: { total_modulos: MODULOS.length, margem_superior: PARAMETROS.margemSuperior } };

  try {
    if (req.method === 'GET') {
      const id = (req.query && req.query.id) || new URL(req.url || '/', 'http://x').searchParams.get('id');
      if (admin && !id) return json(res, 200, { ...base, jornadas: await listar(db) });
      const meus = admin ? null : await listaDoCliente(db, usuario.id, origemDa(req));
      const j = id ? await jornadaDe(db, id, usuario, admin, { comMentor: true })
        : (meus[0] ? await db.um('jornadas', { select: '*', id: 'eq.' + meus[0].id }) : null);
      if (!j) return json(res, 200, { ...base, papel: 'dono', jornada: null, projetos: meus || [] });
      const papel = admin ? 'admin' : j._mentor ? 'mentor' : 'dono';
      const cliente = papel !== 'dono' ? await db.um('profiles', { select: 'nome,email', id: 'eq.' + j.cliente_id }) : null;
      const comMentor = papel === 'dono' ? (await mentoresDo(db, j.id)).length > 0 : true;
      return json(res, 200, {
        ...base, papel, tem_mentor: comMentor, exige_mentor: exigeMentor(j), projetos: meus || undefined, ...(await carregar(db, j, admin)),
        ...(cliente ? { cliente: { nome: cliente.nome || 'Cliente', email: papel === 'admin' ? cliente.email || null : null } } : {})
      });
    }

    let corpo;
    try { corpo = (await lerCorpo(req, 60000)) || {}; } catch { return erro(res, 400, 'Requisição inválida.'); }
    const acao = Object.hasOwn(ACOES, corpo.acao) ? ACOES[corpo.acao] : null;
    if (!acao) return erro(res, 400, 'Ação inválida.');
    const j = await acao({ db, usuario, admin, corpo, req });
    const papel = admin ? 'admin' : j._mentor ? 'mentor' : 'dono';
    const atual = await db.um('jornadas', { select: '*', id: 'eq.' + j.id });
    const temMentor = papel === 'dono' ? (await mentoresDo(db, j.id)).length > 0 : true;
    return json(res, 200, { ...base, papel, tem_mentor: temMentor, exige_mentor: exigeMentor(atual), ...(await carregar(db, atual, admin)) });
  } catch (e) {
    if (e instanceof Recusa) return json(res, e.status, { ok: false, codigo: e.codigo, erro: e.message });
    if (e instanceof ErroIA) {
      if (e.status >= 500) registrarErro('jornada:ia', e);
      return json(res, e.status, { ok: false, codigo: e.codigo, erro: e.message });
    }
    registrarErro('jornada', e);
    return erro(res, 500, 'Não foi possível concluir agora. Tente novamente.');
  }
}
