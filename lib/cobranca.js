// Cobrança pendente de uma solicitação, quando a solicitação muda (servidor).
// Regra: o que o cliente ainda conseguia pagar no Mercado Pago é ENCERRADO lá também,
// não só no nosso banco. Assim ninguém paga um link antigo (valor velho ou pedido cancelado).
import { encerrarNoMp } from './mercadopago.js';

async function pendentes(db, solicitacaoId) {
  return db.select('pagamentos', { select: 'id,mp_preference_id,valor', solicitacao_id: 'eq.' + solicitacaoId, status: 'eq.pendente' });
}

// Cancela a cobrança pendente (pedido cancelado, ajustes, reenvio do cliente...).
export async function cancelarCobrancaPendente(db, solicitacaoId) {
  const lista = await pendentes(db, solicitacaoId);
  for (const pag of lista) await encerrarNoMp(pag);
  return db.atualizar('pagamentos', { solicitacao_id: 'eq.' + solicitacaoId, status: 'eq.pendente' }, { status: 'cancelado', link_pagamento: null });
}

// O valor mudou: o link antigo é encerrado e o próximo "Pagar" gera um novo com o valor certo.
export async function reajustarCobrancaPendente(db, solicitacaoId, valor) {
  const lista = await pendentes(db, solicitacaoId);
  let ultima = null;
  for (const pag of lista) {
    if (Number(pag.valor) === Number(valor)) continue; // mesmo valor: o link continua valendo
    if (pag.mp_preference_id) await encerrarNoMp(pag);
    ultima = await db.atualizar('pagamentos', { id: 'eq.' + pag.id, status: 'eq.pendente' }, { valor, link_pagamento: null, mp_preference_id: null });
  }
  return ultima;
}
