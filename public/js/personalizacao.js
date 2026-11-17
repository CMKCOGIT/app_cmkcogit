// =====================================================================
// personalizacao.js — site personalizado no editor do modelo pronto
// (usado em admin-solicitacao.html e continuar.html)
//
// Arquivo: Storage "arquivos", solicitacoes/<id>/[vN/]personalizacao.json
//   { modelo, variante, cores, textos, links, secoesOcultas, imagens: { n: { src, x, y, zoom, alt } }, rotulos }
//
// Editor do modelo (site, cmkcogit.com.br/templates/<modelo>/), aberto em nova aba:
//   ?personalizar&origem=plataforma -> o cliente edita e devolve ("Salvar e reenviar")
//   ?equipe&origem=preview          -> a equipe só visualiza o projeto
// Conversa por postMessage, sempre conferindo a origem do site:
//   editor -> app  { type: 'cmk:editor:pronto' }
//   app -> editor  { type: 'cmk:editor:dados', dados }
//   editor -> app  { type: 'cmk:editor:salvo', dados }      (só no modo plataforma)
//   app -> editor  { type: 'cmk:editor:recebido' }
// =====================================================================
const PERS_PASTA = (solicitacaoId, versao) => 'solicitacoes/' + solicitacaoId + '/' + (versao > 1 ? 'v' + versao + '/' : '') + 'personalizacao.json';

async function baixarPersonalizacao(solicitacaoId, versao) {
  const { data, error } = await db.storage.from('arquivos').download(PERS_PASTA(solicitacaoId, versao));
  if (error || !data) return null;
  try { return JSON.parse(await data.text()); } catch (_) { return null; }
}

// pasta do modelo no site a partir do id gravado pelo editor (landing-basica, landing-profissional, landing-formal)
function pastaDoModelo(dados) {
  const m = String((dados && dados.modelo) || '');
  return /^[a-z0-9-]{3,40}$/.test(m) ? m : null;
}
const PASTA_POR_VARIANTE = { 'landing-page-basica': 'landing-basica', 'landing-page-profissional': 'landing-profissional', 'landing-page-formal': 'landing-formal' };

// Abre o editor do modelo e entrega os dados. aoSalvar(dados) só no modo 'editar'.
function abrirNoEditor({ pasta, dados, modo, aoSalvar, aoErro }) {
  if (!pasta) { if (aoErro) aoErro('Modelo desconhecido.'); return false; }
  const consulta = modo === 'editar' ? '?personalizar&origem=plataforma' : '?equipe&origem=preview';
  const aba = window.open(urlSite('templates/' + pasta + '/') + consulta, '_blank');
  if (!aba) { if (aoErro) aoErro('O navegador bloqueou a nova aba. Permita pop-ups para a plataforma e tente de novo.'); return false; }
  const origens = origensDoSite();
  function aoReceber(e) {
    if (e.source !== aba || !origens.has(e.origin) || !e.data) return;
    if (e.data.type === 'cmk:editor:pronto') {
      aba.postMessage({ type: 'cmk:editor:dados', dados: dados || null }, e.origin);
      if (modo !== 'editar') window.removeEventListener('message', aoReceber);
    } else if (e.data.type === 'cmk:editor:salvo' && modo === 'editar' && e.data.dados && typeof e.data.dados === 'object') {
      window.removeEventListener('message', aoReceber);
      aba.postMessage({ type: 'cmk:editor:recebido' }, e.origin);
      aoSalvar(e.data.dados);
    }
  }
  window.addEventListener('message', aoReceber);
  return true;
}

// Mostra a personalização: cores, textos, imagens, seções ocultas e links.
function personalizacaoHtml(d, { completo = true } = {}) {
  if (!d) return '<p data-vazio>Não foi possível abrir o arquivo da personalização.</p>';
  const r = d.rotulos || {};
  const rot = (grupo, k) => (r[grupo] && r[grupo][k]) || k;
  const NOMES_COR = { primary: 'Principal', secondary: 'Secundária', accent: 'Destaque', bg: 'Fundo', heading: 'Títulos', text: 'Textos' };
  const cores = Object.entries(d.cores || {}).filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v));
  const imagens = Object.entries(d.imagens || {}).filter(([, i]) => i && /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/.test(i.src || ''));
  const textos = Object.entries(d.textos || {});
  const links = Object.entries(d.links || {});
  const ocultas = (d.secoesOcultas || []).map((s) => rot('secoes', s));
  return `
    <section class="pers-bloco" aria-label="Cores">
      <h3>Paleta de cores</h3>
      <ul class="pers-cores">${cores.map(([k, v]) => `<li><span style="background:${esc(v)}" aria-hidden="true"></span><strong>${esc(NOMES_COR[k] || k)}</strong><code>${esc(v)}</code></li>`).join('')}</ul>
    </section>
    <section class="pers-bloco" aria-label="Imagens">
      <h3>Imagens enviadas <small>(${imagens.length})</small></h3>
      ${imagens.length ? `<ul class="pers-imagens">${imagens.map(([n, i]) => `<li><a href="${i.src}" download="imagem-${esc(n)}.${(i.src.match(/^data:image\/([a-z+]+)/) || [])[1] === 'png' ? 'png' : 'webp'}"><img src="${i.src}" alt="${esc(i.alt || '')}" loading="lazy"></a><span>${esc(rot('imagens', n === 'logo' ? 'logo' : n))}</span></li>`).join('')}</ul>` : '<p data-vazio>Nenhuma imagem enviada: o site usa os espaços reservados do modelo.</p>'}
    </section>
    ${ocultas.length ? `<section class="pers-bloco"><h3>Seções ocultas</h3><p>${ocultas.map(esc).join(', ')}</p></section>` : ''}
    ${completo ? `
    <details class="pers-bloco">
      <summary><h3>Textos <small>(${textos.length})</small></h3></summary>
      <dl class="pers-textos">${textos.map(([k, v]) => `<div><dt>${esc(rot('textos', k))}</dt><dd>${esc(v) || '<em>vazio</em>'}</dd></div>`).join('')}</dl>
    </details>
    <details class="pers-bloco">
      <summary><h3>Links e contatos <small>(${links.length})</small></h3></summary>
      <dl class="pers-textos">${links.map(([k, v]) => `<div><dt>${esc(rot('links', k))}</dt><dd>${v ? esc(v) : '<em>oculto</em>'}</dd></div>`).join('')}</dl>
    </details>` : `<p><small>${textos.length} textos e ${links.length} links personalizados.</small></p>`}`;
}
