// POST /api/solicitacao-itens   (cliente dono da solicitação ou admin)
// Corpo: { solicitacao_id, tipo: 'servico' | 'complemento', id }
// Tira um item de uma solicitação ainda não paga (ex.: o cliente desistiu da
// Landing Page e ficou só com o Portfólio) e RECALCULA o preço pelo catálogo,
// igual à criação. Complementos que dependiam do item removido saem junto.
//   preço fechado  -> aguardando pagamento com o novo valor (cobrança pendente atualizada)
//   sob medida     -> volta para "em validação" (o valor liberado antes não vale mais)
// Quem não fez a mudança é avisado pelas notificações (admin <-> cliente).
import { criarDb } from '../lib/supabase.js';
import { json, erro, lerCorpo, exigirUsuario, exigirCadastroCompleto, registrarErro, UUID } from '../lib/http.js';
import { calcular } from '../lib/selecao.js';
import { createNotification } from '../lib/notificacoes.js';

const EDITAVEIS = ['em_validacao', 'aguardando_pagamento'];
const SLUG = /^[a-z0-9-]{1,60}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return erro(res, 405, 'Método não permitido.');

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('solicitacao-itens:config', e); return erro(res, 500, 'Indisponível no momento.'); }

  const usuario = await exigirUsuario(req, res, db);
  if (!usuario) return;
  if (!(await exigirCadastroCompleto(usuario, res, db))) return;

  let corpo;
  try { corpo = await lerCorpo(req, 2000); } catch { return erro(res, 400, 'Requisição inválida.'); }
  const { solicitacao_id: solId, tipo, id } = corpo || {};
  if (typeof solId !== 'string' || !UUID.test(solId)) return erro(res, 400, 'Solicitação inválida.');
  if (!['servico', 'complemento'].includes(tipo) || typeof id !== 'string' || !SLUG.test(id)) return erro(res, 400, 'Item inválido.');

  try {
    const s = await db.um('solicitacoes', { select: '*', id: 'eq.' + solId });
    let admin = false;
    if (s && s.cliente_id !== usuario.id) {
      const perfil = await db.um('profiles', { select: 'role', id: 'eq.' + usuario.id });
      admin = Boolean(perfil && perfil.role === 'admin');
    }
    if (!s || (s.cliente_id !== usuario.id && !admin)) return erro(res, 404, 'Solicitação não encontrada.');
    if (!EDITAVEIS.includes(s.status)) return erro(res, 409, 'Esta solicitação não pode mais ser alterada.');

    const selecao = s.selecao || {};
    const servicos = Array.isArray(selecao.servicos) ? selecao.servicos : [];
    let complementos = Array.isArray(selecao.complementos) ? selecao.complementos : [];
    const lista = tipo === 'servico' ? servicos : complementos;
    if (!lista.some((x) => x && x.id === id)) return erro(res, 404, 'Este item não está mais na solicitação.');

    const restantes = tipo === 'servico' ? servicos.filter((x) => x.id !== id) : servicos;
    if (!restantes.length) return erro(res, 409, 'Esta é a última solução da solicitação. Para tirar tudo, cancele a solicitação.');
    if (tipo === 'complemento') complementos = complementos.filter((x) => x.id !== id);

    const catalogo = await db.select('catalogo_precos', { select: '*' });
    // complementos que só eram permitidos pela solução removida saem junto
    const permitidos = new Set(restantes.flatMap((x) => {
      const item = catalogo.find((c) => c.id === x.id && c.tipo === 'servico');
      return item ? item.complementos_permitidos || [] : [];
    }));
    if (restantes.some((x) => x.id === 'automacao')) permitidos.delete('automacao-extra');
    const tirados = complementos.filter((c) => !permitidos.has(c.id));
    complementos = complementos.filter((c) => permitidos.has(c.id));

    const novaSelecao = { ...selecao, servicos: restantes, complementos };
    const calc = calcular({ servicos: restantes, complementos }, catalogo);
    if (!calc.ok) return erro(res, 400, calc.erro);

    // histórico do que saiu (aparece na tela de solicitações)
    const antigo = s.resumo || {};
    const nomeDe = (t, itemId) => {
      const r = [...(antigo.itens || []), ...(antigo.mensais || []), ...(antigo.complementos || [])].find((x) => x.id === itemId);
      const c = catalogo.find((x) => x.id === itemId && x.tipo === t);
      return (r && r.nome) || (c && c.nome) || itemId;
    };
    const agora = new Date().toISOString();
    const quem = admin ? 'equipe' : 'cliente';
    const removidos = [
      ...(Array.isArray(antigo.removidos) ? antigo.removidos : []),
      { id, tipo, nome: nomeDe(tipo, id), por: quem, em: agora },
      ...tirados.map((c) => ({ id: c.id, tipo: 'complemento', nome: nomeDe('complemento', c.id), por: quem, em: agora, motivo: 'dependia do item removido' }))
    ].slice(-30);

    const campos = {
      selecao: novaSelecao,
      resumo: { ...calc.resumo, removidos },
      estruturado: calc.estruturado,
      tipo_preco: calc.tipo_preco,
      valor_calculado: calc.valor,
      valor_final: calc.estruturado ? calc.valor : null,
      status: calc.estruturado ? 'aguardando_pagamento' : 'em_validacao'
    };
    // só grava se ninguém mexeu nela no meio do caminho (outra aba, o admin, um pagamento)
    const atualizada = await db.atualizar('solicitacoes',
      { id: 'eq.' + s.id, status: 'eq.' + s.status, updated_at: 'eq.' + s.updated_at }, campos);
    if (!atualizada) return erro(res, 409, 'A solicitação mudou enquanto você editava. Recarregue a página e tente de novo.');

    // cobrança pendente: novo valor (link antigo descartado) ou cancelada se voltou para validação
    const filtroPendente = { solicitacao_id: 'eq.' + s.id, status: 'eq.pendente' };
    if (campos.status === 'aguardando_pagamento') {
      await db.atualizar('pagamentos', filtroPendente, { valor: campos.valor_final, link_pagamento: null, mp_preference_id: null });
    } else {
      await db.atualizar('pagamentos', filtroPendente, { status: 'cancelado', link_pagamento: null });
    }

    await avisar(db, { s, admin, nome: nomeDe(tipo, id), campos, usuarioId: usuario.id });

    return json(res, 200, {
      ok: true,
      solicitacao: {
        id: atualizada.id, codigo: atualizada.codigo, status: atualizada.status, estruturado: atualizada.estruturado,
        valor_final: atualizada.valor_final, valor_calculado: atualizada.valor_calculado
      },
      removidos_junto: tirados.map((c) => nomeDe('complemento', c.id))
    });
  } catch (e) {
    registrarErro('solicitacao-itens', e);
    return erro(res, 500, 'Não foi possível alterar a solicitação agora. Tente novamente.');
  }
}

// Quem não fez a mudança fica sabendo. Falha aqui não desfaz a alteração.
async function avisar(db, { s, admin, nome, campos, usuarioId }) {
  try {
    const valor = campos.valor_final != null
      ? 'Novo valor: ' + Number(campos.valor_final).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) + '.'
      : 'Ela volta para a validação da equipe, que confirma o novo valor.';
    const metadados = { solicitacao_id: s.id, item: nome };
    if (admin) {
      await createNotification(db, {
        destinatarioId: s.cliente_id, tipo: 'solicitacao_alterada', link: 'continuar.html', metadados,
        titulo: 'Sua solicitação ' + s.codigo + ' foi ajustada', mensagem: 'A equipe tirou "' + nome + '". ' + valor
      });
      return;
    }
    const [admins, cliente] = await Promise.all([
      db.select('profiles', { select: 'id', role: 'eq.admin' }),
      db.um('profiles', { select: 'nome,email', id: 'eq.' + usuarioId })
    ]);
    const quem = (cliente && (cliente.nome || cliente.email)) || 'O cliente';
    await Promise.all(admins.map((a) => createNotification(db, {
      destinatarioId: a.id, tipo: 'solicitacao_alterada', link: 'admin.html', metadados,
      titulo: s.codigo + ': cliente tirou um item', mensagem: quem + ' tirou "' + nome + '". ' + valor
    })));
  } catch (e) {
    registrarErro('solicitacao-itens:avisar', e);
  }
}
