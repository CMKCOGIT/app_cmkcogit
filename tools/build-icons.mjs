// Gera public/assets/icons/bi.svg (sprite) só com os ícones de assets/icons/icones.json.
// Uso: node tools/build-icons.mjs <pasta "icons" do pacote bootstrap-icons@1.11.3>
//   ex.: npm pack bootstrap-icons@1.11.3 && tar xzf bootstrap-icons-1.11.3.tgz
//        node tools/build-icons.mjs package/icons
// No HTML: <svg class="i" aria-hidden="true"><use href="/assets/icons/bi.svg#whatsapp"></use></svg>
// (o id do símbolo é o NOME DO CONCEITO, não o do ícone: troque o desenho no JSON sem mexer nas páginas)
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pasta = process.argv[2];
if (!pasta || !fs.existsSync(pasta)) { console.error('Informe a pasta icons/ do pacote bootstrap-icons.'); process.exit(1); }
const { icones } = JSON.parse(fs.readFileSync(path.join(raiz, 'public/assets/icons/icones.json'), 'utf8'));

const simbolos = Object.entries(icones).map(([conceito, nome]) => {
  const svg = fs.readFileSync(path.join(pasta, nome + '.svg'), 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(svg)[1];
  const corpo = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s*\n\s*/g, '').trim();
  return `<symbol id="${conceito}" viewBox="${viewBox}">${corpo}</symbol>`;
});
const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none"><!-- Bootstrap Icons 1.11.3, MIT (https://github.com/twbs/icons). Gerado por tools/build-icons.mjs --><defs>${simbolos.join('')}</defs></svg>\n`;
fs.writeFileSync(path.join(raiz, 'public/assets/icons/bi.svg'), sprite);
console.log('public/assets/icons/bi.svg:', simbolos.length, 'ícones,', (sprite.length / 1024).toFixed(1), 'KB');
