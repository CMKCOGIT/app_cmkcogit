// Black da Cogit 2026 — datas e preços que valem para COBRAR (o servidor decide; o site só mostra).
// Mesmos valores do black-config.js do site (repositório CMK-Cogit): mudou lá, mude aqui.
// Horários de Brasília (UTC-03:00).
//
// Desligar na hora: ligada: false (pedidos novos voltam ao preço normal; pedidos da Black já
// registrados mantêm o preço garantido até o prazo de pagamento deles).
export const BLACK = {
  id: 'black-2026',
  ligada: true,
  inicio: '2026-11-26T00:00:00-03:00',        // pedidos a partir daqui recebem o preço da Black
  fim: '2026-11-28T00:00:00-03:00',           // primeiro instante DEPOIS de 27/11 às 23h59
  pagamentoImediatoAte: '2026-11-27T23:59:59-03:00',  // modelos prontos, Autônomo Pronto, Presença Essencial
  pagamentoValidacaoAte: '2026-12-04T23:59:59-03:00', // Conversão, Operação Conectada (após validar o escopo)

  modelos: {
    'portfolio': { de: 500, por: 400 },
    'landing-page': { de: 600, por: 480 },
    'site-institucional': { de: 700, por: 560 }
  },

  // Substituem as COMBINACOES de 10% durante a Black (não somam). "por" é o preço do pacote.
  combos: [
    { id: 'autonomo-pronto', nome: 'Autônomo Pronto', servicos: ['identidade-essencial', 'portfolio'], modelo: 'modelos-prontos', de: 1000, por: 750, percentual: 25 },
    { id: 'presenca-essencial', nome: 'Presença Essencial', servicos: ['identidade-essencial', 'site-institucional'], modelo: 'modelos-prontos', de: 1200, por: 900, percentual: 25 },
    { id: 'conversao', nome: 'Conversão', servicos: ['identidade-essencial', 'landing-page', 'automacao'], modelo: 'modelos-prontos', de: 1990, por: 1490, percentual: 25 },
    { id: 'operacao-conectada', nome: 'Operação Conectada', servicos: ['sistema', 'integracao'], de: 3980, por: 3180, percentual: 20 }
  ]
};

const t = (iso) => new Date(iso).getTime();

// A Black vale para um pedido feito neste instante?
export function blackAtiva(agora = Date.now(), cfg = BLACK) {
  const n = agora instanceof Date ? agora.getTime() : Number(agora);
  return Boolean(cfg && cfg.ligada) && n >= t(cfg.inicio) && n < t(cfg.fim);
}

// Pedido registrado como da Black e ainda dentro do prazo de pagamento dele (preço garantido)
export function blackDoPedido(s, agora = Date.now(), cfg = BLACK) {
  if (!s || s.promo !== cfg.id || !s.promo_pagar_ate) return false;
  return agora <= Date.parse(s.promo_pagar_ate);
}

// O valor liberado para pagar usa o preço da Black e o prazo dele já passou?
export function blackVencida(s, agora = Date.now(), cfg = BLACK) {
  return Boolean(s && s.promo === cfg.id && s.promo_aplicada !== false && s.promo_pagar_ate) && agora > Date.parse(s.promo_pagar_ate);
}

// Até quando um pedido da Black pode ser pago: preço fechado -> fim da Black; com validação -> 04/12.
export function prazoPagamentoBlack(tipoPreco, cfg = BLACK) {
  return tipoPreco === 'fixed' ? cfg.pagamentoImediatoAte : cfg.pagamentoValidacaoAte;
}
