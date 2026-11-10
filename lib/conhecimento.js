// Base de conhecimento do Assistente IA (pasta knowledge/, arquivos .md) — lado do SERVIDOR.
// v1: busca por palavras-chave. A interface é uma só, selecionarContexto(), para trocar depois
// por busca semântica (pgvector no Supabase) sem mexer na rota.
//
// Formato de cada arquivo:
//   ---                        cabeçalho
//   titulo: Produtos e serviços
//   palavras: preço, valor, site, landing   (termos que fazem o arquivo ser escolhido)
//   sempre: true               (só no 00-identidade-e-regras.md: entra em todo pedido)
//   ---
//   ## Seção                   cada seção é escolhida sozinha (economiza tokens)
//   <!-- comentários não vão para a IA; seção só com comentário é ignorada -->
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimarTokens } from '../config/assistente.config.js';

const PASTA_PADRAO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'knowledge');
const PARADAS = new Set(('a o e de da do das dos em no na nos nas um uma uns umas para por com sem que qual quais como mais menos muito muita ' +
  'ser sao são esta está isso isto esse essa aquele aquela meu minha seu sua nosso nossa voce você eles elas ele ela me te se ou ao aos ' +
  'sobre quando onde porque pois entao então tambem também ja já nao não sim tem ter fazer faz pode poderia gostaria quero queria preciso ' +
  'texto mensagem escreva escrever envie enviar manda mandar cliente clientes').split(/\s+/));

export const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const termos = (t) => [...new Set(normalizar(t).split(/[^a-z0-9]+/).filter((p) => p.length > 3 && !PARADAS.has(p)))];

export function lerArquivo(nome, texto) {
  let corpo = String(texto || '').replace(/\r\n/g, '\n');
  const meta = { titulo: nome.replace(/\.md$/, ''), palavras: [], sempre: false };
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(corpo);
  if (m) {
    corpo = corpo.slice(m[0].length);
    for (const linha of m[1].split('\n')) {
      const [chave, ...resto] = linha.split(':');
      const valor = resto.join(':').trim();
      if (chave.trim() === 'titulo') meta.titulo = valor;
      if (chave.trim() === 'palavras') meta.palavras = valor.split(',').map((p) => normalizar(p.trim())).filter(Boolean);
      if (chave.trim() === 'sempre') meta.sempre = valor === 'true';
    }
  }
  corpo = corpo.replace(/<!--[\s\S]*?-->/g, '');
  const secoes = [];
  const partes = corpo.split(/^## +/m);
  const intro = partes.shift().trim();
  if (intro) secoes.push({ titulo: meta.titulo, texto: intro });
  for (const p of partes) {
    const quebra = p.indexOf('\n');
    const titulo = (quebra < 0 ? p : p.slice(0, quebra)).trim();
    const texto = (quebra < 0 ? '' : p.slice(quebra + 1)).trim();
    if (texto) secoes.push({ titulo, texto }); // seção vazia (só o comentário-guia): fica de fora
  }
  return { nome, ...meta, secoes: secoes.map((s) => ({ ...s, tokens: estimarTokens(s.titulo + s.texto) + 6, normal: normalizar(s.titulo + ' ' + s.texto) })) };
}

let cache = null;
export function carregarBase(pasta = PASTA_PADRAO) {
  if (cache && cache.pasta === pasta) return cache.arquivos;
  let nomes = [];
  try { nomes = fs.readdirSync(pasta).filter((n) => n.endsWith('.md')).sort(); } catch (_) { nomes = []; }
  const arquivos = nomes.map((n) => lerArquivo(n, fs.readFileSync(path.join(pasta, n), 'utf8')));
  cache = { pasta, arquivos };
  return arquivos;
}
export function limparCache() { cache = null; }

/**
 * Escolhe os trechos da base para uma pergunta, dentro do orçamento de tokens.
 * @param {string} pergunta  a mensagem atual (e, se quiser, a anterior, para perguntas de continuação)
 * @param {{ orcamento: number, arquivos?: object[] }} o
 * @returns {{ texto: string, tokens: number, usados: {arquivo, rotulo, nucleo}[], semBase: boolean }}
 */
export function selecionarContexto(pergunta, { orcamento, arquivos = carregarBase() } = {}) {
  const q = normalizar(pergunta);
  const palavrasQ = termos(pergunta);
  const blocos = [];
  let tokens = 0;
  const usados = [];
  const adicionar = (a, s, limite) => {
    let texto = s.texto;
    let t = s.tokens;
    if (t > limite) { // corta o trecho para caber (nunca passa do orçamento)
      texto = texto.slice(0, Math.max(0, Math.floor((limite - 10) * 3.6))).replace(/\s+\S*$/, '') + ' […]';
      t = estimarTokens(texto) + 6;
    }
    if (t <= 6) return false;
    blocos.push(`### ${a.titulo} › ${s.titulo}\n${texto}`);
    tokens += t;
    usados.push({ arquivo: a.nome, rotulo: a.titulo + ' › ' + s.titulo, nucleo: Boolean(a.sempre) });
    return true;
  };

  // 1. o núcleo (identidade e regras) entra sempre
  for (const a of arquivos.filter((x) => x.sempre)) for (const s of a.secoes) adicionar(a, s, Math.max(0, orcamento - tokens));

  // 2. pontua cada seção dos outros arquivos
  const candidatos = [];
  for (const a of arquivos.filter((x) => !x.sempre)) {
    const doArquivo = a.palavras.filter((p) => p.length > 2 && (q.includes(p))).length;
    for (const s of a.secoes) {
      const doTitulo = termos(s.titulo).filter((p) => palavrasQ.includes(p)).length;
      const doTexto = Math.min(4, palavrasQ.filter((p) => s.normal.includes(p)).length);
      const nota = doArquivo * 3 + doTitulo * 4 + doTexto;
      if (nota >= 3) candidatos.push({ a, s, nota });
    }
  }
  candidatos.sort((x, y) => y.nota - x.nota || x.s.tokens - y.s.tokens);
  let daBase = 0;
  for (const c of candidatos) {
    const resta = orcamento - tokens;
    if (resta < 40) break;
    if (adicionar(c.a, c.s, resta)) daBase += 1;
  }
  return { texto: blocos.join('\n\n'), tokens, usados, semBase: daBase === 0 };
}
