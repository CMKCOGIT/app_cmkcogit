// Custo real de cada chamada de IA, a partir do campo "usage" da resposta.
// Preços em US$ por milhão de tokens vêm do ambiente (nunca fixos no código de negócio):
//   CLAUDE_PRECO_ENTRADA, CLAUDE_PRECO_SAIDA, CLAUDE_PRECO_CACHE_LEITURA, CLAUDE_PRECO_CACHE_ESCRITA
//   CLAUDE_PRECOS_JSON (opcional) {"modelo": {"entrada":..,"saida":..,"cache_leitura":..,"cache_escrita":..}}
//   para quando a resposta vier de um modelo de reserva (fallback) com outro preço.
// Os padrões abaixo são os da tabela oficial para o modelo padrão (claude-opus-5-5, nov/2026);
// confira em https://platform.claude.com/docs/en/about-claude/pricing antes de mudar de modelo.
// A cotação US$ -> R$ vem de mvp_pricing_config.usd_brl (o admin atualiza no banco).

const PADRAO = { entrada: 4, saida: 20, cache_leitura: 0.2, cache_escrita: 5 };
const num = (v, p) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== '' && v != null ? Number(v) : p);

export function precosDoAmbiente(env = process.env) {
  const base = {
    entrada: num(env.CLAUDE_PRECO_ENTRADA, PADRAO.entrada),
    saida: num(env.CLAUDE_PRECO_SAIDA, PADRAO.saida),
    cache_leitura: num(env.CLAUDE_PRECO_CACHE_LEITURA, PADRAO.cache_leitura),
    cache_escrita: num(env.CLAUDE_PRECO_CACHE_ESCRITA, PADRAO.cache_escrita)
  };
  let porModelo = {};
  try { porModelo = env.CLAUDE_PRECOS_JSON ? JSON.parse(env.CLAUDE_PRECOS_JSON) : {}; } catch { porModelo = {}; }
  return (modelo) => {
    const p = porModelo && porModelo[modelo];
    return p ? { entrada: num(p.entrada, base.entrada), saida: num(p.saida, base.saida), cache_leitura: num(p.cache_leitura, base.cache_leitura), cache_escrita: num(p.cache_escrita, base.cache_escrita) } : base;
  };
}

// usage: { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, iterations? }
// Com "iterations" (ex.: modelo de reserva assumiu), soma cada tentativa com o preço do modelo dela.
export function custoDoUso(usage, modelo, { precos = precosDoAmbiente(), usdBrl = 5.4 } = {}) {
  const u = usage || {};
  const partes = Array.isArray(u.iterations) && u.iterations.length
    ? u.iterations.filter((i) => i && typeof i.input_tokens === 'number').map((i) => ({ ...i, model: i.model || modelo }))
    : [{ ...u, model: modelo }];
  const tot = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0 };
  for (const p of partes) {
    const t = {
      entrada: Number(p.input_tokens) || 0,
      saida: Number(p.output_tokens) || 0,
      leitura: Number(p.cache_read_input_tokens) || 0,
      escrita: Number(p.cache_creation_input_tokens) || 0
    };
    const pr = precos(p.model);
    tot.input_tokens += t.entrada;
    tot.output_tokens += t.saida;
    tot.cache_read_tokens += t.leitura;
    tot.cache_write_tokens += t.escrita;
    tot.cost_usd += (t.entrada * pr.entrada + t.saida * pr.saida + t.leitura * pr.cache_leitura + t.escrita * pr.cache_escrita) / 1e6;
  }
  const cotacao = num(usdBrl, 5.4);
  return { ...tot, cost_usd: Math.round(tot.cost_usd * 1e6) / 1e6, cost_brl: Math.round(tot.cost_usd * cotacao * 1e4) / 1e4, usd_brl: cotacao };
}
