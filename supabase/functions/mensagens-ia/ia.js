// Lógica da IA das mensagens (Gemini), em JavaScript puro: roda na Edge Function do
// Supabase (index.ts) e nos testes do Node (tests/mensagens-ia.test.js). Sem Deno/Node aqui:
// o acesso ao banco e o fetch chegam por parâmetro.
//   acao 'sugerir'    { conversa_id, tom?, texto? }  -> 3 respostas para a conversa
//   acao 'reescrever' { texto, tom?, canal? }        -> 3 versões melhores do rascunho
//   acao 'construir'  { objetivo, detalhes?, tom?, canal?, destinatario? } -> 3 mensagens prontas
// A IA não inventa valores, datas ou links: o que faltar vem entre colchetes para a equipe completar.

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const RESERVAS = ['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-2.5-flash'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ErroIA extends Error {
  constructor(codigo, mensagem, status = 502) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status;
  }
}

export const TONS = {
  profissional: 'profissional, claro e cordial',
  cordial: 'cordial, caloroso e próximo, sem perder o profissionalismo',
  objetivo: 'objetivo e direto, frases curtas',
  formal: 'formal e respeitoso',
  persuasivo: 'persuasivo e confiante, destacando o benefício para o cliente',
  descontraido: 'leve e descontraído, ainda profissional'
};

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    sugestoes: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { titulo: { type: 'STRING' }, texto: { type: 'STRING' } }, required: ['titulo', 'texto'] }
    }
  },
  required: ['sugestoes']
};

export function instrucoesSistema(canal) {
  return [
    'Você ajuda a equipe da CMKCOGIT, um estúdio brasileiro de tecnologia que cria sites, landing pages, lojas virtuais, sistemas, automações e identidade visual, a escrever mensagens para clientes e colegas.',
    'Escreva sempre em português do Brasil, com ortografia correta, tom humano e profissional. Nada de jargão técnico desnecessário.',
    'Nunca invente fatos: valores, datas, prazos, links, nomes de projetos ou promessas que não estejam no contexto. Quando faltar uma informação, use um marcador entre colchetes, por exemplo [data de entrega].',
    'Não use títulos, listas em markdown nem assinatura. Seja breve: no máximo 5 frases curtas, separadas em parágrafos quando ajudar a leitura.',
    canal === 'whatsapp'
      ? 'A mensagem será enviada pelo WhatsApp: pode usar *negrito* com moderação e no máximo um emoji, só se combinar com o tom.'
      : 'A mensagem será enviada pelo chat da plataforma: não use emojis nem formatação.',
    'Devolva exatamente 3 opções diferentes entre si (abordagens distintas), cada uma com um título curto de 2 a 4 palavras que descreva a abordagem.'
  ].join('\n');
}

const limpar = (v, max) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);

function linhaDaConversa(m, clienteId) {
  const quem = m.interna ? 'Nota interna da equipe (' + (m.autor_nome || 'equipe') + ')'
    : m.autor_papel === 'admin' ? 'Equipe (' + (m.autor_nome || 'equipe') + ')'
      : m.autor_id === clienteId ? 'Cliente' : (m.autor_nome || 'Pessoa');
  const conteudo = m.tipo === 'audio' ? '[enviou um áudio]'
    : m.tipo === 'arquivo' ? '[enviou o arquivo ' + (m.anexo_nome || '') + ']' + (m.corpo ? ' ' + m.corpo : '') : m.corpo;
  return quem + ': ' + String(conteudo || '').replace(/\s+/g, ' ').slice(0, 800);
}

/**
 * Monta o pedido para o modelo.
 * @param banco { conversa(id), mensagens(conversaId) -> mais novas primeiro, nomeCliente(id) }
 */
export async function montarPedido(banco, corpo) {
  const acao = corpo.acao;
  const tom = TONS[corpo.tom] ? corpo.tom : 'profissional';
  const canal = corpo.canal === 'whatsapp' ? 'whatsapp' : 'plataforma';
  const partes = ['Tom desejado: ' + TONS[tom] + '.'];

  if (acao === 'sugerir') {
    if (!UUID.test(corpo.conversa_id || '')) throw new ErroIA('pedido', 'Escolha uma conversa.', 400);
    const conversa = await banco.conversa(corpo.conversa_id);
    if (!conversa) throw new ErroIA('pedido', 'Conversa não encontrada.', 404);
    const [mensagens, nomeCliente] = await Promise.all([
      banco.mensagens(conversa.id),
      conversa.cliente_id ? banco.nomeCliente(conversa.cliente_id) : null
    ]);
    if (!mensagens.length) throw new ErroIA('pedido', 'A conversa ainda não tem mensagens. Use "Construir mensagem" para começar.', 400);
    partes.push(conversa.tipo === 'cliente'
      ? 'Conversa entre a equipe e o cliente ' + (nomeCliente || '') + '. Escreva a PRÓXIMA resposta da equipe para o cliente. As notas internas são só contexto: nunca as revele ao cliente.'
      : 'Conversa interna entre pessoas da equipe. Escreva a próxima resposta, em tom de colega de trabalho.');
    partes.push('Histórico (mais antigo primeiro):\n' + mensagens.slice().reverse().map((m) => linhaDaConversa(m, conversa.cliente_id)).join('\n'));
    if (corpo.texto) partes.push('Rascunho que a equipe começou a escrever (use como ponto de partida): ' + limpar(corpo.texto, 2000));
    return { canal, prompt: partes.join('\n\n') };
  }

  if (acao === 'reescrever') {
    const texto = limpar(corpo.texto, 5000);
    if (!texto) throw new ErroIA('pedido', 'Escreva um rascunho para a IA melhorar.', 400);
    partes.push('Reescreva o rascunho abaixo mantendo o sentido e todas as informações. Corrija ortografia e gramática e deixe-o mais claro e profissional.');
    partes.push('Rascunho:\n' + texto);
    return { canal, prompt: partes.join('\n\n') };
  }

  if (acao === 'construir') {
    const objetivo = limpar(corpo.objetivo, 300);
    if (!objetivo) throw new ErroIA('pedido', 'Diga qual é o objetivo da mensagem.', 400);
    partes.push('Escreva uma mensagem nova da equipe para um cliente. Objetivo: ' + objetivo + '.');
    const detalhes = limpar(corpo.detalhes, 2000);
    if (detalhes) partes.push('Informações que devem aparecer: ' + detalhes);
    const destinatario = limpar(corpo.destinatario, 120);
    partes.push(destinatario
      ? 'Destinatário: ' + destinatario + ' (chame pelo primeiro nome).'
      : 'Destinatário ainda não definido: use {primeiro_nome} onde entraria o nome. Se citar o projeto ou o link da plataforma, use {projeto} e {link}.');
    return { canal, prompt: partes.join('\n\n') };
  }

  throw new ErroIA('pedido', 'Ação inválida.', 400);
}

export function normalizarSugestoes(dados) {
  const lista = Array.isArray(dados && dados.sugestoes) ? dados.sugestoes : [];
  return lista
    .map((s) => ({ titulo: limpar(s && s.titulo, 60) || 'Sugestão', texto: limpar(s && s.texto, 5000) }))
    .filter((s) => s.texto)
    .slice(0, 3);
}

function modelos(escolhido) {
  return [...new Set([String(escolhido || '').trim(), ...RESERVAS].filter((m) => /^[\w.-]+$/.test(m)))];
}

// Chama o Gemini e devolve o JSON da resposta. Modelo inexistente (404): tenta o próximo.
export async function gerarJson({ chave, modelo, sistema, prompt, fetchFn = fetch, tempoMax = 25000 }) {
  if (!chave) throw new ErroIA('ia_indisponivel', 'A IA ainda não está configurada (falta o segredo GEMINI_API_KEY no Supabase).', 503);
  const corpo = JSON.stringify({
    systemInstruction: { parts: [{ text: sistema }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: ESQUEMA, maxOutputTokens: 4096 }
  });
  for (const m of modelos(modelo)) {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), tempoMax);
    let r;
    try {
      r = await fetchFn(BASE + encodeURIComponent(m) + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave }, body: corpo, signal: controle.signal
      });
    } catch (e) {
      clearTimeout(timer);
      throw new ErroIA('ia_falhou', e && e.name === 'AbortError' ? 'A IA demorou demais para responder. Tente de novo.' : 'Não foi possível falar com a IA agora.');
    }
    clearTimeout(timer);
    const dados = await r.json().catch(() => ({}));
    if (r.status === 404) continue;
    if (r.status === 429) throw new ErroIA('ia_limite', 'Limite de uso da IA atingido. Tente de novo em instantes.', 429);
    if (r.status === 400 && /API key/i.test(JSON.stringify(dados))) throw new ErroIA('ia_chave', 'A chave do Gemini foi recusada. Confira o segredo GEMINI_API_KEY no Supabase.', 502);
    if (r.status === 401 || r.status === 403) throw new ErroIA('ia_chave', 'A chave do Gemini não tem permissão. Confira o segredo GEMINI_API_KEY no Supabase.', 502);
    if (!r.ok) throw new ErroIA('ia_falhou', 'A IA não respondeu agora (' + r.status + '). Tente de novo.');
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
  throw new ErroIA('ia_modelo', 'Nenhum modelo do Gemini disponível para esta chave. Confira o segredo GEMINI_MODEL.', 502);
}

/**
 * Pedido completo: valida, monta o prompt, chama o Gemini e normaliza.
 * @returns {{ status: number, corpo: object }}
 */
export async function processar({ corpo, banco, chave, modelo, fetchFn = fetch }) {
  try {
    const pedido = await montarPedido(banco, corpo || {});
    const dados = await gerarJson({ chave, modelo, sistema: instrucoesSistema(pedido.canal), prompt: pedido.prompt, fetchFn });
    const sugestoes = normalizarSugestoes(dados);
    if (!sugestoes.length) return { status: 502, corpo: { ok: false, codigo: 'ia_vazia', erro: 'A IA não trouxe sugestões desta vez. Tente de novo.' } };
    return { status: 200, corpo: { ok: true, sugestoes } };
  } catch (e) {
    if (e instanceof ErroIA) return { status: e.status, corpo: { ok: false, codigo: e.codigo, erro: e.message } };
    return { status: 500, corpo: { ok: false, codigo: 'erro', erro: 'Não foi possível gerar sugestões agora.' } };
  }
}
