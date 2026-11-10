// /api/mensagens-ia   (só admin) — também serve o Assistente IA (?modo=assistente, lib/assistente.js) — sugestões de mensagens com IA (Groq gratuita ou Gemini, lib/ia.js)
//   POST { acao: 'sugerir',   conversa_id, tom? }              -> 3 respostas para a conversa
//   POST { acao: 'reescrever', texto, tom?, canal? }            -> 3 versões melhores do rascunho
//   POST { acao: 'construir', objetivo, detalhes?, tom?, canal?, destinatario? } -> 3 mensagens prontas
//   -> { ok, sugestoes: [{ titulo, texto }] }
// A IA não inventa valores, datas ou links: o que faltar vem entre colchetes para a equipe completar.
import { criarDb } from '../lib/supabase.js';
import { json, erro, lerCorpo, exigirUsuario, exigirCadastroCompleto, registrarErro, UUID } from '../lib/http.js';
import { gerarJson, ErroIA } from '../lib/ia.js';
import { assistente } from '../lib/assistente.js';

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
      items: {
        type: 'OBJECT',
        properties: { titulo: { type: 'STRING' }, texto: { type: 'STRING' } },
        required: ['titulo', 'texto']
      }
    }
  },
  required: ['sugestoes']
};

// O mesmo formato do ESQUEMA, em texto (a Groq usa "modo JSON", sem esquema)
export const FORMATO_JSON = 'Responda somente com um objeto JSON no formato {"sugestoes":[{"titulo":"...","texto":"..."}]}, com exatamente 3 itens. No campo "texto", use \\n para quebrar linha.';

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

const ASSUNTOS = { duvida: 'dúvida', prazo: 'prazo e andamento', alteracao: 'pedido de alteração', material: 'envio de material', pagamento: 'pagamento', outro: 'outro' };
const limpar = (v, max) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);

function linhaDaConversa(m, clienteId) {
  const quem = m.interna ? 'Nota interna da equipe (' + (m.autor_nome || 'equipe') + ')'
    : m.autor_papel === 'admin' ? 'Equipe (' + (m.autor_nome || 'equipe') + ')'
      : m.autor_id === clienteId ? 'Cliente' : (m.autor_nome || 'Pessoa');
  const conteudo = m.tipo === 'audio' ? '[enviou um áudio]' : m.tipo === 'arquivo' ? '[enviou o arquivo ' + (m.anexo_nome || '') + ']' + (m.corpo ? ' ' + m.corpo : '') : m.corpo;
  const assunto = ASSUNTOS[m.assunto] ? ' [assunto: ' + ASSUNTOS[m.assunto] + ']' : '';
  return quem + assunto + ': ' + String(conteudo || '').replace(/\s+/g, ' ').slice(0, 500);
}

export async function montarPedido(db, corpo) {
  const acao = corpo.acao;
  const tom = TONS[corpo.tom] ? corpo.tom : 'profissional';
  const canal = corpo.canal === 'whatsapp' ? 'whatsapp' : 'plataforma';
  const partes = ['Tom desejado: ' + TONS[tom] + '.'];

  if (acao === 'sugerir') {
    if (!UUID.test(corpo.conversa_id || '')) throw new ErroIA('pedido', 'Escolha uma conversa.', 400);
    const conversa = await db.um('conversas', { select: 'id,tipo,cliente_id,membros', id: 'eq.' + corpo.conversa_id });
    if (!conversa) throw new ErroIA('pedido', 'Conversa não encontrada.', 404);
    const [mensagens, cliente] = await Promise.all([
      db.select('mensagens', {
        select: 'autor_id,autor_nome,autor_papel,tipo,corpo,interna,anexo_nome,assunto,created_at',
        conversa_id: 'eq.' + conversa.id, apagada_em: 'is.null', order: 'created_at.desc', limit: '15'
      }),
      conversa.cliente_id ? db.um('profiles', { select: 'nome', id: 'eq.' + conversa.cliente_id }) : null
    ]);
    if (!mensagens.length) throw new ErroIA('pedido', 'A conversa ainda não tem mensagens. Use "Construir mensagem" para começar.', 400);
    const ordem = mensagens.slice().reverse();
    partes.push(conversa.tipo === 'cliente'
      ? 'Conversa entre a equipe e o cliente ' + ((cliente && cliente.nome) || '') + '. Escreva a PRÓXIMA resposta da equipe para o cliente. As notas internas são só contexto: nunca as revele ao cliente.'
      : 'Conversa interna entre pessoas da equipe. Escreva a próxima resposta, em tom de colega de trabalho.');
    partes.push('Histórico (mais antigo primeiro):\n' + ordem.map((m) => linhaDaConversa(m, conversa.cliente_id)).join('\n'));
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

export default async function handler(req, res) {
  // Assistente IA (chat com streaming): mesma função, para caber no limite de 12 funções da Vercel
  if (req.query && req.query.modo === 'assistente') return assistente(req, res);
  if (req.method !== 'POST') return erro(res, 405, 'Método não permitido.');

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('mensagens-ia:config', e); return erro(res, 500, 'Indisponível no momento.'); }

  const usuario = await exigirUsuario(req, res, db);
  if (!usuario) return;
  const perfil = await exigirCadastroCompleto(usuario, res, db);
  if (!perfil) return;
  if (perfil.role !== 'admin') return json(res, 403, { ok: false, codigo: 'somente_admin', erro: 'As sugestões com IA são da equipe.' });

  let corpo;
  try { corpo = await lerCorpo(req, 20000); } catch { return erro(res, 400, 'Requisição inválida.'); }

  try {
    const pedido = await montarPedido(db, corpo || {});
    const dados = await gerarJson({ sistema: instrucoesSistema(pedido.canal), prompt: pedido.prompt, esquema: ESQUEMA, formatoJson: FORMATO_JSON });
    const sugestoes = normalizarSugestoes(dados);
    if (!sugestoes.length) return erro(res, 502, 'A IA não trouxe sugestões desta vez. Tente de novo.');
    return json(res, 200, { ok: true, sugestoes });
  } catch (e) {
    if (e instanceof ErroIA) {
      if (e.status >= 500) registrarErro('mensagens-ia', e);
      return json(res, e.status, { ok: false, codigo: e.codigo, erro: e.message });
    }
    registrarErro('mensagens-ia', e);
    return erro(res, 500, 'Não foi possível gerar sugestões agora.');
  }
}
