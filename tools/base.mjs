// Gera lib/base-conhecimento.gerada.js com o conteúdo de knowledge/*.md, para a função da Vercel
// levar a base junto (sem depender de configuração de arquivos extras no deploy).
// Uso: node tools/base.mjs          (atualiza)   ·   node tools/base.mjs --check  (usado pelo npm test)
// Mudou algum .md em knowledge/? Rode "npm run base" antes do commit.
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pasta = path.join(raiz, 'knowledge');
const destino = path.join(raiz, 'lib', 'base-conhecimento.gerada.js');
const arquivos = fs.readdirSync(pasta).filter((n) => n.endsWith('.md')).sort()
  .map((nome) => ({ nome, texto: fs.readFileSync(path.join(pasta, nome), 'utf8') }));
const conteudo = '// GERADO por tools/base.mjs a partir de knowledge/*.md. Não edite aqui: edite os .md e rode "npm run base".\n'
  + 'export const ARQUIVOS = ' + JSON.stringify(arquivos, null, 2) + ';\n';
const atual = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8') : '';
if (process.argv.includes('--check')) {
  if (atual !== conteudo) { console.error('A base de conhecimento mudou: rode "npm run base".'); process.exit(1); }
  console.log('Base de conhecimento em dia (' + arquivos.length + ' arquivos).');
} else {
  fs.writeFileSync(destino, conteudo);
  console.log('lib/base-conhecimento.gerada.js atualizado (' + arquivos.length + ' arquivos).');
}
