// Carimba nos HTMLs a versão de cada CSS/JS (?v=<hash do conteúdo>), para que esses
// arquivos possam ficar em cache por 1 ano (vercel.json) sem risco de o navegador
// usar um CSS/JS antigo depois de um deploy: mudou o arquivo, muda o endereço.
// Uso: node tools/versionar.mjs          (atualiza os HTMLs)
//      node tools/versionar.mjs --check  (só confere; usado pelo npm test)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public');
const conferir = process.argv.includes('--check');
const REF = /((?:href|src)=")(\/?)((?:css|js)\/[\w.-]+\.(?:css|js))(?:\?v=[\w]+)?(")/g;
const hashes = new Map();
const hashDe = (rel) => {
  if (!hashes.has(rel)) hashes.set(rel, crypto.createHash('sha256').update(fs.readFileSync(path.join(raiz, rel))).digest('hex').slice(0, 10));
  return hashes.get(rel);
};

const desatualizados = [];
for (const nome of fs.readdirSync(raiz).filter((f) => f.endsWith('.html'))) {
  const arq = path.join(raiz, nome);
  const antes = fs.readFileSync(arq, 'utf8');
  const depois = antes.replace(REF, (_, a, barra, rel, b) => `${a}${barra}${rel}?v=${hashDe(rel)}${b}`);
  if (depois !== antes) {
    desatualizados.push(nome);
    if (!conferir) fs.writeFileSync(arq, depois);
  }
}
if (conferir && desatualizados.length) {
  console.error('Versões de CSS/JS desatualizadas em: ' + desatualizados.join(', ') + '\nRode: node tools/versionar.mjs');
  process.exit(1);
}
console.log(conferir ? 'Versões de CSS/JS em dia.' : `HTMLs atualizados: ${desatualizados.length}`);
