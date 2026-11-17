// Fluxo de análise e aprovação das solicitações (servidor).
//
//   em_validacao (Aguardando análise da CMK) -> em_analise -> ajustes_solicitados -> (cliente reenvia) -> em_validacao
//                                                          -> aguardando_cliente (CMK mudou itens; cliente confirma)
//                                                          -> aguardando_pagamento (aprovado pela CMK) -> paga
//
// REGRA: o pagamento só é liberado quando um administrador aprova (status aguardando_pagamento).
// O checkout (api/checkout.js) recusa qualquer outro status.
import { createNotification } from './notificacoes.js';
import { registrarErro } from './http.js';

export const STATUS = Object.freeze({
  em_validacao: 'Aguardando análise da CMK',
  em_analise: 'Em análise',
  ajustes_solicitados: 'Ajustes solicitados',
  aguardando_cliente: 'Aguardando aprovação do cliente',
  aguardando_pagamento: 'Aprovado pela CMK — aguardando pagamento',
  paga: 'Pagamento confirmado',
  cancelada: 'Cancelada'
});

// Antes do pagamento: a equipe ainda pode mexer e o cliente pode desistir.
export const ABERTOS = ['em_validacao', 'em_analise', 'ajustes_solicitados', 'aguardando_cliente', 'aguardando_pagamento'];
// O cliente pode editar e reenviar (em análise, espera a equipe terminar).
export const CLIENTE_PODE_EDITAR = ['em_validacao', 'ajustes_solicitados', 'aguardando_cliente', 'aguardando_pagamento'];

export function caminhoPersonalizacao(solicitacaoId, versao) {
  return 'solicitacoes/' + solicitacaoId + '/' + (versao > 1 ? 'v' + versao + '/' : '') + 'personalizacao.json';
}

export async function registrarEvento(db, e) {
  try {
    await db.inserir('solicitacao_eventos', {
      solicitacao_id: e.solicitacaoId,
      tipo: e.tipo,
      status_de: e.de || null,
      status_para: e.para || null,
      mensagem: e.mensagem || null,
      visivel_cliente: e.visivelCliente !== false,
      autor_id: e.autorId || null,
      autor_nome: e.autorNome || null,
      autor_papel: e.papel || 'sistema',
      versao: e.versao || null
    });
  } catch (err) {
    // o histórico não pode derrubar a ação principal (ex.: banco sem o sql/32 ainda)
    registrarErro('fluxo:evento', err);
  }
}

export async function avisarCliente(db, s, n) {
  try {
    await createNotification(db, { destinatarioId: s.cliente_id, link: 'continuar.html?abrir=' + s.id, ...n, metadados: { solicitacao_id: s.id, ...(n.metadados || {}) } });
  } catch (err) {
    registrarErro('fluxo:avisar-cliente', err);
  }
}

export async function avisarAdmins(db, s, n) {
  try {
    const admins = await db.select('profiles', { select: 'id', role: 'eq.admin' });
    for (const a of admins) {
      await createNotification(db, { destinatarioId: a.id, link: 'admin-solicitacao.html?id=' + s.id, ...n, metadados: { solicitacao_id: s.id, ...(n.metadados || {}) } });
    }
  } catch (err) {
    registrarErro('fluxo:avisar-admins', err);
  }
}
