// Cliente mínimo de IA para o SERVIDOR, sem dependências. As chaves ficam só na Vercel /
// .env.local — nunca no navegador. Usa o provedor que estiver configurado, nesta ordem:
//   1. Groq (gratuito):  GROQ_API_KEY   · modelo opcional GROQ_MODEL (padrão openai/gpt-oss-20b)
//      O Assistente IA (api/assistente.js) usa o openai/gpt-oss-120b: no plano gratuito cada modelo
//      tem cota própria, então as sugestões das Mensagens não disputam limite com o assistente.
//   2. Gemini (Google):  GEMINI_API_KEY · modelo opcional GEMINI_MODEL (padrão gemini-flash-latest)
// Com os dois configurados, se o primeiro estiver no limite ou sem modelo, tenta o segundo.
// Modelo inexistente/aposentado: tenta o próximo da lista de reserva do mesmo provedor.

export class ErroIA extends Error {
  constructor(codigo, mensagem, status = 502) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status;
  }
}

const RESERVAS = {
  groq: ['openai/gpt-oss-20b', 'qwen/qwen3.6-27b'], // cada modelo tem cota própria; o 120b fica para o Assistente IA
  gemini: ['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-2.5-flash']
};

export function provedores(env = process.env) {
  return [env.GROQ_API_KEY && 'groq', env.GEMINI_API_KEY && 'gemini'].filter(Boolean);
}
export function iaConfigurada(env = process.env) {
  return provedores(env).length > 0;
}

function listaModelos(provedor, env) {
  const escolhido = String((provedor === 'groq' ? env.GROQ_MODEL : env.GEMINI_MODEL) || '').trim();
  return [...new Set([escolhido, ...RESERVAS[provedor]].filter((m) => /^[\w./:-]+$/.test(m)))];
}

async function chamar(fetchFn, url, opcoes, tempoMax) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), tempoMax);
  try {
    const r = await fetchFn(url, { ...opcoes, signal: controle.signal });
    const dados = await r.json().catch(() => ({}));
    return { r, dados };
  } catch (e) {
    throw new ErroIA('ia_falhou', e && e.name === 'AbortError' ? 'A IA demorou demais para responder. Tente de novo.' : 'Não foi possível falar com a IA agora.');
  } finally {
    clearTimeout(timer);
  }
}

function lerJson(texto) {
  try {
    return JSON.parse(String(texto).trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new ErroIA('ia_formato', 'A resposta da IA veio num formato inesperado. Tente de novo.');
  }
}

// ---- Groq (API compatível com a da OpenAI) ----
async function gerarGroq({ sistema, prompt, formatoJson, env, fetchFn, tempoMax }) {
  let noLimite = false;
  for (const modelo of listaModelos('groq', env)) {
    const { r, dados } = await chamar(fetchFn, 'https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.GROQ_API_KEY },
      body: JSON.stringify({
        model: modelo,
        messages: [{ role: 'system', content: sistema + '\n\n' + formatoJson }, { role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 1500, // a Groq reserva max_tokens na cota por minuto: 3 mensagens curtas cabem folgadas
        // modelos que "pensam" antes de responder: pouco raciocínio basta para escrever mensagens
        ...(/^openai\/gpt-oss/.test(modelo) ? { reasoning_effort: 'low' } : {})
      })
    }, tempoMax);
    const codigo = (dados && dados.error && (dados.error.code || dados.error.type)) || '';
    if (r.status === 404 || /model_not_found|model_decommissioned/.test(codigo)) continue;
    if (r.status === 429) { noLimite = true; continue; } // cota deste modelo acabou: tenta o próximo
    if (r.status === 401 || r.status === 403) throw new ErroIA('ia_chave', 'A chave da Groq foi recusada. Confira GROQ_API_KEY na Vercel.', 502);
    if (!r.ok) throw new ErroIA('ia_falhou', 'A IA não respondeu agora (' + r.status + '). Tente de novo.');
    const texto = dados.choices && dados.choices[0] && dados.choices[0].message && dados.choices[0].message.content;
    if (!texto) throw new ErroIA('ia_vazia', 'A IA não devolveu texto. Tente de novo.');
    return lerJson(texto);
  }
  if (noLimite) throw new ErroIA('ia_limite', 'Limite gratuito da IA atingido por agora. Tente de novo em 1 minuto.', 429);
  throw new ErroIA('ia_modelo', 'Nenhum modelo da Groq disponível. Confira GROQ_MODEL na Vercel.', 502);
}

// ---- Gemini (Google AI Studio) ----
async function gerarGemini({ sistema, prompt, esquema, env, fetchFn, tempoMax }) {
  const corpo = JSON.stringify({
    systemInstruction: { parts: [{ text: sistema }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: esquema, maxOutputTokens: 4096 }
  });
  for (const modelo of listaModelos('gemini', env)) {
    const { r, dados } = await chamar(fetchFn, 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(modelo) + ':generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: corpo
    }, tempoMax);
    if (r.status === 404) continue;
    if (r.status === 429) throw new ErroIA('ia_limite', 'Limite de uso da IA atingido. Tente de novo em instantes.', 429);
    if (r.status === 401 || r.status === 403 || (r.status === 400 && /API key/i.test(JSON.stringify(dados)))) {
      throw new ErroIA('ia_chave', 'A chave do Gemini foi recusada. Confira GEMINI_API_KEY na Vercel.', 502);
    }
    if (!r.ok) throw new ErroIA('ia_falhou', 'A IA não respondeu agora (' + r.status + '). Tente de novo.');
    const cand = (dados.candidates || [])[0];
    const texto = ((cand && cand.content && cand.content.parts) || [])
      .filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
    if (!texto) {
      const motivo = (cand && cand.finishReason) || (dados.promptFeedback && dados.promptFeedback.blockReason);
      throw new ErroIA('ia_vazia', motivo === 'SAFETY' ? 'A IA não quis responder a este pedido. Reformule e tente de novo.' : 'A IA não devolveu texto. Tente de novo.');
    }
    return lerJson(texto);
  }
  throw new ErroIA('ia_modelo', 'Nenhum modelo do Gemini disponível para esta chave. Confira GEMINI_MODEL.', 502);
}

/**
 * Gera uma resposta em JSON com o primeiro provedor configurado.
 * @param {{ sistema: string, prompt: string, esquema: object, formatoJson: string,
 *           env?: object, fetchFn?: Function, tempoMax?: number }} o
 *   esquema: esquema de resposta (Gemini) · formatoJson: o mesmo formato descrito em texto (Groq)
 */
export async function gerarJson({ sistema, prompt, esquema, formatoJson, env = process.env, fetchFn = fetch, tempoMax = 25000 }) {
  const lista = provedores(env);
  if (!lista.length) throw new ErroIA('ia_indisponivel', 'A IA ainda não está configurada (falta GROQ_API_KEY na Vercel).', 503);
  let ultimo;
  for (const p of lista) {
    try {
      const o = { sistema, prompt, esquema, formatoJson, env, fetchFn, tempoMax };
      return p === 'groq' ? await gerarGroq(o) : await gerarGemini(o);
    } catch (e) {
      ultimo = e;
      if (!(e instanceof ErroIA) || !['ia_limite', 'ia_modelo', 'ia_chave'].includes(e.codigo)) throw e;
    }
  }
  throw ultimo;
}
