// =====================================================================
// notificacoes.config.js — PONTO ÚNICO de configuração das notificações
// automáticas criadas pelo servidor (lib/notificacoes.js).
//
// Tipo "compra_oferta": um cliente comprou uma oferta (funcionalidade extra
// mostrada na faixa de oferta / dicas do Início, paga no Mercado Pago).
// O disparo acontece depois que o pagamento é CONFIRMADO no banco
// (aplicarNoBanco em lib/mercadopago.js -> notificarCompraOferta).
// =====================================================================

export const COMPRA_OFERTA = Object.freeze({
  tipo: 'compra_oferta',
  // TODO(regras): ligar quando as regras abaixo estiverem definidas.
  habilitado: false,
  // Quem recebe quando a regra deixar passar
  notificarAdmins: true,
  notificarCliente: true
});

/**
 * Decide se uma compra de oferta gera notificação.
 *
 * TODO(regras): definir os parâmetros de disparo com o time. Exemplos do que
 * pode entrar aqui (nada disso está decidido):
 *   - valor mínimo (ex.: event.valor >= X)
 *   - só ofertas específicas (event.oferta.slug em uma lista)
 *   - só a 1ª compra do cliente, ou todas
 *   - janela de horário / limite de avisos por dia
 * Enquanto não houver regra, devolve o placeholder `COMPRA_OFERTA.habilitado`
 * (false): nada é disparado em produção. Para testar o visual do sino use o
 * sql/14_seed_notificacoes_teste.sql.
 *
 * @param {{
 *   pagamentoId: string, clienteId: string, projetoId: string|null,
 *   valor: number, pagoEm: string|null,
 *   oferta: { id: string|null, slug: string|null, nome: string }
 * }} event
 * @param {typeof COMPRA_OFERTA} [config]
 * @returns {boolean}
 */
export function shouldNotifyOnOfferPurchase(event, config = COMPRA_OFERTA) {
  if (!event || !event.pagamentoId) return false;
  return Boolean(config.habilitado); // TODO(regras): placeholder
}
