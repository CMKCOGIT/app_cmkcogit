// Plataforma em inglês: dicionário (tools/i18n-en.json) -> public/js/i18n-en.js
//
// tools/i18n-en.json
//   texts:    texto em português -> inglês (trecho exato, sem tags; espaços normalizados)
//   patterns: [regex, substituição, traduzir trechos capturados?] para textos com valores
//
// Uso: node tools/i18n.mjs            -> gera public/js/i18n-en.js
//      node tools/i18n.mjs --check    -> falha se o .js estiver desatualizado ou houver texto sem tradução ("")
//      node tools/i18n.mjs --extract  -> acrescenta ao json os textos em português ainda fora dele (com "")
// A tradução acontece no navegador (public/js/i18n.js). Não edite public/js/i18n-en.js.
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const ARQ = path.join(raiz, 'tools/i18n-en.json');
const SAIDA = path.join(raiz, 'public/js/i18n-en.js');
const modo = process.argv.includes('--check') ? 'check' : process.argv.includes('--extract') ? 'extract' : 'build';
const dic = fs.existsSync(ARQ) ? JSON.parse(fs.readFileSync(ARQ, 'utf8')) : { texts: {}, patterns: [] };

const norm = (s) => s.replace(/[\s ]+/g, ' ').trim();
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ENT[e]);
// parece texto em português para pessoas (não código, classe, id ou URL)
const LIXO = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'Enter', 'Tab', 'Home', 'End', 'NFD', 'PageUp', 'PageDown', 'Backspace', 'Delete']);
const PT = /[ãõçéêáíóúâàÁÉÍÓÚÂÊÔÇ]|(^|\s)(de|do|da|dos|das|e|o|a|os|as|para|com|seu|sua|seus|suas|no|na|em|um|uma|não|ou|por|ao|se|que|é)(\s|$)/i;
function humano(s, html) {
  if (!/\p{L}{2,}/u.test(s) || s.length > 900 || LIXO.has(s)) return false;
  if (/[{};]|=>|\(\)|\$\{|^\.|^#|https?:|\.(js|html|css|svg|png|json)\b|querySelector|^[a-z0-9_-]+$|^[a-z_]+\.[a-z_.]+$/.test(s)) return false;
  if (/^[a-z][a-z0-9_]*( [a-z][a-z0-9_-]*)*$/.test(s) && !PT.test(s)) return false;
  if (html) return !/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(s); // texto do HTML é para pessoas (menos e-mails)
  // no JS: português ou frase/rótulo com inicial maiúscula ("Criar conta", "Meu perfil")
  return PT.test(' ' + s + ' ') || /^[A-ZÀ-Ú][\p{L}]*( [\p{L}()]+){0,6}[.!?:…]?$/u.test(s);
}

function extrair() {
  const achados = new Set();
  const add = (s, html) => { s = norm(decode(s)); if (humano(s, html)) achados.add(s); };
  const pub = path.join(raiz, 'public');
  for (const f of fs.readdirSync(pub).filter((n) => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(pub, f), 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, ' ');
    for (const m of html.matchAll(/>([^<>]+)</g)) add(m[1], true);
    for (const m of html.matchAll(/\s(?:alt|aria-label|title|placeholder|value)="([^"]+)"/g)) add(m[1], true);
    for (const m of html.matchAll(/<meta\s+(?:name|property)="(?:description|og:title|og:description)"\s+content="([^"]+)"/g)) add(m[1], true);
  }
  const js = [...fs.readdirSync(path.join(pub, 'js')).filter((n) => n.endsWith('.js') && !/^i18n/.test(n)).map((n) => 'public/js/' + n),
    ...fs.readdirSync(path.join(raiz, 'api')).filter((n) => n.endsWith('.js') && n !== 'mensagens-ia.js').map((n) => 'api/' + n),
    ...fs.readdirSync(path.join(raiz, 'lib')).filter((n) => n.endsWith('.js') && !/gerada|^ia\.js|^assistente\.js|^conhecimento\.js|^email\.js/.test(n)).map((n) => 'lib/' + n)];
  // fora: instruções para a IA (lib/ia, assistente, conhecimento) e e-mails, que não aparecem na tela
  for (const f of js) {
    const src = fs.readFileSync(path.join(raiz, f), 'utf8');
    for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      const s = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1');
      // dentro de HTML montado: cada trecho entre tags e entre ${...} vira um texto
      for (const p of s.split(/<[^>]*>|\$\{(?:[^{}]|\{[^{}]*\})*\}/)) add(p);
    }
  }
  return achados;
}

const patterns = (dic.patterns || []).map(([re, to]) => new RegExp('^' + re + '$', 'u'));
const coberto = (k) => Object.hasOwn(dic.texts, k) || patterns.some((re) => re.test(k));

if (modo === 'extract') {
  let novos = 0;
  for (const k of [...extrair()].sort()) if (!coberto(k)) { dic.texts[k] = ''; novos++; }
  fs.writeFileSync(ARQ, JSON.stringify(dic, null, 2) + '\n');
  console.log(novos + ' textos novos sem tradução em tools/i18n-en.json');
  process.exit(0);
}
const vazios = Object.entries(dic.texts).filter(([, v]) => !v).map(([k]) => k);
const saida = '/* Gerado por tools/i18n.mjs a partir de tools/i18n-en.json. Não edite. */\nwindow.COGIT_I18N = ' +
  JSON.stringify({ texts: Object.fromEntries(Object.entries(dic.texts).filter(([, v]) => v)), patterns: dic.patterns || [] }) + ';\n';
const atual = fs.existsSync(SAIDA) ? fs.readFileSync(SAIDA, 'utf8') : '';
if (modo === 'check') {
  let ruim = false;
  if (vazios.length) { console.error(vazios.length + ' textos sem tradução em tools/i18n-en.json, ex.: ' + vazios.slice(0, 5).join(' | ')); ruim = true; }
  if (atual !== saida) { console.error('public/js/i18n-en.js desatualizado: rode node tools/i18n.mjs'); ruim = true; }
  if (ruim) process.exit(1);
  console.log('i18n em dia (' + Object.keys(dic.texts).length + ' textos)');
} else {
  fs.writeFileSync(SAIDA, saida);
  console.log('public/js/i18n-en.js gerado (' + (Object.keys(dic.texts).length - vazios.length) + ' textos' + (vazios.length ? ', ' + vazios.length + ' sem tradução' : '') + ')');
}
