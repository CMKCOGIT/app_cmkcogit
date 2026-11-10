// Rota da Jornada MVP (trilha de módulos + orçamento do MVP gerado com IA). Ver lib/jornada.js.
// Endereço: /api/notificacoes?rota=jornada — não é um arquivo em /api porque o plano Hobby da
// Vercel aceita no máximo 12 funções por deploy; api/notificacoes.js só repassa o pedido para cá.
//   GET                      cliente: a própria jornada · admin: lista de todas
//   GET &id=<jornada>        admin: uma jornada (com o nome do cliente)
//   POST { acao: 'iniciar', titulo }                                   cliente: cria a jornada
//   POST { acao: 'salvar', jornada_id, modulo, respostas }             cliente: guarda as respostas do módulo
//   POST { acao: 'enviar', jornada_id, modulo }                        cliente: envia o módulo para revisão
//   POST { acao: 'avaliar', jornada_id, modulo, decisao, comentario }  admin: 'aprovado' | 'ajustes'
//   POST { acao: 'gerar_orcamento', jornada_id }                       IA lê as respostas; o servidor calcula o valor
// O cliente só gera o orçamento com todos os módulos aprovados e uma única vez; a equipe pode
// gerar de novo (cada geração fica guardada; vale a mais recente).
// Toda escrita passa por aqui (service_role): as tabelas não têm política de escrita no RLS.
import { criarDb } from './supabase.js';
import { json, erro, lerCorpo, exigirUsuario, exigirCadastroCompleto, registrarErro, UUID } from './http.js';
import { gerarJson, ErroIA } from './ia.js';
import { createNotification } from './notificacoes.js';
import {
  MODULOS, PARAMETROS, LIMITE_TITULO, moduloPorId, limpar, sanitizarRespostas, etapasPendentes,
  montarPrompt, normalizarEscopo, calcularOrcamento, valorHora,
  SISTEMA_ORCAMENTO, ESQUEMA_ORCAMENTO, FORMATO_ORCAMENTO
} from './jornada.js';

class Recusa extends Error {
  constructor(status, mensagem, codigo) { super(mensagem); this.status = status; this.codigo = codigo; }
}

const agora = () => new Date().toISOString();
const link = (id, admin) => 'jornada.html' + (admin ? '?id=' + id : '');

// Aviso no sino: nunca derruba a ação principal.
async function avisar(db, destinatarios, n) {
  await Promise.all(destinatarios.map((id) => createNotification(db, { ...n, destinatarioId: id, tipo: 'jornada' })
    .catch((e) => registrarErro('jornada:aviso', e))));
}
async function idsDosAdmins(db) {
  const linhas = await db.select('profiles', { select: 'id', role: 'eq.admin', limit: '50' });
  return linhas.map((p) => p.id);
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
    jornada: { id: jornada.id, titulo: jornada.titulo, status: jornada.status, created_at: jornada.created_at, updated_at: jornada.updated_at },
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

// A jornada do pedido, já conferindo de quem é.
async function jornadaDe(db, id, usuario, admin) {
  if (!UUID.test(id || '')) throw new Recusa(400, 'Jornada inválida.');
  const j = await db.um('jornadas', { select: '*', id: 'eq.' + id });
  if (!j || (!admin && j.cliente_id !== usuario.id)) throw new Recusa(404, 'Jornada não encontrada.');
  return j;
}
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
  async iniciar({ db, usuario, admin, corpo }) {
    if (admin) throw new Recusa(403, 'A jornada é iniciada pelo cliente.', 'somente_cliente');
    const titulo = limpar(corpo.titulo, LIMITE_TITULO);
    if (titulo.length < 2) throw new Recusa(400, 'Dê um nome ao seu produto ou ideia.');
    let j = await db.um('jornadas', { select: '*', cliente_id: 'eq.' + usuario.id });
    if (!j) {
      j = await db.inserir('jornadas', { cliente_id: usuario.id, titulo });
      await avisar(db, await idsDosAdmins(db), { titulo: 'Nova Jornada MVP: ' + titulo, mensagem: 'Um cliente começou a trilha do MVP.', link: link(j.id, true) });
    }
    return j;
  },

  async salvar({ db, usuario, admin, corpo }) {
    if (admin) throw new Recusa(403, 'As respostas são do cliente.', 'somente_cliente');
    const j = await jornadaDe(db, corpo.jornada_id, usuario, false);
    const { def, linha } = await linhaDoModulo(db, j, corpo.modulo);
    if (linha.status === 'enviado') throw new Recusa(409, 'Este módulo está em revisão. Aguarde o retorno da equipe.');
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
    await db.atualizar('jornada_modulos', { id: 'eq.' + linha.id }, { status: 'enviado', enviado_em: agora(), updated_at: agora() });
    await tocar(db, j);
    await avisar(db, await idsDosAdmins(db), { titulo: 'Módulo para revisar: ' + def.nome, mensagem: j.titulo, link: link(j.id, true) });
    return j;
  },

  async avaliar({ db, usuario, admin, corpo }) {
    if (!admin) throw new Recusa(403, 'A revisão é da equipe.', 'somente_admin');
    const j = await jornadaDe(db, corpo.jornada_id, usuario, true);
    const { def, linha } = await linhaDoModulo(db, j, corpo.modulo);
    const decisao = corpo.decisao === 'aprovado' ? 'aprovado' : corpo.decisao === 'ajustes' ? 'ajustes' : null;
    if (!decisao) throw new Recusa(400, 'Escolha aprovar ou pedir ajustes.');
    if (linha.status === 'aberto') throw new Recusa(409, 'O cliente ainda não enviou este módulo.');
    const comentario = limpar(corpo.comentario, 1000);
    if (decisao === 'ajustes' && comentario.length < 3) throw new Recusa(400, 'Escreva o que o cliente precisa ajustar.');
    await db.atualizar('jornada_modulos', { id: 'eq.' + linha.id }, {
      status: decisao, comentario: comentario || null, avaliado_em: agora(), avaliado_por: usuario.id, updated_at: agora()
    });
    await tocar(db, j);
    await avisar(db, [j.cliente_id], decisao === 'aprovado'
      ? { titulo: 'Módulo aprovado: ' + def.nome, mensagem: comentario || 'Pode seguir para o próximo módulo.', link: link(j.id) }
      : { titulo: 'Ajustes pedidos: ' + def.nome, mensagem: comentario, link: link(j.id) });
    return j;
  },

  async gerar_orcamento({ db, usuario, admin, corpo }) {
    const j = await jornadaDe(db, corpo.jornada_id, usuario, admin);
    const modulos = await db.select('jornada_modulos', { select: 'modulo,status,respostas', jornada_id: 'eq.' + j.id });
    if (!admin) {
      const aprovados = modulos.filter((m) => m.status === 'aprovado' && moduloPorId(m.modulo)).length;
      if (aprovados < MODULOS.length) throw new Recusa(409, 'O orçamento é liberado quando todos os módulos forem aprovados.');
      const jaTem = await db.um('jornada_orcamentos', { select: 'id', jornada_id: 'eq.' + j.id });
      if (jaTem) throw new Recusa(409, 'O orçamento já foi gerado. Para refazer, fale com a equipe.');
    } else if (!modulos.some((m) => Object.keys(m.respostas || {}).length)) {
      throw new Recusa(409, 'Ainda não há respostas para a IA ler.');
    }

    const bruto = await gerarJson({
      sistema: SISTEMA_ORCAMENTO, prompt: montarPrompt(j.titulo, modulos),
      esquema: ESQUEMA_ORCAMENTO, formatoJson: FORMATO_ORCAMENTO, maxTokens: 3000
    });
    const escopo = normalizarEscopo(bruto);
    if (escopo.funcionalidades.length < 1) throw new ErroIA('ia_vazia', 'A IA não conseguiu montar o escopo desta vez. Tente de novo.');

    const mvp = await db.um('catalogo_precos', { select: 'preco,ativo', id: 'eq.mvp' }).catch(() => null);
    const calculo = calcularOrcamento(escopo, { valorHora: valorHora(), piso: mvp && mvp.ativo !== false ? mvp.preco : null });
    const dados = { resumo: escopo.resumo, premissas: escopo.premissas, riscos: escopo.riscos, perguntas: escopo.perguntas, ...calculo };
    await db.inserir('jornada_orcamentos', {
      jornada_id: j.id, dados, valor_min: calculo.valor_min, valor_max: calculo.valor_max, horas: calculo.mvp.horas, gerado_por: usuario.id
    });
    await tocar(db, j, { status: 'concluida' });
    await avisar(db, admin ? [j.cliente_id] : await idsDosAdmins(db), {
      titulo: 'Orçamento do MVP pronto: ' + j.titulo, mensagem: 'O escopo e a estimativa do MVP já podem ser vistos.', link: link(j.id, !admin)
    });
    return j;
  }
};

export default async function handler(req, res) {
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
      const j = admin ? await jornadaDe(db, id, usuario, true) : await db.um('jornadas', { select: '*', cliente_id: 'eq.' + usuario.id });
      if (!j) return json(res, 200, { ...base, jornada: null });
      const cliente = admin ? await db.um('profiles', { select: 'nome,email', id: 'eq.' + j.cliente_id }) : null;
      return json(res, 200, { ...base, ...(await carregar(db, j, admin)), ...(cliente ? { cliente: { nome: cliente.nome || 'Cliente', email: cliente.email || null } } : {}) });
    }

    let corpo;
    try { corpo = (await lerCorpo(req, 60000)) || {}; } catch { return erro(res, 400, 'Requisição inválida.'); }
    const acao = Object.hasOwn(ACOES, corpo.acao) ? ACOES[corpo.acao] : null;
    if (!acao) return erro(res, 400, 'Ação inválida.');
    const j = await acao({ db, usuario, admin, corpo });
    return json(res, 200, { ...base, ...(await carregar(db, await db.um('jornadas', { select: '*', id: 'eq.' + j.id }), admin)) });
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
