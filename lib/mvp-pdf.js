// PDF do orçamento detalhado do MVP, montado a partir do JSON validado (lib/mvp-documento.js).
// Template fixo da identidade COGIT 2026: Clash Display nos títulos, Satoshi no texto, marinho
// sobre papel claro, fios de 1 px, cantos retos, sem degradê e sem sombra.
// Valores, horas e semanas vêm do cálculo do servidor (jornada_orcamentos), nunca da IA.
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONTES = path.join(RAIZ, 'lib/fontes');   // TTF (convertidos dos WOFF2 da marca; o PDF não aceita WOFF2)
const LOGO = path.join(RAIZ, 'public/assets/marca/cogit-logo-grafite.svg');

const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const COR = {
  marinho: hex('#1A2C52'), grafite: hex('#121314'), texto2: hex('#55595E'), fio: hex('#D9DAD6'),
  caixa: hex('#EEF1F6'), ceu: hex('#8EA6D8'), papel: hex('#F8F8F6'),
  alto: hex('#B42318'), medio: hex('#8A5A00'), baixo: hex('#1E7A4C')
};
const A4 = [595.28, 841.89];
const M = 56;                       // margem
const LARG = A4[0] - 2 * M;

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const PRIORIDADE = { essencial: 'Essencial', desejavel: 'Segunda versão', futuro: 'Futuro' };
const COMPLEXIDADE = { baixa: 'baixa', media: 'média', alta: 'alta' };
const IMPACTO = { alto: 'Impacto alto', medio: 'Impacto médio', baixo: 'Impacto baixo' };

// Só caracteres que as fontes desenham (tira emoji/controle; troca aspas e traços tipográficos raros)
function limparTexto(t) {
  return String(t ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...')
    .replace(/[^ -~ -ſ–—•\n]/g, '').replace(/[ \t]+/g, ' ').trim();
}

function quebrar(texto, fonte, tam, largura) {
  const linhas = [];
  for (const par of limparTexto(texto).split('\n')) {
    let atual = '';
    for (const palavra of par.split(' ').filter(Boolean)) {
      const teste = atual ? atual + ' ' + palavra : palavra;
      if (fonte.widthOfTextAtSize(teste, tam) <= largura) { atual = teste; continue; }
      if (atual) linhas.push(atual);
      // palavra maior que a linha: corta
      let resto = palavra;
      while (fonte.widthOfTextAtSize(resto, tam) > largura) {
        let n = resto.length;
        while (n > 1 && fonte.widthOfTextAtSize(resto.slice(0, n), tam) > largura) n--;
        linhas.push(resto.slice(0, n));
        resto = resto.slice(n);
      }
      atual = resto;
    }
    linhas.push(atual);
  }
  return linhas;
}

async function caminhosDoLogo() {
  const svg = await readFile(LOGO, 'utf8');
  return [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
}

/**
 * @param {{ doc, orcamento, jornada, cliente, pedido, validade, creditoDias }} o
 *   doc: saída de validarDocumento · orcamento: jornada_orcamentos.dados · pedido: mvp_budget_orders
 * @returns {Promise<Uint8Array>}
 */
export async function renderizarPdf({ doc, orcamento, jornada, cliente, pedido, validade, creditoDias, emitidoEm = new Date() }) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [titulo, titulo5, texto, textoMedio, textoForte] = await Promise.all([
    'clash-display-600', 'clash-display-500', 'satoshi-400', 'satoshi-500', 'satoshi-700'
  ].map(async (f) => pdf.embedFont(await readFile(path.join(FONTES, f + '.ttf')), { subset: true })));
  const logo = await caminhosDoLogo();

  pdf.setTitle('Orçamento detalhado do MVP — ' + limparTexto(jornada.titulo));
  pdf.setAuthor('CMK COGIT');
  pdf.setSubject('Estimativa de escopo, valor e prazo do MVP. Não é contrato.');
  pdf.setCreator('app.cmkcogit.com.br');
  pdf.setCreationDate(emitidoEm);

  const paginas = [];
  let pg, y;
  const novaPagina = () => {
    pg = pdf.addPage(A4);
    paginas.push(pg);
    // cabeçalho: logo + nome do documento + fio
    const escala = 0.0225;           // viewBox 3556 x 1000 -> ~80 x 22,5 pt
    for (const d of logo) pg.drawSvgPath(d, { x: M, y: A4[1] - 36, scale: escala, color: COR.marinho });
    const rot = 'ORÇAMENTO DETALHADO DO MVP';
    pg.drawText(rot, { x: A4[0] - M - textoMedio.widthOfTextAtSize(rot, 7.5), y: A4[1] - 52, size: 7.5, font: textoMedio, color: COR.texto2 });
    pg.drawLine({ start: { x: M, y: A4[1] - 66 }, end: { x: A4[0] - M, y: A4[1] - 66 }, thickness: 1, color: COR.fio });
    y = A4[1] - 96;
  };
  const espaco = (h) => { if (y - h < 78) novaPagina(); };
  const linhas = (t, { fonte = texto, tam = 10.5, cor = COR.grafite, x = M, largura = LARG, entre = 4 } = {}) => {
    for (const l of quebrar(t, fonte, tam, largura)) {
      espaco(tam + entre);
      pg.drawText(l, { x, y: y - tam, size: tam, font: fonte, color: cor });
      y -= tam + entre;
    }
  };
  let numSecao = 0;
  const secao = (nome) => {
    espaco(70);
    y -= 14;
    numSecao++;
    const n = String(numSecao).padStart(2, '0');
    pg.drawText(n, { x: M, y: y - 16, size: 11, font: textoForte, color: COR.ceu });
    pg.drawText(limparTexto(nome), { x: M + 26, y: y - 18, size: 17, font: titulo, color: COR.marinho });
    y -= 30;
    pg.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1, color: COR.fio });
    y -= 12;
  };
  const sub = (t, cor = COR.marinho) => { espaco(30); y -= 4; linhas(t, { fonte: textoForte, tam: 11, cor }); y -= 2; };
  const marcador = (t, { x = M, largura = LARG, tam = 10.5 } = {}) => {
    const ls = quebrar(t, texto, tam, largura - 14);
    ls.forEach((l, i) => {
      espaco(tam + 4);
      if (i === 0) pg.drawRectangle({ x: x + 1, y: y - tam + 3, width: 4, height: 4, color: COR.marinho });
      pg.drawText(l, { x: x + 14, y: y - tam, size: tam, font: texto, color: COR.grafite });
      y -= tam + 4;
    });
  };
  const nota = (t) => linhas(t, { tam: 9, cor: COR.texto2, entre: 3 });
  const vazio = (lista, aviso) => { if (!lista.length) nota(aviso); return !lista.length; };

  // ---------------------------------------------------------------- capa (topo da página 1)
  novaPagina();
  const nomeCliente = limparTexto(cliente && cliente.nome) || 'Cliente';
  pg.drawText('Orçamento detalhado do MVP', { x: M, y: y - 10, size: 9, font: textoForte, color: COR.ceu });
  y -= 24;
  for (const l of quebrar(doc.titulo || jornada.titulo, titulo, 28, LARG)) {
    pg.drawText(l, { x: M, y: y - 28, size: 28, font: titulo, color: COR.marinho });
    y -= 34;
  }
  y -= 4;
  linhas('Preparado para ' + nomeCliente + ' em ' + data(emitidoEm) + ' · Pedido ' + String(pedido.id).slice(0, 8).toUpperCase(), { tam: 9.5, cor: COR.texto2 });
  y -= 16;

  // três números: faixa de valor, prazo do MVP, funcionalidades essenciais
  const mvp = orcamento.mvp || {};
  const caixas = [
    ['Investimento estimado do MVP', brl(orcamento.valor_min) + ' a ' + brl(orcamento.valor_max)],
    ['Prazo estimado do MVP', mvp.semanas ? mvp.semanas + (mvp.semanas === 1 ? ' semana' : ' semanas') : 'a definir'],
    ['Funcionalidades no MVP', String(mvp.quantidade || 0)]
  ];
  const lc = (LARG - 16) / 3;
  caixas.forEach(([rot, val], i) => {
    const x = M + i * (lc + 8);
    pg.drawRectangle({ x, y: y - 74, width: lc, height: 74, color: COR.caixa });
    pg.drawRectangle({ x, y: y - 74, width: 3, height: 74, color: COR.marinho });
    pg.drawText(rot, { x: x + 14, y: y - 22, size: 8, font: textoMedio, color: COR.texto2 });
    let tam = 15;
    while (tam > 9 && titulo5.widthOfTextAtSize(val, tam) > lc - 24) tam -= 0.5;
    pg.drawText(val, { x: x + 14, y: y - 52, size: tam, font: titulo5, color: COR.marinho });
  });
  y -= 92;

  // aviso: estimativa, não contrato, validade
  const aviso = 'Estimativa, não contrato. Este documento organiza o que foi respondido na Jornada MVP e estima escopo, valor e prazo. '
    + 'Não é proposta comercial nem contrato: valores e prazos são confirmados pela CMK COGIT depois da validação técnica. '
    + 'Válido até ' + data(validade) + '.';
  const la = quebrar(aviso, texto, 9, LARG - 28);
  const ha = la.length * 12.5 + 20;
  pg.drawRectangle({ x: M, y: y - ha, width: LARG, height: ha, borderColor: COR.marinho, borderWidth: 1 });
  la.forEach((l, i) => pg.drawText(l, { x: M + 14, y: y - 18 - i * 12.5, size: 9, font: i === 0 ? textoMedio : texto, color: COR.grafite }));
  y -= ha + 6;

  // ---------------------------------------------------------------- conteúdo
  secao('Resumo executivo');
  linhas(doc.resumo_executivo);

  secao('Problema e proposta de valor');
  sub('O problema');
  linhas(doc.problema || '—');
  sub('A proposta de valor');
  linhas(doc.proposta_valor || '—');
  if (doc.publico_alvo.length) {
    sub('Para quem');
    for (const p of doc.publico_alvo) marcador(p.segmento + ': ' + p.necessidade);
  }

  secao('Escopo do MVP');
  nota('As funcionalidades essenciais formam a primeira versão. As de segunda versão e as futuras ficam fora do valor do MVP.');
  y -= 4;
  for (const prioridade of ['essencial', 'desejavel', 'futuro']) {
    const grupo = doc.funcionalidades.filter((f) => f.prioridade === prioridade);
    if (!grupo.length) continue;
    sub(PRIORIDADE[prioridade] + ' (' + grupo.length + ')');
    for (const f of grupo) {
      espaco(46);
      y -= 2;
      linhas(f.nome, { fonte: textoMedio, tam: 11, cor: COR.grafite });
      linhas('Complexidade ' + (COMPLEXIDADE[f.complexidade] || f.complexidade), { tam: 8, cor: COR.texto2, entre: 4 });
      if (f.detalhamento) linhas(f.detalhamento, { tam: 10 });
      if (f.criterios_aceite.length) {
        linhas('Critérios de aceite', { fonte: textoForte, tam: 8.5, cor: COR.texto2 });
        for (const c of f.criterios_aceite) marcador(c, { x: M + 6, largura: LARG - 6, tam: 9.5 });
      }
      y -= 6;
    }
  }
  if (orcamento.evolucao && orcamento.evolucao.quantidade) {
    nota('Segunda versão estimada em ' + brl(orcamento.evolucao.valor) + ' (' + orcamento.evolucao.semanas + ' semanas), à parte do MVP.');
  }
  if (doc.fora_do_escopo.length) {
    sub('Fora do escopo');
    for (const f of doc.fora_do_escopo) marcador(f.item + ': ' + f.motivo);
  }

  secao('Quem usa e como');
  sub('Perfis de usuário');
  if (!vazio(doc.perfis_usuario, 'Perfis não detalhados nas respostas.')) for (const p of doc.perfis_usuario) marcador(p.perfil + ': ' + p.pode);
  sub('Fluxo principal');
  if (!vazio(doc.fluxo_principal, 'Fluxo não detalhado nas respostas.')) doc.fluxo_principal.forEach((p, i) => linhas((i + 1) + '. ' + p, { x: M + 2 }));

  if (doc.dados_e_integracoes.length || doc.requisitos_nao_funcionais.length) {
    secao('Dados, integrações e requisitos');
    for (const d of doc.dados_e_integracoes) marcador(d.item + ': ' + d.detalhe);
    if (doc.requisitos_nao_funcionais.length) {
      sub('Requisitos de qualidade');
      for (const r of doc.requisitos_nao_funcionais) marcador(r);
    }
  }

  secao('Premissas');
  nota('O que está sendo assumido para que o escopo e a estimativa valham. Se alguma não for verdade, o orçamento muda.');
  y -= 2;
  for (const p of doc.premissas) {
    marcador(p.premissa);
    linhas('Base: ' + p.base, { x: M + 14, largura: LARG - 14, tam: 8.5, cor: COR.texto2, entre: 3 });
    y -= 3;
  }

  secao('Pontos de atenção');
  for (const p of doc.pontos_de_atencao) {
    espaco(50);
    const tag = IMPACTO[p.impacto] || '';
    const cor = COR[p.impacto] || COR.texto2;
    const lt = textoForte.widthOfTextAtSize(tag.toUpperCase(), 7) + 12;
    pg.drawRectangle({ x: M, y: y - 13, width: lt, height: 13, borderColor: cor, borderWidth: 1 });
    pg.drawText(tag.toUpperCase(), { x: M + 6, y: y - 9.5, size: 7, font: textoForte, color: cor });
    y -= 19;
    linhas(p.titulo, { fonte: textoMedio, tam: 11 });
    linhas(p.detalhe, { tam: 10 });
    linhas('Como reduzir: ' + p.como_reduzir, { tam: 9.5, cor: COR.texto2 });
    y -= 8;
  }

  secao('Perguntas em aberto');
  doc.perguntas_em_aberto.forEach((p, i) => {
    linhas((i + 1) + '. ' + p.pergunta, { fonte: textoMedio, tam: 10.5 });
    linhas(p.por_que_importa, { x: M + 14, largura: LARG - 14, tam: 9.5, cor: COR.texto2 });
    y -= 4;
  });

  if (doc.proximos_passos.length) {
    secao('Próximos passos');
    for (const p of doc.proximos_passos) marcador(p);
  }

  secao('Condições desta estimativa');
  const cond = [
    'Estimativa, não contrato: este documento não obriga nenhuma das partes. A proposta comercial, com valor e prazo fechados, só existe depois da validação técnica feita pela equipe da CMK COGIT.',
    'Os valores consideram apenas as funcionalidades essenciais listadas. Funcionalidades de segunda versão, futuras ou fora do escopo não estão incluídas.',
    'A faixa de valor e o prazo foram calculados a partir das respostas fornecidas na Jornada MVP. Respostas incompletas ou alteradas mudam a estimativa.',
    'Validade: ' + data(validade) + '. Depois disso, peça uma atualização.',
    creditoDias > 0
      ? 'Crédito: se você contratar a CMK COGIT para construir este projeto até ' + data(new Date(new Date(pedido.paid_at || emitidoEm).getTime() + creditoDias * 86400000)) + ', o valor pago por este documento (' + brl(pedido.price_brl) + ') vira crédito no projeto.'
      : null
  ].filter(Boolean);
  for (const c of cond) marcador(c, { tam: 9.5 });

  // rodapé em todas as páginas
  const rod = 'Estimativa, não contrato · Válido até ' + data(validade) + ' · cmkcogit.com.br';
  paginas.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 50 }, end: { x: A4[0] - M, y: 50 }, thickness: 1, color: COR.fio });
    p.drawText(rod, { x: M, y: 36, size: 7.5, font: texto, color: COR.texto2 });
    const n = (i + 1) + ' / ' + paginas.length;
    p.drawText(n, { x: A4[0] - M - texto.widthOfTextAtSize(n, 7.5), y: 36, size: 7.5, font: texto, color: COR.texto2 });
  });

  return pdf.save();
}
