// Cliente mínimo da API do Gemini (Google AI Studio) para o SERVIDOR, sem dependências.
// A chave (GEMINI_API_KEY) fica só na Vercel / .env.local — nunca no navegador.
// Modelo: GEMINI_MODEL (padrão: o apelido "gemini-flash-latest", que acompanha a versão Flash
// mais nova); se o modelo não existir, tenta o próximo da lista.
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const RESERVAS = ['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-2.5-flash'];

export class ErroIA extends Error {
  constructor(codigo, mensagem, status = 502) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status;
  }
}

export function iaConfigurada(env = process.env) {
  return Boolean(env.GEMINI_API_KEY);
}

function modelos(env) {
  const escolhido = String(env.GEMINI_MODEL || '').trim();
  return [...new Set([escolhido, ...RESERVAS].filter((m) => /^[\w.-]+$/.test(m)))];
}

/**
 * Gera uma resposta em JSON.
 * @param {{ sistema: string, prompt: string, esquema: object, env?: object, fetchFn?: Function, tempoMax?: number }} o
 * @returns {Promise<object>} o JSON devolvido pelo modelo
 */
export async function gerarJson({ sistema, prompt, esquema, env = process.env, fetchFn = fetch, tempoMax = 25000 }) {
  if (!iaConfigurada(env)) throw new ErroIA('ia_indisponivel', 'A IA ainda não está configurada (falta GEMINI_API_KEY).', 503);
  const corpo = JSON.stringify({
    systemInstruction: { parts: [{ text: sistema }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: esquema, maxOutputTokens: 4096 }
  });

  for (const modelo of modelos(env)) {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), tempoMax);
    let r;
    try {
      r = await fetchFn(BASE + encodeURIComponent(modelo) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: corpo,
        signal: controle.signal
      });
    } catch (e) {
      clearTimeout(timer);
      throw new ErroIA('ia_falhou', e.name === 'AbortError' ? 'A IA demorou demais para responder. Tente de novo.' : 'Não foi possível falar com a IA agora.');
    }
    clearTimeout(timer);
    const dados = await r.json().catch(() => ({}));
    if (r.status === 404) continue; // modelo não existe nesta conta: tenta o próximo
    if (r.status === 429) throw new ErroIA('ia_limite', 'Limite de uso da IA atingido. Tente de novo em instantes.', 429);
    if (!r.ok) {
      throw new ErroIA('ia_falhou', 'A IA não respondeu agora (' + r.status + '). Tente de novo.');
    }
    const cand = (dados.candidates || [])[0];
    const texto = ((cand && cand.content && cand.content.parts) || [])
      .filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
    if (!texto) {
      const motivo = (cand && cand.finishReason) || (dados.promptFeedback && dados.promptFeedback.blockReason);
      throw new ErroIA('ia_vazia', motivo === 'SAFETY' ? 'A IA não quis responder a este pedido. Reformule e tente de novo.' : 'A IA não devolveu texto. Tente de novo.');
    }
    try {
      return JSON.parse(texto.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      throw new ErroIA('ia_formato', 'A resposta da IA veio num formato inesperado. Tente de novo.');
    }
  }
  throw new ErroIA('ia_modelo', 'Nenhum modelo do Gemini disponível para esta chave. Confira GEMINI_MODEL.', 502);
}
