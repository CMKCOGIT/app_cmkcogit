// POST /api/admin-solicitacao   (só admin) — modal de validação de Solicitações
// Corpo: { acao, solicitacao_id, updated_at?, ... }
//   simular   { itens }                          -> resumo + valor sugerido (não grava nada)
//   salvar    { itens }                          -> grava os itens (preço recalculado pelo catálogo)
//   aprovar   { itens, valor_final, mensagem }   -> libera o pagamento, registra quem/quando,
//                                                   gera o comprovante e devolve o link do WhatsApp
//   cancelar  { motivo, mensagem }               -> cancela (cobrança pendente cancelada)
//   reenviar  {}                                 -> link do comprovante + WhatsApp de novo
// itens = { servicos: [{id, modelo}], complementos: [{id, qtd}], personalizados: [{id, nome, descricao, valor}] }
// updated_at: o que o modal leu; se a solicitação mudou depois disso, responde 409.
import { criarDb } from '../lib/supabase.js';
import { json, erro, lerCorpo, exigirUsuario, exigirCadastroCompleto, registrarErro, UUID, urlApp } from '../lib/http.js';
import { calcular, validarItensAdmin, texto } from '../lib/selecao.js';
import { novoToken, montarComprovante, textoWhatsApp } from '../lib/comprovante.js';
import { createNotification } from '../lib/notificacoes.js';

const ACOES = ['simular', 'salvar', 'aprovar', 'cancelar', 'reenviar'];
const EDITAVEIS = ['em_validacao', 'aguardando_pagamento'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return erro(res, 405, 'Método não permitido.');

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('admin-solicitacao:config', e); return erro(res, 500, 'Indisponível no momento.'); }

  const usuario = await exigirUsuario(req, res, db);
  if (!usuario) return;
  if (!(await exigirCadastroCompleto(usuario, res, db))) return;

  let corpo;
  try { corpo = await lerCorpo(req, 30000); } catch { return erro(res, 400, 'Requisição inválida.'); }
  const { acao, solicitacao_id: solId } = corpo || {};
  if (!ACOES.includes(acao)) return erro(res, 400, 'Ação inválida.');
  if (typeof solId !== 'string' || !UUID.test(solId)) return erro(res, 400, 'Solicitação inválida.');

  try {
    const admin = await db.um('profiles', { select: 'id,nome,email,role', id: 'eq.' + usuario.id });
    if (!admin || admin.role !== 'admin') return erro(res, 403, 'Apenas administradores.');

    const s = await db.um('solicitacoes', { select: '*', id: 'eq.' + solId });
    if (!s) return erro(res, 404, 'Solicitação não encontrada.');
    const cliente = (await db.um('profiles', { select: 'id,nome,email,telefone', id: 'eq.' + s.cliente_id })) || {};

    if (acao === 'reenviar') {
      if (!s.comprovante_token || !s.comprovante) return erro(res, 409, 'Esta solicitação ainda não tem comprovante. Aprove primeiro.');
      return json(res, 200, { ok: true, ...links(s.comprovante_token, s.comprovante, cliente) });
    }

    if (!EDITAVEIS.includes(s.status)) return erro(res, 409, 'Esta solicitação já foi ' + (s.status === 'paga' ? 'paga' : 'cancelada') + ' e não pode mais ser alterada.');
    if (corpo.updated_at && corpo.updated_at !== s.updated_at) {
      return erro(res, 409, 'A solicitação mudou enquanto o modal estava aberto (o cliente ou outra pessoa mexeu). Feche e abra de novo.');
    }

    if (acao === 'cancelar') return await cancelar(res, db, { s, admin, cliente, corpo });

    // simular / salvar / aprovar: itens recalculados pelo catálogo
    const v = validarItensAdmin(corpo.itens, s.selecao || {});
    if (!v.ok) return erro(res, 400, v.erro);
    const catalogo = await db.select('catalogo_precos', { select: '*' });
    const calc = calcular(v.itens, catalogo);
    if (!calc.ok) return erro(res, 400, calc.erro);

    if (acao === 'simular') {
      return json(res, 200, { ok: true, resumo: calc.resumo, valor: calc.valor, tipo_preco: calc.tipo_preco, estruturado: calc.estruturado });
    }

    const agora = new Date().toISOString();
    const resumo = { ...calc.resumo, removidos: historicoRemovidos(s, v.itens, agora) };
    const base = {
      selecao: { ...(s.selecao || {}), ...v.itens },
      resumo,
      estruturado: calc.estruturado,
      tipo_preco: calc.tipo_preco,
      valor_calculado: calc.valor
    };

    if (acao === 'salvar') {
      const campos = { ...base, valor_final: calc.estruturado ? calc.valor : null, status: calc.estruturado ? 'aguardando_pagamento' : 'em_validacao' };
      const nova = await gravar(db, s, campos);
      if (!nova) return conflito(res);
      await ajustarCobranca(db, s.id, campos.status === 'aguardando_pagamento' ? campos.valor_final : null);
      return json(res, 200, { ok: true, solicitacao: nova });
    }

    // aprovar
    const valorFinal = Math.round(Number(corpo.valor_final) * 100) / 100;
    if (!(valorFinal > 0) || valorFinal > 1000000) return erro(res, 400, 'Informe um valor final maior que zero.');
    const mensagem = texto(corpo.mensagem, 1000) || null;
    const token = s.comprovante_token || novoToken();
    const comprovante = montarComprovante({
      solicitacao: s, resumo, valorFinal, mensagem, cliente, aprovadoPor: admin.nome || admin.email, emitidoEm: agora
    });
    const campos = {
      ...base,
      valor_final: valorFinal,
      observacao_admin: mensagem,
      status: 'aguardando_pagamento',
      aprovado_em: agora,
      aprovado_por: admin.id,
      comprovante_token: token,
      comprovante
    };
    const nova = await gravar(db, s, campos);
    if (!nova) return conflito(res);
    await ajustarCobranca(db, s.id, valorFinal);

    await avisarCliente(db, s, {
      tipo: 'solicitacao_aprovada', titulo: 'Pedido ' + s.codigo + ' aprovado',
      mensagem: 'Pagamento liberado: ' + brl(valorFinal) + '. ' + (mensagem || 'É só pagar em Minhas solicitações.'),
      metadados: { solicitacao_id: s.id, valor_final: valorFinal }
    });
    return json(res, 200, { ok: true, solicitacao: nova, ...links(token, comprovante, cliente) });
  } catch (e) {
    registrarErro('admin-solicitacao:' + acao, e);
    if (e && (e.code === 'PGRST204' || e.code === '42703')) {
      return erro(res, 500, 'Falta atualizar o banco: rode o sql/15_validacao_comprovante.sql no Supabase.');
    }
    return erro(res, 500, 'Não foi possível concluir agora. Tente novamente.');
  }
}

async function cancelar(res, db, { s, admin, cliente, corpo }) {
  const motivo = texto(corpo.motivo, 500) || null;
  const mensagem = texto(corpo.mensagem, 1000) || null;
  const nova = await gravar(db, s, {
    status: 'cancelada',
    motivo_cancelamento: motivo,
    cancelado_em: new Date().toISOString(),
    cancelado_por: admin.id,
    observacao_admin: mensagem || s.observacao_admin
  });
  if (!nova) return conflito(res);
  await db.atualizar('pagamentos', { solicitacao_id: 'eq.' + s.id, status: 'eq.pendente' }, { status: 'cancelado', link_pagamento: null });
  await avisarCliente(db, s, {
    tipo: 'solicitacao_cancelada', titulo: 'Pedido ' + s.codigo + ' cancelado',
    mensagem: mensagem || 'Fale com a equipe se quiser montar outra solução.', metadados: { solicitacao_id: s.id }
  });
  const whatsapp = mensagem
    ? urlWhatsApp(cliente.telefone, `Olá${cliente.nome ? ', ' + String(cliente.nome).split(' ')[0] : ''}! Aqui é da CMK COGIT, sobre o seu pedido ${s.codigo}.\n\n${mensagem}`)
    : null;
  return json(res, 200, { ok: true, solicitacao: nova, whatsapp_url: whatsapp });
}

// Grava só se ninguém mexeu desde a leitura (mesmo status e updated_at)
function gravar(db, s, campos) {
  return db.atualizar('solicitacoes', { id: 'eq.' + s.id, status: 'eq.' + s.status, updated_at: 'eq.' + s.updated_at }, campos);
}
function conflito(res) {
  return erro(res, 409, 'A solicitação mudou enquanto você editava. Feche o modal e abra de novo.');
}

// Cobrança pendente acompanha o valor (link antigo descartado) ou é cancelada (volta à validação)
function ajustarCobranca(db, solId, valor) {
  const filtro = { solicitacao_id: 'eq.' + solId, status: 'eq.pendente' };
  return valor != null
    ? db.atualizar('pagamentos', filtro, { valor, link_pagamento: null, mp_preference_id: null })
    : db.atualizar('pagamentos', filtro, { status: 'cancelado', link_pagamento: null });
}

// O que saiu da seleção entra no histórico "Itens retirados" (pela equipe)
function historicoRemovidos(s, novos, agora) {
  const antigo = s.resumo || {};
  const todos = [...(antigo.itens || []), ...(antigo.mensais || []), ...(antigo.complementos || [])];
  const ficou = new Set([...novos.servicos, ...novos.complementos, ...novos.personalizados].map((x) => x.id));
  const saiu = todos.filter((x) => x && x.id && !ficou.has(x.id))
    .map((x) => ({ id: x.id, nome: x.nome, por: 'equipe', em: agora }));
  return [...(Array.isArray(antigo.removidos) ? antigo.removidos : []), ...saiu].slice(-30);
}

function links(token, comprovante, cliente) {
  const url = urlApp() + '/comprovante.html?t=' + token;
  const msg = textoWhatsApp({
    nome: (comprovante.cliente && comprovante.cliente.nome) || cliente.nome,
    codigo: comprovante.codigo, valorFinal: comprovante.valor_final, mensagem: comprovante.mensagem, link: url
  });
  return { comprovante_url: url, whatsapp_texto: msg, whatsapp_url: urlWhatsApp(cliente.telefone, msg), cliente_sem_telefone: !foneWhatsApp(cliente.telefone) };
}

// wa.me com DDI 55; sem telefone, abre o WhatsApp para escolher o contato
function foneWhatsApp(telefone) {
  const d = String(telefone || '').replace(/\D/g, '');
  if (/^\d{10,11}$/.test(d)) return '55' + d;
  if (/^55\d{10,11}$/.test(d)) return d;
  return null;
}
function urlWhatsApp(telefone, msg) {
  const fone = foneWhatsApp(telefone);
  return 'https://wa.me/' + (fone || '') + '?text=' + encodeURIComponent(msg);
}

async function avisarCliente(db, s, { tipo, titulo, mensagem, metadados }) {
  try {
    await createNotification(db, { destinatarioId: s.cliente_id, tipo, titulo, mensagem, link: 'continuar.html', metadados });
  } catch (e) {
    registrarErro('admin-solicitacao:avisar', e);
  }
}

function brl(v) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
