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

// =====================================================================
// Pendências da personalização (o que falta o cliente informar para o site sair pronto)
// Mesma regra do editor (tools/templates/base/landing-editor.js, função pendencias).
// nivel 'bloqueia': falta informação; 'aviso': conferir, mas não impede gerar o arquivo.
// Envios antigos (sem "padroes") usam a marca de demonstração conhecida de cada modelo.
// =====================================================================
const MARCA_DEMO = { 'landing-basica': 'Ponto Firme Reformas', 'landing-profissional': 'Florescer Nutrição', 'landing-formal': 'Monteiro' };
const LINK_DEMO = /wa\.me\/5511900000000|tel:\+551130000000|^https?:\/\/(www\.)?(facebook|instagram|youtube|linkedin)\.com\/?$/i;

function pendenciasDaPersonalizacao(d) {
  if (!d) return [];
  const out = [];
  const textos = d.textos || {}, links = d.links || {}, imagens = d.imagens || {}, r = d.rotulos || {};
  const pad = d.padroes || null;
  const ocultas = d.secoesOcultas || [];
  const vis = (grupo, k) => { const s = d.secaoDe && d.secaoDe[grupo] && d.secaoDe[grupo][k]; return !s || !ocultas.includes(s); };
  const rot = (g, k) => (r[g] && r[g][k]) || k;
  const igual = (a, b) => String(a || '').trim() === String(b || '').trim();

  const nome = String(textos['brand.name'] || '').trim();
  const nomeDemo = pad ? pad.textos['brand.name'] : MARCA_DEMO[pastaDoModelo(d)];
  if (!nome || igual(nome, nomeDemo)) out.push({ tipo: 'nome', nivel: 'bloqueia', titulo: 'Nome da empresa', itens: [] });

  if (pad) {
    const demo = Object.keys(textos).filter((k) => k !== 'brand.name' && vis('textos', k) && String(textos[k] || '').trim() && igual(textos[k], pad.textos[k]));
    const longos = demo.filter((k) => String(textos[k]).trim().length >= 40);
    const curtos = demo.filter((k) => String(textos[k]).trim().length < 40);
    if (longos.length) out.push({ tipo: 'textos', nivel: 'bloqueia', titulo: 'Textos ainda iguais ao modelo de demonstração', itens: longos.map((k) => rot('textos', k)) });
    if (curtos.length) out.push({ tipo: 'rotulos', nivel: 'aviso', titulo: 'Títulos e rótulos curtos mantidos do modelo (confira)', itens: curtos.map((k) => rot('textos', k)) });
    const vazios = Object.keys(textos).filter((k) => k !== 'brand.name' && vis('textos', k) && !String(textos[k] || '').trim() && String(pad.textos[k] || '').trim());
    if (vazios.length) out.push({ tipo: 'vazios', nivel: 'bloqueia', titulo: 'Textos em branco', itens: vazios.map((k) => rot('textos', k)) });
  } else {
    out.push({ tipo: 'antigo', nivel: 'aviso', titulo: 'Envio anterior à conferência automática: os textos de demonstração são conferidos quando o arquivo é gerado', itens: [] });
  }

  const slots = Object.keys(r.imagens || {}).filter((n) => n !== 'logo');
  const semImagem = slots.filter((n) => vis('imagens', n) && !(imagens[n] && imagens[n].src));
  if (semImagem.length) out.push({ tipo: 'imagens', nivel: 'bloqueia', titulo: 'Imagens não enviadas', itens: semImagem.map((n) => rot('imagens', n)) });

  const linksDemo = Object.keys(links).filter((k) => {
    const v = String(links[k] || '').trim();
    if (!v || !vis('links', k) || !/^(https?:|mailto:|tel:)/i.test(v)) return false;
    return pad ? igual(v, pad.links[k]) : LINK_DEMO.test(v);
  });
  if (linksDemo.length) out.push({ tipo: 'links', nivel: 'bloqueia', titulo: 'Contatos e redes ainda com os dados de demonstração', itens: linksDemo.map((k) => rot('links', k)) });
  if (!(imagens.logo && imagens.logo.src)) out.push({ tipo: 'logo', nivel: 'aviso', titulo: 'Sem logotipo: o site usa a inicial do nome no lugar', itens: [] });
  return out;
}
const temBloqueio = (pend) => (pend || []).some((p) => p.nivel !== 'aviso');

function pendenciasHtml(pend) {
  if (!pend.length) return '<p class="arq-ok">Tudo preenchido: nenhuma pendência de personalização.</p>';
  return `<ul class="arq-pendencias">${pend.map((p) => `
    <li data-nivel="${p.nivel === 'aviso' ? 'aviso' : 'bloqueia'}">
      <strong>${esc(p.titulo)}</strong>${p.itens.length ? ` <small>(${p.itens.length})</small>
      <details><summary>Ver ${p.itens.length === 1 ? 'item' : 'itens'}</summary><ul>${p.itens.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></details>` : ''}
    </li>`).join('')}</ul>`;
}

// Mensagem pronta para cobrar o cliente (só o que bloqueia)
function mensagemPendencias(pend) {
  const linhas = pend.filter((p) => p.nivel !== 'aviso').map((p) => '• ' + p.titulo + (p.itens.length ? ': ' + p.itens.slice(0, 12).join(', ') + (p.itens.length > 12 ? ' e mais ' + (p.itens.length - 12) : '') : ''));
  return 'Para deixarmos o seu site pronto, faltam estas informações na personalização:\n' + linhas.join('\n') +
    '\nAbra a solicitação, clique em "Editar e reenviar", complete no editor e conclua. Se preferir, responda por aqui com os dados.';
}

// =====================================================================
// Arquivo final do site (.zip): o editor do modelo aplica a personalização e monta o pacote
// (index.html personalizado + CSS, JS, fontes e páginas do modelo) — modo ?equipe&origem=gerar.
//   app -> editor  { type: 'cmk:editor:dados', dados }
//   editor -> app  { type: 'cmk:editor:arquivo', zip: ArrayBuffer, nome, arquivos, pendencias, marca }
//                  { type: 'cmk:editor:arquivo-erro', erro }
// oculto: quadro invisível (automático, sem clique); senão abre em nova aba (precisa de clique).
// Guardado no Storage em solicitacoes/<id>/site-final/v<N>-<data>-<nome>.zip (+ .json com o resumo).
// =====================================================================
const PASTA_SITE_FINAL = (solicitacaoId) => 'solicitacoes/' + solicitacaoId + '/site-final';

function gerarArquivoDoSite({ pasta, dados, oculto = true, tempo = 45000 }) {
  return new Promise((resolve, reject) => {
    if (!pasta) { reject(new Error('Modelo desconhecido.')); return; }
    const url = urlSite('templates/' + pasta + '/') + '?equipe&origem=gerar';
    let quadro = null, aba = null, relogio = null;
    if (oculto) {
      quadro = document.createElement('iframe');
      quadro.src = url;
      quadro.title = 'Gerando o arquivo do site';
      quadro.tabIndex = -1;
      quadro.setAttribute('aria-hidden', 'true');
      quadro.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:800px;border:0;opacity:0;pointer-events:none';
      document.body.appendChild(quadro);
    } else {
      aba = window.open(url, '_blank');
      if (!aba) { reject(new Error('O navegador bloqueou a nova aba. Permita pop-ups para a plataforma e tente de novo.')); return; }
    }
    const origens = origensDoSite();
    const fonte = () => (quadro ? quadro.contentWindow : aba);
    function fim(fn, valor) {
      clearTimeout(relogio);
      window.removeEventListener('message', ouvir);
      if (quadro) quadro.remove();
      fn(valor);
    }
    function ouvir(e) {
      if (e.source !== fonte() || !origens.has(e.origin) || !e.data) return;
      const m = e.data;
      if (m.type === 'cmk:editor:pronto') e.source.postMessage({ type: 'cmk:editor:dados', dados }, e.origin);
      else if (m.type === 'cmk:editor:arquivo' && m.zip instanceof ArrayBuffer && m.zip.byteLength > 22) {
        fim(resolve, {
          blob: new Blob([m.zip], { type: 'application/zip' }),
          nome: /^[a-z0-9-]{1,80}\.zip$/.test(m.nome || '') ? m.nome : 'site.zip',
          arquivos: Array.isArray(m.arquivos) ? m.arquivos.map(String).slice(0, 200) : [],
          pendencias: Array.isArray(m.pendencias) ? m.pendencias.filter((p) => p && typeof p.titulo === 'string').map((p) => ({ tipo: String(p.tipo || ''), nivel: p.nivel === 'aviso' ? 'aviso' : 'bloqueia', titulo: p.titulo, itens: Array.isArray(p.itens) ? p.itens.map(String) : [] })) : null,
          marca: String(m.marca || '').slice(0, 120)
        });
      } else if (m.type === 'cmk:editor:arquivo-erro') fim(reject, new Error(String(m.erro || 'O editor não conseguiu montar o arquivo.')));
    }
    window.addEventListener('message', ouvir);
    relogio = setTimeout(() => fim(reject, new Error(oculto ? 'O editor do modelo não respondeu a tempo.' : 'A aba do editor não respondeu. Ela ainda está aberta?')), tempo);
  });
}

// Lista os arquivos gerados (mais recente primeiro), cada um com o resumo do .json ao lado.
async function listarArquivosDoSite(solicitacaoId) {
  const pasta = PASTA_SITE_FINAL(solicitacaoId);
  const { data, error } = await db.storage.from('arquivos').list(pasta, { limit: 100, sortBy: { column: 'name', order: 'desc' } });
  if (error || !data) return [];
  const zips = data.filter((o) => /\.zip$/.test(o.name));
  return Promise.all(zips.map(async (o) => {
    const caminho = pasta + '/' + o.name;
    let resumo = null;
    const j = await db.storage.from('arquivos').download(caminho.replace(/\.zip$/, '.json'));
    if (!j.error && j.data) { try { resumo = JSON.parse(await j.data.text()); } catch (_) { /* resumo ilegível */ } }
    const versao = Number((o.name.match(/^v(\d+)-/) || [])[1]) || 1;
    return { caminho, nome: o.name, versao, tamanho: (o.metadata && o.metadata.size) || null, criadoEm: o.created_at, resumo };
  }));
}

async function guardarArquivoDoSite(solicitacaoId, versao, gerado, extra) {
  const base = PASTA_SITE_FINAL(solicitacaoId) + '/v' + versao + '-' + Date.now() + '-' + gerado.nome.replace(/\.zip$/, '');
  const up = await db.storage.from('arquivos').upload(base + '.zip', gerado.blob, { contentType: 'application/zip' });
  if (up.error) throw new Error('Não foi possível guardar o arquivo: ' + up.error.message);
  const resumo = { versao, nome: gerado.nome, arquivos: gerado.arquivos, pendencias: gerado.pendencias, marca: gerado.marca, geradoEm: new Date().toISOString(), ...extra };
  await db.storage.from('arquivos').upload(base + '.json', new Blob([JSON.stringify(resumo)], { type: 'application/json' }), { contentType: 'application/json' });
  return { caminho: base + '.zip', nome: base.split('/').pop() + '.zip', versao, tamanho: gerado.blob.size, criadoEm: resumo.geradoEm, resumo };
}
