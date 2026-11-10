// Assistente IA (SÓ ADMIN) — servido por /api/mensagens-ia?modo=assistente
// (o plano gratuito da Vercel aceita no máximo 12 funções em api/; por isso não tem arquivo próprio) — Assistente IA da equipe, com resposta em streaming (Groq).
//   POST { mensagens: [{ papel: 'user'|'assistente', texto }] }   (a última é a pergunta)
//   -> 200 application/x-ndjson, uma linha JSON por evento:
//        { t: 'inicio', base: ['Produtos e serviços › Modelos prontos', ...] }
//        { t: 'd', c: '<pedaço do texto>' } ... { t: 'fim', motivo }   ou   { t: 'erro', codigo, erro }
//   -> 4xx/5xx JSON { ok: false, codigo, erro } antes de começar (sessão, admin, limites, sem chave)
// Segurança: sessão + papel de admin conferidos no servidor; a chave da Groq só existe aqui
// (GROQ_API_KEY_ASSISTENTE, se houver, senão GROQ_API_KEY); limite por admin e pela cota da conta
// Groq (tabela ia_uso, sql/29); tamanho da pergunta e do histórico limitados; nenhum dado de
// cliente vai para o modelo; erro da Groq não chega ao navegador com detalhes.
import { criarDb } from './supabase.js';
import { json, lerCorpo, exigirUsuario, exigirCadastroCompleto, registrarErro } from './http.js';
import { selecionarContexto } from './conhecimento.js';
import { ASSISTENTE, estimarTokens } from '../config/assistente.config.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MOTIVOS = {
  usuario_minuto: 'Você enviou muitas perguntas em sequência. Aguarde 1 minuto.',
  usuario_dia: 'Você chegou ao limite diário de perguntas ao assistente. Volta amanhã.',
  conta_minuto: 'O limite gratuito da IA por minuto foi atingido. Aguarde 1 minuto e tente de novo.',
  conta_dia: 'O limite gratuito diário da IA foi atingido. Volta a funcionar amanhã.'
};

const falha = (res, status, codigo, erro) => json(res, status, { ok: false, codigo, erro });

// Valida e corta a conversa recebida (o histórico vem do navegador: é dado, não instrução)
export function prepararConversa(mensagens, cfg = ASSISTENTE) {
  if (!Array.isArray(mensagens) || !mensagens.length || mensagens.length > 60) return { erro: 'Conversa inválida.' };
  const limpas = mensagens
    .filter((m) => m && (m.papel === 'user' || m.papel === 'assistente') && typeof m.texto === 'string')
    .map((m) => ({ role: m.papel === 'user' ? 'user' : 'assistant', content: m.texto.replace(/\u0000/g, '').trim() }))
    .filter((m) => m.content);
  const ultima = limpas[limpas.length - 1];
  if (!ultima || ultima.role !== 'user') return { erro: 'Escreva uma pergunta.' };
  if (ultima.content.length > cfg.caracteresMensagem) return { erro: `A pergunta passou de ${cfg.caracteresMensagem} caracteres. Resuma ou divida em partes.` };
  const historico = [];
  let tokens = 0;
  for (let i = limpas.length - 2; i >= 0 && historico.length < cfg.mensagensHistorico; i -= 1) {
    const m = { ...limpas[i], content: limpas[i].content.slice(0, 2400) };
    const t = estimarTokens(m.content) + 4;
    if (tokens + t > cfg.tokensHistorico) break;
    historico.unshift(m);
    tokens += t;
  }
  if (historico.length && historico[0].role === 'assistant') historico.shift(); // começa sempre por uma pergunta
  return { pergunta: ultima.content, historico, tokensHistorico: tokens };
}

export function montarSistema(contexto) {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long', year: 'numeric' });
  return [
    contexto.texto,
    '',
    `Data de hoje: ${hoje}. Você não tem acesso à internet nem a notícias em tempo real.`,
    contexto.semBase
      ? 'Base de conhecimento: nenhum trecho da base da CMK COGIT se aplica a esta pergunta. Se ela for sobre a própria empresa (serviços, preços, prazos, equipe, processos), diga que não tem essa informação na base, sem inventar.'
      : 'Os trechos acima, depois das regras, são a base de conhecimento da CMK COGIT para esta pergunta. Fatos da empresa só podem vir deles.'
  ].join('\n');
}

// Lê o streaming da Groq (SSE) e chama aoTexto para cada pedaço. Devolve uso e motivo de parada.
export async function lerStreamGroq(resposta, aoTexto) {
  const leitor = resposta.body.getReader();
  const dec = new TextDecoder();
  let resto = '';
  let uso = null;
  let motivo = null;
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    resto += dec.decode(value, { stream: true });
    const linhas = resto.split('\n');
    resto = linhas.pop();
    for (const l of linhas) {
      const s = l.trim();
      if (!s.startsWith('data:')) continue;
      const dado = s.slice(5).trim();
      if (dado === '[DONE]') return { uso, motivo };
      let j;
      try { j = JSON.parse(dado); } catch { continue; }
      const escolha = j.choices && j.choices[0];
      if (escolha && escolha.delta && typeof escolha.delta.content === 'string' && escolha.delta.content) aoTexto(escolha.delta.content);
      if (escolha && escolha.finish_reason) motivo = escolha.finish_reason;
      if (j.x_groq && j.x_groq.usage) uso = j.x_groq.usage;
      if (j.usage) uso = j.usage;
    }
  }
  return { uso, motivo };
}

export async function assistente(req, res, { env = process.env, fetchFn = fetch } = {}) {
  if (req.method !== 'POST') return falha(res, 405, 'metodo', 'Método não permitido.');

  let db;
  try { db = criarDb(env); } catch (e) { registrarErro('assistente:config', e); return falha(res, 500, 'config', 'Indisponível no momento.'); }
  const usuario = await exigirUsuario(req, res, db);
  if (!usuario) return;
  const perfil = await exigirCadastroCompleto(usuario, res, db);
  if (!perfil) return;
  if (perfil.role !== 'admin') return falha(res, 403, 'somente_admin', 'O assistente é exclusivo da equipe.');

  const chave = env.GROQ_API_KEY_ASSISTENTE || env.GROQ_API_KEY;
  if (!chave) return falha(res, 503, 'ia_indisponivel', 'O assistente ainda não está configurado (falta a chave da Groq na Vercel).');

  let corpo;
  try { corpo = await lerCorpo(req, 120000); } catch { return falha(res, 400, 'pedido', 'Conversa grande demais. Comece uma nova conversa.'); }
  const conversa = prepararConversa(corpo && corpo.mensagens);
  if (conversa.erro) return falha(res, 400, 'pedido', conversa.erro);

  // base de conhecimento: pergunta atual + a anterior (para perguntas de continuação, "e o prazo?")
  const anterior = [...conversa.historico].reverse().find((m) => m.role === 'user');
  const contexto = selecionarContexto(conversa.pergunta + ' ' + (anterior ? anterior.content : ''), { orcamento: ASSISTENTE.tokensBase });
  const sistema = montarSistema(contexto);
  const mensagens = [{ role: 'system', content: sistema }, ...conversa.historico, { role: 'user', content: conversa.pergunta }];
  const estimativa = estimarTokens(sistema) + conversa.tokensHistorico + estimarTokens(conversa.pergunta) + ASSISTENTE.maxTokensResposta + 30;

  // limite: por admin e pela cota da conta Groq (a cota é por modelo: só conta o recurso "assistente")
  let reserva;
  try {
    const g = ASSISTENTE.groq;
    const u = ASSISTENTE.porUsuario;
    reserva = await db.rpc('ia_reservar', {
      p_usuario: usuario.id, p_recurso: 'assistente', p_modelo: ASSISTENTE.modelo, p_tokens: estimativa,
      p_rpm: g.pedidosPorMinuto, p_rpd: g.pedidosPorDia, p_tpm: g.tokensPorMinuto, p_tpd: g.tokensPorDia,
      p_usuario_rpm: u.pedidosPorMinuto, p_usuario_rpd: u.pedidosPorDia
    });
  } catch (e) {
    registrarErro('assistente:limite', e);
    return falha(res, 503, 'limite_indisponivel', 'Não foi possível verificar o limite de uso agora. Tente de novo.');
  }
  if (!reserva || !reserva.ok) {
    if (reserva && reserva.espera) res.setHeader('Retry-After', String(reserva.espera));
    return falha(res, 429, 'ia_limite', MOTIVOS[reserva && reserva.motivo] || 'Limite de uso atingido. Tente mais tarde.');
  }

  // chama a Groq (modelo principal; se sair do ar ou estourar a cota, o de reserva)
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), ASSISTENTE.tempoMaxMs);
  if (res.on) res.on('close', () => { if (!res.writableEnded) controle.abort(); }); // a pessoa fechou: para de gerar
  let resposta = null;
  let modeloUsado = null;
  try {
    for (const modelo of [ASSISTENTE.modelo, ASSISTENTE.modeloReserva].filter(Boolean)) {
      const r = await fetchFn(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + chave },
        body: JSON.stringify({
          model: modelo, messages: mensagens, stream: true,
          temperature: ASSISTENTE.temperatura, max_completion_tokens: ASSISTENTE.maxTokensResposta,
          ...(/^openai\/gpt-oss/.test(modelo) ? { reasoning_effort: ASSISTENTE.esforcoRaciocinio } : {})
        }),
        signal: controle.signal
      });
      if (r.ok) { resposta = r; modeloUsado = modelo; break; }
      const erroJson = await r.json().catch(() => ({}));
      const codigo = (erroJson.error && (erroJson.error.code || erroJson.error.type)) || '';
      registrarErro('assistente:groq', { status: r.status, message: codigo || 'erro' });
      if (r.status === 404 || r.status === 429 || /model_not_found|model_decommissioned/.test(codigo)) continue;
      if (r.status === 401 || r.status === 403) { clearTimeout(timer); return falha(res, 502, 'ia_chave', 'A chave da Groq foi recusada. Confira a variável na Vercel.'); }
      clearTimeout(timer);
      return falha(res, 502, 'ia_falhou', 'A IA não respondeu agora. Tente de novo.');
    }
  } catch (e) {
    clearTimeout(timer);
    registrarErro('assistente:rede', e);
    return falha(res, 504, 'ia_falhou', e && e.name === 'AbortError' ? 'A IA demorou demais para responder. Tente de novo.' : 'Não foi possível falar com a IA agora.');
  }
  if (!resposta) { clearTimeout(timer); return falha(res, 429, 'ia_limite', MOTIVOS.conta_minuto); }

  // streaming para o navegador (uma linha JSON por evento)
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  const enviar = (o) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
  enviar({ t: 'inicio', base: contexto.usados.filter((u) => !u.nucleo).map((u) => u.rotulo) });
  let fim = { uso: null, motivo: null };
  try {
    fim = await lerStreamGroq(resposta, (c) => enviar({ t: 'd', c }));
    enviar({ t: 'fim', motivo: fim.motivo === 'length' ? 'limite' : 'ok' });
  } catch (e) {
    if (!(e && e.name === 'AbortError')) registrarErro('assistente:stream', e);
    enviar({ t: 'erro', codigo: 'ia_interrompida', erro: 'A resposta foi interrompida. Tente de novo.' });
  } finally {
    clearTimeout(timer);
    if (!res.writableEnded) res.end();
  }
  // grava os tokens reais (melhor esforço)
  const total = fim.uso && (fim.uso.total_tokens || (fim.uso.prompt_tokens || 0) + (fim.uso.completion_tokens || 0));
  if (reserva.id && total) db.rpc('ia_registrar_uso', { p_id: reserva.id, p_tokens: total, p_modelo: modeloUsado }).catch((e) => registrarErro('assistente:uso', e));
}
