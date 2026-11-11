// Documento detalhado do orçamento do MVP (o produto de R$ 30): prompt, JSON Schema e validação.
//
// Regra de preço da plataforma: a IA NUNCA define valor, horas nem prazo. Escopo, faixa de valor e
// semanas vêm do resumo grátis já calculado pelo servidor (lib/jornada.js -> jornada_orcamentos).
// O Claude só detalha: funcionalidades da lista (sem criar itens com preço), premissas, pontos de
// atenção e perguntas em aberto ESPECÍFICOS deste projeto, cada um apoiado numa resposta do cliente.
import { MODULOS, montarPrompt, limpar } from './jornada.js';

export const VERSAO_DOCUMENTO = 1;

export const SISTEMA_DOCUMENTO = [
  'Você é analista de produto sênior da CMK COGIT, estúdio brasileiro que desenvolve sites, sistemas e MVPs.',
  'Você recebe (1) as respostas de uma pessoa sobre o produto digital que ela quer construir, organizadas por módulo, (2) o escopo do MVP já definido pela equipe (lista fechada de funcionalidades) e (3) eventuais observações do mentor dela.',
  'Sua tarefa: escrever o conteúdo do documento detalhado de orçamento do MVP, que a pessoa vai usar para decidir e para conversar com sócios, mentores e investidores.',
  '',
  'Regras de conteúdo:',
  '- Use somente o que está nas respostas e no escopo. Nada de inventar números de mercado, concorrentes, leis ou integrações que não foram citados. O que faltar vira pergunta em aberto.',
  '- Nunca escreva valores em dinheiro, horas, semanas ou datas. Preço e prazo são calculados pela equipe e entram no documento por fora.',
  '- "funcionalidades": detalhe CADA item do escopo, usando exatamente o mesmo nome. Não crie funcionalidades novas; se notar algo que falta, coloque em "fora_do_escopo" (com o motivo) ou em "perguntas_em_aberto".',
  '- "criterios_aceite": de 2 a 4 frases verificáveis no formato "Quando..., então...", usando os perfis e termos do próprio projeto.',
  '- "premissas": o que está sendo assumido para o escopo valer. Cada uma com "base" dizendo qual resposta (módulo e assunto) a sustenta. De 4 a 8.',
  '- "pontos_de_atencao": riscos concretos deste projeto (ex.: dependência de um parceiro citado, dado sensível que o produto guarda, regra de negócio ambígua, público com pouca familiaridade digital). Cada um com impacto e uma ação prática para reduzir. De 3 a 8.',
  '- "perguntas_em_aberto": decisões que a pessoa ainda não tomou e que mudam escopo, custo ou prazo. Diga por que cada uma importa. De 3 a 8.',
  '- Proibido texto genérico que serviria para qualquer projeto, como "a comunicação entre as partes é essencial", "prazos podem variar", "é importante testar com usuários", "o sucesso depende do mercado". Se uma frase continuaria verdadeira trocando o nome do produto, reescreva com um fato do projeto ou apague.',
  '- Português do Brasil, frases curtas, linguagem simples (a pessoa pode não ser técnica). Sem markdown, sem emojis.'
].join('\n');

const str = { type: 'string' };
const listaDe = (props) => ({
  type: 'array',
  items: { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props }
});

export const ESQUEMA_DOCUMENTO = {
  type: 'object',
  additionalProperties: false,
  required: ['titulo', 'resumo_executivo', 'problema', 'publico_alvo', 'proposta_valor', 'funcionalidades', 'fora_do_escopo',
    'perfis_usuario', 'fluxo_principal', 'dados_e_integracoes', 'requisitos_nao_funcionais', 'premissas',
    'pontos_de_atencao', 'perguntas_em_aberto', 'proximos_passos'],
  properties: {
    titulo: str,
    resumo_executivo: str,
    problema: str,
    publico_alvo: listaDe({ segmento: str, necessidade: str }),
    proposta_valor: str,
    funcionalidades: listaDe({ nome: str, detalhamento: str, criterios_aceite: { type: 'array', items: str } }),
    fora_do_escopo: listaDe({ item: str, motivo: str }),
    perfis_usuario: listaDe({ perfil: str, pode: str }),
    fluxo_principal: { type: 'array', items: str },
    dados_e_integracoes: listaDe({ item: str, detalhe: str }),
    requisitos_nao_funcionais: { type: 'array', items: str },
    premissas: listaDe({ premissa: str, base: str }),
    pontos_de_atencao: listaDe({ titulo: str, detalhe: str, impacto: { type: 'string', enum: ['baixo', 'medio', 'alto'] }, como_reduzir: str }),
    perguntas_em_aberto: listaDe({ pergunta: str, por_que_importa: str }),
    proximos_passos: { type: 'array', items: str }
  }
};

// Frases que servem para qualquer projeto: o item é descartado (se sobrar pouco, a geração é refeita).
const GENERICAS = [
  /comunica[cç][aã]o (constante|clara|entre as partes)/i, /prazos? (pode|podem) variar/i, /sucesso (do projeto )?depende/i,
  /é (importante|fundamental|essencial) (testar|validar|ouvir)/i, /mudan[cç]as no escopo podem/i, /mercado (é|está) competitivo/i,
  /^(riscos? de )?atrasos?\.?$/i, /tecnologia (pode|podem) mudar/i
];
const generica = (t) => GENERICAS.some((r) => r.test(t));
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function lista(v, max, campos, tam = 400) {
  const out = [];
  for (const x of Array.isArray(v) ? v : []) {
    if (!x || typeof x !== 'object') continue;
    const o = {};
    for (const [c, t] of Object.entries(campos)) o[c] = Array.isArray(t) ? (t.includes(x[c]) ? x[c] : t[1]) : limpar(x[c], t || tam);
    const principal = o[Object.keys(campos)[0]];
    if (!principal || generica(Object.values(o).filter((s) => typeof s === 'string').join(' '))) continue;
    out.push(o);
    if (out.length >= max) break;
  }
  return out;
}
const textos = (v, max, tam = 300) => (Array.isArray(v) ? v : []).map((t) => limpar(t, tam)).filter((t) => t && !generica(t)).slice(0, max);

/**
 * Confere e limpa o que o Claude devolveu. As funcionalidades são casadas pelo nome com o escopo
 * calculado (itens de preço do servidor): itens novos são ignorados; itens sem detalhe ficam com a
 * descrição do resumo. Lança erro se o essencial faltar (o pedido vai para nova tentativa).
 */
export function validarDocumento(bruto, orcamento) {
  const d = bruto && typeof bruto === 'object' ? bruto : {};
  const detalhes = new Map();
  for (const f of Array.isArray(d.funcionalidades) ? d.funcionalidades : []) {
    if (!f || typeof f !== 'object') continue;
    detalhes.set(semAcento(f.nome), {
      detalhamento: limpar(f.detalhamento, 700),
      criterios_aceite: textos(f.criterios_aceite, 4, 260)
    });
  }
  const itens = (orcamento && Array.isArray(orcamento.itens) ? orcamento.itens : []).map((i) => {
    const det = detalhes.get(semAcento(i.nome)) || {};
    return {
      nome: i.nome, prioridade: i.prioridade, complexidade: i.complexidade,
      detalhamento: det.detalhamento || i.descricao || '', criterios_aceite: det.criterios_aceite || []
    };
  });
  const doc = {
    versao: VERSAO_DOCUMENTO,
    titulo: limpar(d.titulo, 120),
    resumo_executivo: limpar(d.resumo_executivo, 1200),
    problema: limpar(d.problema, 1000),
    publico_alvo: lista(d.publico_alvo, 6, { segmento: 120, necessidade: 400 }),
    proposta_valor: limpar(d.proposta_valor, 800),
    funcionalidades: itens,
    detalhadas: itens.filter((i) => detalhes.has(semAcento(i.nome))).length,
    fora_do_escopo: lista(d.fora_do_escopo, 10, { item: 160, motivo: 400 }),
    perfis_usuario: lista(d.perfis_usuario, 8, { perfil: 80, pode: 400 }),
    fluxo_principal: textos(d.fluxo_principal, 12, 240),
    dados_e_integracoes: lista(d.dados_e_integracoes, 10, { item: 120, detalhe: 400 }),
    requisitos_nao_funcionais: textos(d.requisitos_nao_funcionais, 8, 240),
    premissas: lista(d.premissas, 8, { premissa: 360, base: 200 }),
    pontos_de_atencao: lista(d.pontos_de_atencao, 8, { titulo: 120, detalhe: 500, impacto: ['baixo', 'medio', 'alto'], como_reduzir: 400 }),
    perguntas_em_aberto: lista(d.perguntas_em_aberto, 8, { pergunta: 300, por_que_importa: 400 }),
    proximos_passos: textos(d.proximos_passos, 6, 240)
  };
  const faltas = [];
  if (doc.resumo_executivo.length < 40) faltas.push('resumo');
  if (!itens.length) faltas.push('escopo');
  else if (doc.detalhadas < Math.ceil(itens.length / 2)) faltas.push('detalhe das funcionalidades');
  if (doc.premissas.length < 2) faltas.push('premissas');
  if (doc.pontos_de_atencao.length < 2) faltas.push('pontos de atenção');
  if (doc.perguntas_em_aberto.length < 2) faltas.push('perguntas em aberto');
  if (faltas.length) {
    const e = new Error('Documento incompleto: ' + faltas.join(', '));
    e.codigo = 'ia_incompleta';
    throw e;
  }
  return doc;
}

// Texto que o Claude lê: respostas + escopo fechado + observações do mentor.
export function montarEntrada({ titulo, modulos, orcamento, comentarios = [] }) {
  const o = orcamento || {};
  const escopo = (o.itens || []).map((i) => '- ' + i.nome + ' [' + i.prioridade + ', complexidade ' + i.complexidade + ']: ' + (i.descricao || ''))
    .join('\n');
  const notas = comentarios.filter((c) => c && c.body).slice(-20)
    .map((c) => '- ' + (c.modulo ? '[' + c.modulo + '] ' : '') + limpar(c.body, 400)).join('\n');
  return [
    '# Respostas da pessoa',
    montarPrompt(titulo, modulos, 24000),
    '# Resumo já entregue (gratuito)',
    limpar(o.resumo, 600) || '(sem resumo)',
    '# Escopo do MVP definido pela equipe (detalhe todos, mesmos nomes)',
    escopo || '(vazio)',
    ...(notas ? ['# Observações do mentor e da pessoa', notas] : []),
    '# Identificadores dos módulos',
    MODULOS.map((m) => m.id + ' = ' + m.nome).join('; ')
  ].join('\n\n');
}
