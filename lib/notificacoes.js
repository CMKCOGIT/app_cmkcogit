// Notificações (tabela public.notificacoes, sql/11 + sql/13) — lado do SERVIDOR.
// O navegador lista e marca como lida pela rota /api/notificacoes; quem cria
// são os triggers do banco e as funções abaixo (service_role).
import { COMPRA_OFERTA, shouldNotifyOnOfferPurchase } from './notificacoes.config.js';
import { UUID, registrarErro } from './http.js';

export const LIMITE_LISTA = 30;
const LIMITE_CONTAGEM = 100; // "99+" no sino

const texto = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

// Só links da própria plataforma (ex.: projeto.html?id=...#repositorio)
export function linkInterno(link) {
  return /^[a-z-]+\.html([?#][\w=&%#.-]*)?$/i.test(link || '');
}

/**
 * Cria uma notificação genérica.
 * @param db cliente de lib/supabase.js (service_role)
 * @param {{ destinatarioId: string, tipo: string, titulo: string, mensagem?: string,
 *           link?: string, projetoId?: string, metadados?: object }} n
 */
export async function createNotification(db, n) {
  if (!n || !UUID.test(n.destinatarioId || '')) throw new Error('destinatário inválido');
  if (!/^[a-z_]{2,40}$/.test(n.tipo || '')) throw new Error('tipo inválido');
  const titulo = texto(n.titulo, 200);
  if (!titulo) throw new Error('título obrigatório');
  return db.inserir('notificacoes', {
    usuario_id: n.destinatarioId,
    projeto_id: UUID.test(n.projetoId || '') ? n.projetoId : null,
    tipo: n.tipo,
    titulo,
    mensagem: texto(n.mensagem, 600),
    link: linkInterno(n.link) ? n.link : null,
    metadados: n.metadados && typeof n.metadados === 'object' ? n.metadados : {}
  });
}

export async function listarNotificacoes(db, usuarioId, limite = LIMITE_LISTA) {
  const [lista, naoLidas] = await Promise.all([
    db.select('notificacoes', {
      select: '*', usuario_id: 'eq.' + usuarioId, order: 'created_at.desc', limit: String(limite)
    }),
    contarNaoLidas(db, usuarioId)
  ]);
  return { naoLidas, notificacoes: lista.map(publica) };
}

export async function contarNaoLidas(db, usuarioId) {
  const linhas = await db.select('notificacoes', {
    select: 'id', usuario_id: 'eq.' + usuarioId, lida: 'eq.false', limit: String(LIMITE_CONTAGEM)
  });
  return linhas.length;
}

// ids = lista de uuids, ou null para "todas"
export async function marcarComoLidas(db, usuarioId, ids) {
  const filtros = { usuario_id: 'eq.' + usuarioId, lida: 'eq.false' };
  if (ids) {
    const validos = ids.filter((id) => typeof id === 'string' && UUID.test(id)).slice(0, 100);
    if (!validos.length) return contarNaoLidas(db, usuarioId);
    filtros.id = 'in.(' + validos.join(',') + ')';
  }
  await db.atualizar('notificacoes', filtros, { lida: true, lida_em: new Date().toISOString() });
  return contarNaoLidas(db, usuarioId);
}

function publica(n) {
  return {
    id: n.id, tipo: n.tipo, titulo: n.titulo, mensagem: n.mensagem || null,
    link: linkInterno(n.link) ? n.link : null, lida: Boolean(n.lida), lida_em: n.lida_em || null,
    projeto_id: n.projeto_id || null, metadados: n.metadados || {}, created_at: n.created_at
  };
}

// ---------------------------------------------------------------------
// Compra de oferta (funcionalidade extra paga). Chamada depois que o
// pagamento foi confirmado; nunca derruba a confirmação do pagamento.
// ---------------------------------------------------------------------
export async function montarEventoCompraOferta(db, pagamentoId) {
  const pag = await db.um('pagamentos', {
    select: 'id,cliente_id,projeto_id,projeto_funcionalidade_id,valor,status,pago_em', id: 'eq.' + pagamentoId
  });
  if (!pag || pag.status !== 'pago' || !pag.projeto_funcionalidade_id) return null; // não é compra de oferta
  const pedido = await db.um('projeto_funcionalidades', {
    select: 'funcionalidade_id,funcionalidades(slug,nome)', id: 'eq.' + pag.projeto_funcionalidade_id
  });
  const f = (pedido && pedido.funcionalidades) || {};
  return {
    pagamentoId: pag.id,
    clienteId: pag.cliente_id,
    projetoId: pag.projeto_id || null,
    valor: Number(pag.valor),
    pagoEm: pag.pago_em || null,
    oferta: { id: (pedido && pedido.funcionalidade_id) || null, slug: f.slug || null, nome: f.nome || 'Funcionalidade' }
  };
}

export async function notificarCompraOferta(db, pagamentoId, { config = COMPRA_OFERTA, decidir = shouldNotifyOnOfferPurchase } = {}) {
  try {
    const evento = await montarEventoCompraOferta(db, pagamentoId);
    if (!evento || !decidir(evento, config)) return 0;

    const valor = evento.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const metadados = { pagamento_id: evento.pagamentoId, oferta_id: evento.oferta.id, oferta_slug: evento.oferta.slug, valor: evento.valor };
    const link = evento.projetoId ? 'projeto.html?id=' + evento.projetoId : null;
    const destinos = [];

    if (config.notificarCliente) {
      destinos.push({ destinatarioId: evento.clienteId, titulo: 'Compra confirmada: ' + evento.oferta.nome,
        mensagem: 'Recebemos seu pagamento de ' + valor + '. A equipe já colocou a funcionalidade na fila.' });
    }
    if (config.notificarAdmins) {
      const [admins, cliente] = await Promise.all([
        db.select('profiles', { select: 'id', role: 'eq.admin' }),
        db.um('profiles', { select: 'nome,email', id: 'eq.' + evento.clienteId })
      ]);
      const quem = (cliente && (cliente.nome || cliente.email)) || 'Um cliente';
      for (const a of admins) {
        destinos.push({ destinatarioId: a.id, titulo: 'Nova compra de oferta: ' + evento.oferta.nome,
          mensagem: quem + ' comprou por ' + valor + '.' });
      }
    }

    await Promise.all(destinos.map((d) => createNotification(db, {
      ...d, tipo: config.tipo, link, projetoId: evento.projetoId, metadados
    })));
    return destinos.length;
  } catch (e) {
    registrarErro('notificar-compra-oferta', e);
    return 0;
  }
}
