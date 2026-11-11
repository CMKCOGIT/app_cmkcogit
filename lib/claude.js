// Claude (API da Anthropic) para a geração FINAL do orçamento detalhado. Só no servidor:
// ANTHROPIC_API_KEY nunca vai para o navegador nem para o mvp.
//
// Configuração (variáveis de ambiente, nada fixo no código):
//   ANTHROPIC_API_KEY ........ obrigatória para gerar o documento pago
//   CLAUDE_MODEL ............. padrão claude-opus-5-5
//   CLAUDE_EFFORT ............ low | medium | high (padrão medium: documento estruturado, não precisa de mais)
//   CLAUDE_TIMEOUT_MS ........ padrão 240000 (a função da Vercel tem até 300 s)
//   preços: ver lib/custo.js
// O teto de saída (max_tokens) vem de mvp_pricing_config.max_output_tokens.
//
// - Saída em JSON estruturado: output_config.format com o JSON Schema do documento (o servidor ainda
//   valida tudo em lib/mvp-documento.js antes de usar).
// - Prompt caching: o texto de sistema (igual para todos os pedidos) leva cache_control; as respostas
//   do cliente mudam a cada pedido e ficam depois do ponto de cache.
// - Recusa por segurança: "fallbacks: default" faz a própria API tentar outro modelo; se ainda assim
//   recusar, vira erro e o pedido segue o fluxo de nova tentativa / estorno.
import Anthropic from '@anthropic-ai/sdk';

export class ErroClaude extends Error {
  constructor(codigo, mensagem, { usage = null, model = null, status = 502 } = {}) {
    super(mensagem);
    this.codigo = codigo;
    this.usage = usage;
    this.model = model;
    this.status = status;
  }
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function configClaude(env = process.env) {
  const modelo = String(env.CLAUDE_MODEL || 'claude-opus-5-5').trim();
  const effort = EFFORTS.includes(env.CLAUDE_EFFORT) ? env.CLAUDE_EFFORT : 'medium';
  const timeout = Math.min(Math.max(Number(env.CLAUDE_TIMEOUT_MS) || 240000, 30000), 290000);
  return { modelo, effort, timeout, configurado: Boolean(env.ANTHROPIC_API_KEY) };
}

/**
 * Gera um objeto JSON que segue `esquema`.
 * @returns {{ dados: object, usage: object, model: string, stop_reason: string }}
 */
export async function gerarJsonClaude({ sistema, prompt, esquema, maxTokens, env = process.env, cliente = null }) {
  const cfg = configClaude(env);
  if (!cfg.configurado && !cliente) throw new ErroClaude('ia_indisponivel', 'A geração do documento ainda não está configurada (ANTHROPIC_API_KEY).', { status: 503 });
  const api = cliente || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: cfg.timeout, maxRetries: 1 });

  let msg;
  try {
    const stream = api.beta.messages.stream({
      model: cfg.modelo,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
      output_config: { effort: cfg.effort, format: { type: 'json_schema', schema: esquema } }
    });
    msg = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new ErroClaude('ia_chave', 'A chave da Anthropic foi recusada. Confira ANTHROPIC_API_KEY.', { status: 502 });
    }
    if (e instanceof Anthropic.RateLimitError) throw new ErroClaude('ia_limite', 'Limite de uso da IA atingido. Tentaremos de novo.', { status: 429 });
    if (e instanceof Anthropic.BadRequestError) throw new ErroClaude('ia_pedido', 'Pedido recusado pela API (' + String(e.message).slice(0, 160) + ').');
    if (e instanceof Anthropic.APIError) throw new ErroClaude('ia_falhou', 'A IA não respondeu agora (' + (e.status || 'erro') + ').');
    throw new ErroClaude('ia_falhou', 'Não foi possível falar com a IA agora.');
  }

  const base = { usage: msg.usage, model: msg.model };
  if (msg.stop_reason === 'refusal') throw new ErroClaude('ia_recusa', 'A IA recusou gerar este documento.', base);
  if (msg.stop_reason === 'max_tokens') throw new ErroClaude('ia_cortada', 'O documento passou do tamanho máximo configurado.', base);
  const texto = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!texto) throw new ErroClaude('ia_vazia', 'A IA não devolveu o documento.', base);
  let dados;
  try { dados = JSON.parse(texto); } catch { throw new ErroClaude('ia_formato', 'A resposta da IA veio num formato inesperado.', base); }
  return { dados, usage: msg.usage, model: msg.model, stop_reason: msg.stop_reason };
}
