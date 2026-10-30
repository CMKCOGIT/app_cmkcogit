// styleguide.js — monta as seções de tokens e ícones do styleguide LENDO os
// valores do CSS carregado (tokens.css), para a documentação nunca divergir.
// Mesmo arquivo no site (docs/styleguide.js) e na plataforma (public/js/styleguide.js).
(function () {
  'use strict';
  const raiz = getComputedStyle(document.documentElement);
  const v = (nome) => raiz.getPropertyValue(nome).trim();
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const base = document.body.dataset.base || '/';

  // contraste WCAG (só para cores sólidas #RRGGBB)
  const lum = (hex) => hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((t, c, i) => t + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const hex = (cor) => (/^#[0-9a-f]{6}$/i.test(cor) ? cor.toUpperCase() : null);

  function cores() {
    const grupos = {
      Marca: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((n) => '--color-brand-' + n),
      Navy: [950, 900, 800, 700, 600].map((n) => '--color-navy-' + n),
      Neutros: [0, 50, 100, 200, 300, 400, 500, 600, 700].map((n) => '--color-neutral-' + n),
      Estados: ['--color-success', '--color-success-bg', '--color-warning', '--color-warning-bg', '--color-danger', '--color-danger-bg']
    };
    const alvo = document.getElementById('sg-cores');
    alvo.innerHTML = Object.entries(grupos).map(([g, nomes]) => `
      <h3>${g}</h3>
      <div class="sg-amostras">${nomes.map((n) => {
        const cor = hex(v(n));
        const cB = cor ? contraste(cor, '#FFFFFF') : 0;
        const cN = cor ? contraste(cor, '#0F1B33') : 0;
        const nota = cor ? `${cB.toFixed(1)}:1 branco ${cB >= 4.5 ? 'AA' : cB >= 3 ? 'AA grande' : '—'} · ${cN.toFixed(1)}:1 navy` : '';
        return `<figure class="sg-amostra"><span style="background:var(${n})"></span><figcaption><code>${esc(n)}</code><br>${esc(v(n))}<br><small>${nota}</small></figcaption></figure>`;
      }).join('')}</div>`).join('');
  }

  function tipografia() {
    const escala = ['--fs-display', '--fs-h1', '--fs-h2', '--fs-h3', '--fs-h4', '--fs-h5', '--fs-h6', '--fs-body', '--fs-small', '--fs-caption'];
    document.getElementById('sg-tipo').innerHTML = escala.map((n) => `
      <div class="sg-tipo-linha"><code>${n}</code><span style="font-size:var(${n});font-family:${n === '--fs-body' || n === '--fs-small' || n === '--fs-caption' ? 'var(--font-body)' : 'var(--font-heading)'};font-weight:${/display|h1|h2/.test(n) ? 800 : /h3|h4/.test(n) ? 700 : 500};line-height:1.2">CMKCOGIT estrutura a tecnologia</span><small>${esc(v(n))}</small></div>`).join('')
      + '<p class="sg-overline">Overline em caixa alta · --fs-overline + --tracking-overline</p>';
  }

  function escalas() {
    const espaco = ['--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-8', '--sp-10', '--sp-12', '--sp-16', '--sp-20', '--sp-24'];
    document.getElementById('sg-espaco').innerHTML = espaco.map((n) => `<div class="sg-barra"><code>${n}</code><span style="width:var(${n})"></span><small>${esc(v(n))}</small></div>`).join('');
    const raios = ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-pill'];
    document.getElementById('sg-raios').innerHTML = raios.map((n) => `<figure class="sg-caixa" style="border-radius:var(${n})"><figcaption><code>${n}</code><br>${esc(v(n))}</figcaption></figure>`).join('');
    const sombras = ['--shadow-1', '--shadow-2', '--shadow-3', '--shadow-4', '--shadow-brand'];
    document.getElementById('sg-sombras').innerHTML = sombras.map((n) => `<figure class="sg-caixa" style="box-shadow:var(${n})"><figcaption><code>${n}</code></figcaption></figure>`).join('');
    const mov = ['--dur-fast', '--dur-base', '--dur-slow', '--ease-out', '--ease-in-out', '--ease-spring'];
    document.getElementById('sg-movimento').innerHTML = mov.map((n) => `<li><code>${n}</code> ${esc(v(n))}</li>`).join('');
  }

  async function icones() {
    const alvo = document.getElementById('sg-icones');
    try {
      const { icones: mapa } = await (await fetch(base + 'assets/icons/icones.json')).json();
      alvo.innerHTML = Object.entries(mapa).map(([conceito, nome]) => `
        <figure class="sg-icone"><svg class="i" aria-hidden="true"><use href="${base}assets/icons/bi.svg#${conceito}"></use></svg>
          <figcaption><strong>${esc(conceito)}</strong><br><code>bi-${esc(nome)}</code></figcaption></figure>`).join('');
    } catch (_) {
      alvo.textContent = 'Abra pelo servidor local para carregar assets/icons/icones.json.';
    }
  }

  cores(); tipografia(); escalas(); icones();
})();
