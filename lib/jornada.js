// Jornada MVP — trilha de módulos que o cliente (mentorado) preenche e a equipe (mentor)
// revisa; no fim, a IA lê as respostas e o SERVIDOR monta o orçamento do MVP.
//
// Este arquivo é a fonte única da trilha (módulos e etapas) e dos parâmetros de preço.
// Para mudar perguntas, acrescentar módulos ou ajustar valores, mexa só aqui.
// A IA nunca define preço: ela só lista funcionalidades e classifica a complexidade;
// horas e valores saem de PARAMETROS (mesma regra do resto da plataforma: preço é do servidor).

export const LIMITE_RESPOSTA = 1500;
export const LIMITE_TITULO = 80;

// tipo: 'texto' (resposta livre) | 'unica' (uma opção) | 'multipla' (várias opções)
// opcional: true = não trava o envio do módulo
export const MODULOS = [
  {
    id: 'proposta-valor', nome: 'Proposta de Valor', icone: 'criar',
    resumo: 'Qual problema o seu produto resolve, para quem e por que ele é melhor que o jeito atual.',
    etapas: [
      { id: 'problema', titulo: 'O problema', pergunta: 'Qual problema você quer resolver? Conte uma situação real em que ele acontece.', dica: 'Quanto mais concreto, melhor: quem passa por isso, com que frequência e o que perde (tempo, dinheiro, clientes).' },
      { id: 'publico', titulo: 'Para quem', pergunta: 'Quem sofre com esse problema? Descreva o seu cliente ideal.', dica: 'Idade, profissão, tipo de empresa, cidade, hábitos. Se houver mais de um perfil, liste todos.' },
      { id: 'solucao', titulo: 'A solução', pergunta: 'Como o seu produto resolve o problema? Descreva em poucas frases o que ele faz.' },
      { id: 'hoje', titulo: 'Como é hoje', pergunta: 'Como essas pessoas resolvem o problema hoje, sem o seu produto?', dica: 'Planilha, caderno, WhatsApp, outro sistema, não resolvem...' },
      { id: 'diferencial', titulo: 'Diferencial', pergunta: 'Por que alguém escolheria o seu produto em vez do que já existe?' }
    ]
  },
  {
    id: 'mapa-concorrencia', nome: 'Mapa da Concorrência', icone: 'atrair',
    resumo: 'Quem já atende o seu público e o que dá para fazer melhor.',
    etapas: [
      { id: 'concorrentes', titulo: 'Concorrentes', pergunta: 'Liste de 3 a 5 concorrentes diretos ou indiretos (nome e site, se tiver).' },
      { id: 'fortes', titulo: 'Pontos fortes deles', pergunta: 'O que esses concorrentes fazem bem?' },
      { id: 'fracos', titulo: 'Pontos fracos deles', pergunta: 'Do que os clientes deles reclamam? O que falta?' },
      { id: 'precos', titulo: 'Preços praticados', pergunta: 'Quanto e como eles cobram (mensalidade, comissão, valor único)?', opcional: true },
      { id: 'referencias', titulo: 'Referências', pergunta: 'Há algum aplicativo ou site que você gostaria de usar como referência de funcionamento ou de aparência?', opcional: true }
    ]
  },
  {
    id: 'mapa-stakeholders', nome: 'Mapa de Stakeholders', icone: 'equipe',
    resumo: 'Todas as pessoas que vão usar, pagar, administrar ou ser afetadas pelo produto.',
    etapas: [
      { id: 'perfis', titulo: 'Perfis de usuário', pergunta: 'Quais tipos de pessoa vão entrar no sistema? Para cada um, diga o que pode ver e fazer.', dica: 'Exemplo: cliente final (agenda horário), profissional (vê a agenda), dono (vê relatórios e cadastra equipe).' },
      { id: 'pagador', titulo: 'Quem paga', pergunta: 'Quem paga pelo produto? É a mesma pessoa que usa?' },
      { id: 'administracao', titulo: 'Quem administra', pergunta: 'Quem vai cuidar do sistema no dia a dia (cadastros, atendimento, conteúdo)?' },
      { id: 'parceiros', titulo: 'Parceiros e terceiros', pergunta: 'Existem parceiros, fornecedores ou órgãos que precisam receber ou enviar informações?', opcional: true }
    ]
  },
  {
    id: 'modelo-negocio', nome: 'Modelo de Negócio & Marketing', icone: 'valor',
    resumo: 'Como o produto ganha dinheiro e como os clientes chegam até ele.',
    etapas: [
      { id: 'receita', titulo: 'Fonte de receita', pergunta: 'Como o produto vai ganhar dinheiro?', tipo: 'multipla', opcoes: [
        { id: 'assinatura', nome: 'Assinatura (mensal ou anual)' }, { id: 'venda', nome: 'Venda de produtos ou serviços' },
        { id: 'comissao', nome: 'Comissão por transação' }, { id: 'anuncios', nome: 'Anúncios' },
        { id: 'gratuito', nome: 'Uso gratuito (sem cobrança no início)' }, { id: 'interno', nome: 'Uso interno da minha empresa' }
      ] },
      { id: 'cobranca', titulo: 'Cobrança dentro do produto', pergunta: 'O pagamento acontece dentro do sistema?', tipo: 'unica', opcoes: [
        { id: 'sim', nome: 'Sim, o cliente paga dentro do sistema (Pix, cartão, boleto)' },
        { id: 'fora', nome: 'Não, a cobrança é feita por fora' }, { id: 'depois', nome: 'Só numa próxima fase' }
      ] },
      { id: 'precos', titulo: 'Preços', pergunta: 'Quanto você pretende cobrar? Existem planos diferentes?', opcional: true },
      { id: 'canais', titulo: 'Canais de aquisição', pergunta: 'Como os clientes vão descobrir e chegar ao produto?', dica: 'Instagram, Google, indicação, vendedores, parceiros, eventos...' },
      { id: 'metas', titulo: 'Meta dos primeiros meses', pergunta: 'Quantos clientes ou usuários você espera nos primeiros 6 meses?' }
    ]
  },
  {
    id: 'jornada-usuario', nome: 'Jornada do Usuário', icone: 'operacao',
    resumo: 'O caminho que a pessoa faz dentro do produto, do primeiro acesso ao resultado.',
    etapas: [
      { id: 'entrada', titulo: 'Primeiro acesso', pergunta: 'Como a pessoa começa a usar? Precisa criar conta? Com quais dados?' },
      { id: 'principal', titulo: 'Caminho principal', pergunta: 'Descreva, passo a passo, o uso mais importante do produto, do começo até o resultado.', dica: 'Escreva como uma lista: 1) entra, 2) escolhe..., 3) confirma..., 4) recebe...' },
      { id: 'secundarios', titulo: 'Outros caminhos', pergunta: 'Que outras tarefas as pessoas fazem com frequência no produto?', opcional: true },
      { id: 'avisos', titulo: 'Avisos', pergunta: 'Em que momentos a pessoa precisa ser avisada, e por onde (e-mail, WhatsApp, notificação)?' }
    ]
  },
  {
    id: 'funcionalidades', nome: 'Funcionalidades do MVP', icone: 'checklist',
    resumo: 'O que precisa existir no primeiro dia, o que pode esperar e o que fica de fora.',
    etapas: [
      { id: 'essenciais', titulo: 'Essenciais', pergunta: 'Sem quais funcionalidades o produto não pode ser lançado?', dica: 'Uma por linha. Pense no mínimo que já entrega valor.' },
      { id: 'desejaveis', titulo: 'Desejáveis', pergunta: 'O que seria bom ter, mas pode ficar para uma segunda versão?', opcional: true },
      { id: 'fora', titulo: 'Fora do escopo', pergunta: 'O que você já sabe que NÃO entra agora?', opcional: true },
      { id: 'relatorios', titulo: 'Relatórios e indicadores', pergunta: 'Que números você precisa acompanhar no painel (vendas, cadastros, agendamentos...)?', opcional: true }
    ]
  },
  {
    id: 'dados-integracoes', nome: 'Dados & Integrações', icone: 'link',
    resumo: 'As informações que o sistema guarda e os serviços externos com que conversa.',
    etapas: [
      { id: 'cadastros', titulo: 'Cadastros', pergunta: 'Que informações o sistema precisa guardar?', dica: 'Exemplo: clientes, produtos, pedidos, agendamentos, documentos, fotos.' },
      { id: 'integracoes', titulo: 'Integrações', pergunta: 'Com quais serviços o produto precisa se conectar?', tipo: 'multipla', opcional: true, opcoes: [
        { id: 'pagamento', nome: 'Pagamento online (Pix, cartão, boleto)' }, { id: 'whatsapp', nome: 'WhatsApp' },
        { id: 'email', nome: 'Envio de e-mails' }, { id: 'nota-fiscal', nome: 'Nota fiscal' },
        { id: 'mapas', nome: 'Mapas e localização' }, { id: 'agenda', nome: 'Agenda (Google Calendar)' },
        { id: 'login-social', nome: 'Entrar com Google ou redes sociais' }, { id: 'ia', nome: 'Inteligência artificial' },
        { id: 'sistema-existente', nome: 'Um sistema que eu já uso (ERP, CRM, planilha)' }
      ] },
      { id: 'integracoes-detalhe', titulo: 'Detalhes das integrações', pergunta: 'Explique o que cada integração precisa fazer e com qual sistema.', opcional: true },
      { id: 'dados-sensiveis', titulo: 'Dados sensíveis', pergunta: 'O sistema vai guardar dados sensíveis (saúde, documentos, dados financeiros, menores de idade)?' }
    ]
  },
  {
    id: 'operacao-prazo', nome: 'Operação & Prazo', icone: 'prazo',
    resumo: 'Onde o produto roda, quando precisa ficar pronto e o que já existe.',
    etapas: [
      { id: 'plataformas', titulo: 'Onde vai rodar', pergunta: 'Em quais plataformas o produto precisa funcionar no lançamento?', tipo: 'multipla', opcoes: [
        { id: 'web', nome: 'Site / sistema no navegador (computador e celular)' },
        { id: 'android', nome: 'Aplicativo Android (loja)' }, { id: 'ios', nome: 'Aplicativo iPhone (loja)' },
        { id: 'painel', nome: 'Painel administrativo separado' }
      ] },
      { id: 'prazo', titulo: 'Prazo', pergunta: 'Quando você precisa do MVP no ar?', tipo: 'unica', opcoes: [
        { id: '30', nome: 'Em até 30 dias' }, { id: '60', nome: 'Em até 60 dias' },
        { id: '90', nome: 'Em até 90 dias' }, { id: 'flexivel', nome: 'Tenho flexibilidade' }
      ] },
      { id: 'existente', titulo: 'O que já existe', pergunta: 'Você já tem marca, domínio, telas desenhadas, textos ou algum sistema pronto?' },
      { id: 'investimento', titulo: 'Investimento previsto', pergunta: 'Existe um teto de investimento para esta primeira versão?', opcional: true }
    ]
  }
];

export const STATUS_MODULO = ['aberto', 'enviado', 'ajustes', 'aprovado'];
export const moduloPorId = (id) => MODULOS.find((m) => m.id === id) || null;

// Parâmetros do orçamento. Valor da hora: variável JORNADA_VALOR_HORA (padrão abaixo).
export const PARAMETROS = {
  valorHora: 90,
  horas: { baixa: 6, media: 16, alta: 40 },
  basePercentual: 25,   // arquitetura, design do produto, testes e publicação, sobre as horas das funcionalidades
  margemSuperior: 25,   // a estimativa é uma faixa: do valor calculado até +25%
  horasPorSemana: 30,   // ritmo da equipe, para estimar o prazo
  maxFuncionalidades: 30
};

const COMPLEXIDADES = ['baixa', 'media', 'alta'];
const PRIORIDADES = ['essencial', 'desejavel', 'futuro'];

export function limpar(valor, max) {
  if (typeof valor !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return valor.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

// Fica só com o que a definição do módulo aceita (etapas conhecidas, opções válidas, tamanho).
export function sanitizarRespostas(modulo, bruto) {
  const b = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
  const out = {};
  for (const e of modulo.etapas) {
    const v = b[e.id];
    if (e.tipo === 'multipla') {
      const ids = new Set(e.opcoes.map((o) => o.id));
      const lista = [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && ids.has(x)))];
      if (lista.length) out[e.id] = lista;
    } else if (e.tipo === 'unica') {
      if (typeof v === 'string' && e.opcoes.some((o) => o.id === v)) out[e.id] = v;
    } else {
      const t = limpar(v, LIMITE_RESPOSTA);
      if (t) out[e.id] = t;
    }
  }
  return out;
}

const respondida = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v));

export function etapasPendentes(modulo, respostas = {}) {
  return modulo.etapas.filter((e) => !e.opcional && !respondida(respostas[e.id]));
}

export function progressoModulo(modulo, respostas = {}) {
  const feitas = modulo.etapas.filter((e) => respondida(respostas[e.id])).length;
  return { feitas, total: modulo.etapas.length };
}

function respostaEmTexto(etapa, v) {
  if (!respondida(v)) return '';
  const nome = (id) => (etapa.opcoes.find((o) => o.id === id) || {}).nome || id;
  if (etapa.tipo === 'multipla') return v.map(nome).join('; ');
  if (etapa.tipo === 'unica') return nome(v);
  return String(v).replace(/\s+/g, ' ');
}

// Texto que a IA lê: todas as respostas, módulo por módulo.
export function montarPrompt(titulo, linhasModulos, limite = 14000) {
  const porId = new Map(linhasModulos.map((l) => [l.modulo, l.respostas || {}]));
  const partes = ['Produto: ' + (limpar(titulo, LIMITE_TITULO) || 'sem nome')];
  for (const m of MODULOS) {
    const r = porId.get(m.id) || {};
    const linhas = m.etapas.map((e) => [e, respostaEmTexto(e, r[e.id])]).filter(([, t]) => t)
      .map(([e, t]) => '- ' + e.titulo + ': ' + t.slice(0, 700));
    if (linhas.length) partes.push('## ' + m.nome + ' [' + m.id + ']\n' + linhas.join('\n'));
  }
  return partes.join('\n\n').slice(0, limite);
}

export const SISTEMA_ORCAMENTO = [
  'Você é analista de produto da CMKCOGIT, um estúdio brasileiro que desenvolve sites, sistemas e MVPs.',
  'Você recebe as respostas de um cliente sobre o produto digital que ele quer construir e devolve o escopo do MVP: a lista de funcionalidades de software necessárias.',
  'Regras:',
  '- Baseie-se somente no que o cliente escreveu. Não invente necessidades; o que for dúvida vai em "perguntas".',
  '- Cada funcionalidade é uma entrega de software concreta (ex.: "Cadastro e login", "Agendamento online", "Pagamento por Pix"), com descrição de uma frase.',
  '- Inclua as funcionalidades de base que o produto descrito exige mesmo que o cliente não cite (ex.: login, painel administrativo), marcando-as como essenciais.',
  '- complexidade: "baixa" (telas simples, cadastros), "media" (regras de negócio, fluxos com várias etapas, relatórios) ou "alta" (pagamentos, integrações com outros sistemas, tempo real, aplicativo de loja, IA).',
  '- prioridade: "essencial" (sem ela o MVP não lança), "desejavel" (segunda versão) ou "futuro" (o cliente deixou de fora ou é ideia distante).',
  '- modulo: o identificador entre colchetes do módulo de onde a necessidade veio.',
  '- Nunca escreva valores em dinheiro, horas ou prazos: isso é calculado depois pela equipe.',
  '- Entre 6 e 20 funcionalidades, sem repetir. Escreva em português do Brasil, linguagem simples.'
].join('\n');

export const ESQUEMA_ORCAMENTO = {
  type: 'OBJECT',
  properties: {
    resumo: { type: 'STRING' },
    funcionalidades: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          nome: { type: 'STRING' }, descricao: { type: 'STRING' },
          complexidade: { type: 'STRING', enum: COMPLEXIDADES },
          prioridade: { type: 'STRING', enum: PRIORIDADES },
          modulo: { type: 'STRING' }
        },
        required: ['nome', 'descricao', 'complexidade', 'prioridade']
      }
    },
    premissas: { type: 'ARRAY', items: { type: 'STRING' } },
    riscos: { type: 'ARRAY', items: { type: 'STRING' } },
    perguntas: { type: 'ARRAY', items: { type: 'STRING' } }
  },
  required: ['resumo', 'funcionalidades']
};

export const FORMATO_ORCAMENTO = 'Responda somente com um objeto JSON no formato {"resumo":"2 a 3 frases sobre o produto","funcionalidades":[{"nome":"...","descricao":"...","complexidade":"baixa|media|alta","prioridade":"essencial|desejavel|futuro","modulo":"id-do-modulo"}],"premissas":["..."],"riscos":["..."],"perguntas":["..."]}. Até 5 itens em premissas, riscos e perguntas.';

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const lista = (v, max, tam) => (Array.isArray(v) ? v : []).map((x) => limpar(x, tam)).filter(Boolean).slice(0, max);
const dezena = (n) => Math.round(n / 10) * 10;

// Confere o que a IA devolveu: só entra o que está no formato esperado.
export function normalizarEscopo(dados) {
  const d = dados && typeof dados === 'object' ? dados : {};
  const vistos = new Set();
  const funcionalidades = [];
  for (const f of Array.isArray(d.funcionalidades) ? d.funcionalidades : []) {
    const nome = limpar(f && f.nome, 80);
    const chave = semAcento(nome);
    if (!nome || vistos.has(chave)) continue;
    vistos.add(chave);
    const complexidade = COMPLEXIDADES.find((c) => c === semAcento(f.complexidade)) || 'media';
    const prioridade = PRIORIDADES.find((p) => p === semAcento(f.prioridade)) || 'desejavel';
    funcionalidades.push({
      nome, descricao: limpar(f.descricao, 240), complexidade, prioridade,
      modulo: moduloPorId(f.modulo) ? f.modulo : null
    });
    if (funcionalidades.length >= PARAMETROS.maxFuncionalidades) break;
  }
  return {
    resumo: limpar(d.resumo, 600), funcionalidades,
    premissas: lista(d.premissas, 5, 240), riscos: lista(d.riscos, 5, 240), perguntas: lista(d.perguntas, 5, 240)
  };
}

export function valorHora(env = process.env) {
  const n = Number(env.JORNADA_VALOR_HORA);
  return Number.isFinite(n) && n >= 20 && n <= 2000 ? n : PARAMETROS.valorHora;
}

/**
 * Preço do escopo. Só o servidor chama.
 * @param escopo saída de normalizarEscopo
 * @param {{ valorHora?: number, piso?: number|null }} o  piso: preço "a partir de" do item mvp do catálogo
 */
export function calcularOrcamento(escopo, { valorHora: vh = PARAMETROS.valorHora, piso = null } = {}) {
  const P = PARAMETROS;
  const itens = escopo.funcionalidades.map((f) => {
    const horas = P.horas[f.complexidade];
    return { ...f, horas, valor: f.prioridade === 'futuro' ? null : horas * vh };
  });
  const fase = (prioridade, comBase) => {
    const doGrupo = itens.filter((i) => i.prioridade === prioridade);
    const horasItens = doGrupo.reduce((t, i) => t + i.horas, 0);
    const horasBase = comBase ? Math.ceil((horasItens * P.basePercentual) / 100) : 0;
    const horas = horasItens + horasBase;
    return { quantidade: doGrupo.length, horas_funcionalidades: horasItens, horas_base: horasBase, horas, valor: dezena(horas * vh), semanas: horas ? Math.max(1, Math.ceil(horas / P.horasPorSemana)) : 0 };
  };
  const mvp = fase('essencial', true);
  const evolucao = fase('desejavel', false);
  const pisoNum = Number(piso);
  const pisoAplicado = Number.isFinite(pisoNum) && pisoNum > mvp.valor && mvp.quantidade > 0;
  const valorMin = pisoAplicado ? pisoNum : mvp.valor;
  return {
    itens, mvp, evolucao,
    valor_min: valorMin,
    valor_max: dezena((valorMin * (100 + P.margemSuperior)) / 100),
    piso_aplicado: pisoAplicado,
    parametros: { valor_hora: vh, horas: P.horas, base_percentual: P.basePercentual, margem_superior: P.margemSuperior, horas_por_semana: P.horasPorSemana }
  };
}
