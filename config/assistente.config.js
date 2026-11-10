// Configuração do Assistente IA (só admin). Tudo que se ajusta fica aqui.
// Limites da Groq no PLANO GRATUITO para o openai/gpt-oss-120b (console.groq.com → Settings → Limits):
//   30 pedidos/min · 1.000 pedidos/dia · 8.000 tokens/min · 200.000 tokens/dia
// A Groq conta na cota por minuto os tokens de entrada + o max_tokens reservado da resposta.
// Por isso o orçamento abaixo soma no máximo ~6.500 tokens por pedido (cabe nos 8.000/min).
// Ao mudar de plano ou de modelo, ajuste os números de "groq" e os orçamentos.

export const ASSISTENTE = {
  // Modelo: o mais capaz do plano gratuito da Groq. As sugestões das Mensagens usam outro
  // modelo (lib/ia.js), com cota separada. Reserva: usado só se o principal sair do ar.
  modelo: 'openai/gpt-oss-120b',
  modeloReserva: 'qwen/qwen3.6-27b',
  temperatura: 0.6,
  esforcoRaciocinio: 'low',      // gpt-oss "pensa" antes de responder; "low" gasta menos tokens
  maxTokensResposta: 1500,       // reservado na cota por minuto a cada pedido
  tempoMaxMs: 60000,

  // Orçamento de contexto (tokens estimados: ~3,6 caracteres por token em português)
  tokensBase: 2500,              // base de conhecimento (knowledge/*.md) por pedido
  tokensHistorico: 1500,         // mensagens anteriores da conversa
  caracteresMensagem: 4000,      // tamanho máximo da pergunta
  mensagensHistorico: 12,        // no máximo as últimas 12 falas

  // Limites da Groq (com folga) — valem para a CONTA, somando todos os admins
  groq: { pedidosPorMinuto: 25, pedidosPorDia: 900, tokensPorMinuto: 7200, tokensPorDia: 185000 },
  // Limites por admin
  porUsuario: { pedidosPorMinuto: 8, pedidosPorDia: 150 }
};

// Estimativa simples de tokens (sem tokenizador): suficiente para respeitar o orçamento.
export function estimarTokens(texto) {
  return Math.ceil(String(texto || '').length / 3.6);
}
