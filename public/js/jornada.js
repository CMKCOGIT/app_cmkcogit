// jornada.js — Jornada MVP. Cliente: responde os módulos e envia para revisão.
// Equipe (admin): lista as jornadas, lê as respostas, aprova ou pede ajustes.
// No fim, o orçamento do MVP (escopo lido pela IA, valores calculados no servidor).
// A trilha (módulos e perguntas) vem do servidor: a fonte é lib/jornada.js.
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;
  const admin = ehAdmin(perfil);
  const raiz = document.getElementById('jornada');
  const idDaUrl = new URLSearchParams(window.location.search).get('id');
  const ORCAMENTO = 'orcamento';
  const ROTA = 'notificacoes?rota=jornada'; // a rota mora dentro de /api/notificacoes (limite de funções da Vercel)

  const ROTULO = { aberto: 'Em preenchimento', enviado: 'Em revisão', ajustes: 'Ajustes pedidos', aprovado: 'Aprovado' };
  const TOM = { aberto: 'neutro', enviado: 'info', ajustes: 'atencao', aprovado: 'ok' };
  const COMPLEXIDADE = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };

  let E = null;          // { definicao, jornada, modulos, orcamento, cliente }
  let selecionado = null; // id do módulo aberto ou ORCAMENTO

  if (admin) document.getElementById('jm-subtitulo').textContent = 'Acompanhe as respostas dos clientes, aprove ou peça ajustes em cada módulo e gere o orçamento do MVP.';

  const def = (id) => E.definicao.find((m) => m.id === id);
  const linha = (id) => E.modulos.find((m) => m.modulo === id);
  const LIM = { ramos: 3, niveis: 5, segmentos: 4, objetivos: 4 };
  const temTexto = (t) => Boolean(String(t || '').trim());
  // "respondida" olha o conteúdo: linhas em branco de uma árvore ou de um segmento não contam
  function respondida(v, e) {
    if (e && e.tipo === 'arvore') return (v || []).some((r) => (r || []).some((c) => temTexto(c.texto)));
    if (e && e.tipo === 'segmentos') return (v || []).some((g) => temTexto(g.nome));
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  }
  const contam = (m) => m.etapas.filter((e) => e.tipo !== 'mapa');
  const feitas = (m, r) => contam(m).filter((e) => respondida(r[e.id], e)).length;
  const oportunidade = (o) => o.importancia + Math.max(o.importancia - o.satisfacao, 0);
  const aprovados = () => E.modulos.filter((m) => m.status === 'aprovado').length;
  const editavel = (l) => !admin && (l.status === 'aberto' || l.status === 'ajustes');

  async function pedir(corpo) {
    const dados = await api(ROTA, corpo);
    E = { ...E, ...dados };
    return dados;
  }

  // ------------------------------------------------------------------ entrada
  async function carregar() {
    try {
      E = await api(ROTA + (admin && idDaUrl ? '&id=' + encodeURIComponent(idDaUrl) : ''), null, 'GET');
    } catch (e) {
      raiz.removeAttribute('aria-busy');
      raiz.innerHTML = '';
      mostrarErro('Não foi possível carregar a jornada: ' + e.message);
      return;
    }
    raiz.removeAttribute('aria-busy');
    if (E.jornadas) return desenharLista();
    if (!E.jornada) return desenharInicio();
    const pedido = window.location.hash.slice(1);
    selecionado = pedido === ORCAMENTO || E.definicao.some((m) => m.id === pedido) ? pedido : primeiroPendente();
    desenhar();
  }

  function primeiroPendente() {
    if (E.orcamento) return ORCAMENTO;
    const alvo = admin ? ['enviado'] : ['ajustes', 'aberto'];
    const m = E.modulos.find((x) => alvo.includes(x.status));
    return m ? m.modulo : aprovados() === E.definicao.length ? ORCAMENTO : E.definicao[0].id;
  }

  // ------------------------------------------------------------------ equipe: lista
  function desenharLista() {
    if (!E.jornadas.length) {
      raiz.innerHTML = '<div class="lista-cards"><p data-vazio>Nenhum cliente começou a Jornada MVP ainda.<br>Ela aparece aqui assim que alguém iniciar pelo menu "Jornada MVP".</p></div>';
      return;
    }
    raiz.innerHTML = '<div class="jm-lista">' + E.jornadas.map((j) => {
      const pct = Math.round((j.aprovados / j.total) * 100);
      return `
      <a class="jm-cartao jm-item" href="jornada.html?id=${encodeURIComponent(j.id)}">
        ${anelHtml(pct, `${j.aprovados} de ${j.total} módulos aprovados`)}
        <div>
          <h2>${esc(j.titulo)}</h2>
          <p class="nota">${esc(j.cliente.nome)} · atualizado ${esc(tempoRelativo(j.updated_at))}</p>
          <p data-etiquetas>
            ${j.para_revisar ? `<span data-etiqueta="info">${j.para_revisar} para revisar</span>` : ''}
            ${j.em_ajuste ? `<span data-etiqueta="atencao">${j.em_ajuste} em ajuste</span>` : ''}
            <span data-etiqueta="${j.tem_orcamento ? 'ok' : 'neutro'}">${j.tem_orcamento ? 'Orçamento gerado' : j.aprovados + ' de ' + j.total + ' aprovados'}</span>
          </p>
        </div>
      </a>`;
    }).join('') + '</div>';
  }

  // ------------------------------------------------------------------ cliente: começar
  function desenharInicio() {
    if (admin) { raiz.innerHTML = '<div class="lista-cards"><p data-vazio>Jornada não encontrada.</p></div>'; return; }
    raiz.innerHTML = `
      <section class="jm-cartao jm-inicio">
        <h2>Do problema ao orçamento do seu MVP</h2>
        <p>São ${E.definicao.length} módulos curtos. Você responde no seu ritmo, a equipe revisa cada um e, quando todos estiverem aprovados, a plataforma monta o escopo e a estimativa de investimento do seu MVP.</p>
        <ol class="jm-resumo-trilha">
          ${E.definicao.map((m) => `<li>${icone(m.icone)}<div><strong>${esc(m.nome)}</strong><span>${esc(m.resumo)}</span></div></li>`).join('')}
          <li>${icone('recibo')}<div><strong>Orçamento do MVP</strong><span>Funcionalidades, prioridades, prazo e faixa de investimento.</span></div></li>
        </ol>
        <form id="jm-form-inicio" class="jm-form-inicio">
          <label for="jm-titulo">Como se chama o seu produto ou ideia?</label>
          <div>
            <input id="jm-titulo" name="titulo" maxlength="80" minlength="2" required placeholder="Ex.: Agenda Fácil" autocomplete="off">
            <button type="submit">Começar a jornada ${icone('avancar')}</button>
          </div>
        </form>
      </section>`;
    document.getElementById('jm-form-inicio').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const botao = ev.target.querySelector('button');
      ocupado(botao, true, 'Criando...');
      try {
        await pedir({ acao: 'iniciar', titulo: ev.target.titulo.value });
        selecionado = E.definicao[0].id;
        desenhar();
      } catch (e) { ocupado(botao, false); toast(e.message, 'erro'); }
    });
  }

  // ------------------------------------------------------------------ jornada
  function desenhar() {
    const total = E.definicao.length;
    const pct = Math.round((aprovados() / total) * 100);
    raiz.innerHTML = `
      <section class="jm-cartao jm-topo">
        ${anelHtml(pct, `${aprovados()} de ${total} módulos aprovados`, true)}
        <div>
          ${admin ? `<a class="jm-voltar" href="jornada.html">${icone('voltar')} Todas as jornadas</a>` : ''}
          <h2>${esc(E.jornada.titulo)}</h2>
          <p class="nota">${admin && E.cliente ? esc(E.cliente.nome) + (E.cliente.email ? ' · ' + esc(E.cliente.email) : '') + ' · ' : ''}${aprovados()} de ${total} módulos aprovados${E.orcamento ? ' · orçamento gerado' : ''}</p>
        </div>
      </section>
      <nav class="jm-trilha" aria-label="Módulos da jornada"><ol id="jm-trilha"></ol></nav>
      <section class="jm-cartao jm-painel" id="jm-painel" aria-live="polite"></section>`;
    desenharTrilha();
    desenharPainel();
    animarNumeros();
  }

  function desenharTrilha() {
    const liberado = aprovados() === E.definicao.length;
    const itens = E.definicao.map((m, i) => {
      const l = linha(m.id);
      const nota = l.status === 'aberto' ? `${feitas(m, l.respostas)} de ${contam(m).length}` : ROTULO[l.status];
      return `<li><button type="button" class="jm-no" data-modulo="${m.id}" data-estado="${l.status}" ${selecionado === m.id ? 'aria-current="step"' : ''}>
        <span class="jm-bola">${icone(l.status === 'aprovado' ? 'concluido' : m.icone)}</span>
        <span class="jm-no-nome">${i + 1}. ${esc(m.nome)}</span><span class="jm-no-nota">${esc(nota)}</span></button></li>`;
    });
    itens.push(`<li class="jm-final"><button type="button" class="jm-no" data-modulo="${ORCAMENTO}" data-estado="${E.orcamento ? 'aprovado' : liberado ? 'enviado' : 'bloqueado'}" ${selecionado === ORCAMENTO ? 'aria-current="step"' : ''}>
        <span class="jm-bola">${icone('recibo')}</span>
        <span class="jm-no-nome">Orçamento do MVP</span><span class="jm-no-nota">${E.orcamento ? 'Pronto' : liberado ? 'Liberado' : 'Ao final'}</span></button></li>`);
    const ol = document.getElementById('jm-trilha');
    ol.innerHTML = itens.join('');
    ol.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
      await gravarAgora();
      selecionado = b.dataset.modulo;
      history.replaceState(null, '', '#' + selecionado);
      desenharTrilha();
      desenharPainel();
      document.getElementById('jm-painel').scrollIntoView({ block: 'nearest', behavior: MOVIMENTO_REDUZIDO ? 'auto' : 'smooth' });
    }));
    const atual = ol.querySelector('[aria-current]');
    if (atual) atual.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function desenharPainel() {
    if (selecionado === ORCAMENTO) return desenharOrcamento();
    desenharModulo();
  }

  // ------------------------------------------------------------------ módulo
  // ---- etapas estruturadas: árvore do problema, segmentos de clientes e mapa de oportunidades ----
  let estr = {}; // cópia de trabalho das etapas estruturadas do módulo aberto: { idDaEtapa: valor }

  function prepararEstr(m, l) {
    estr = {};
    for (const e of m.etapas) {
      const v = JSON.parse(JSON.stringify(l.respostas[e.id] || []));
      if (e.tipo === 'arvore') {
        while (v.length < LIM.ramos) v.push([]);
        v.forEach((r) => { if (!r.length) r.push({ texto: '', alvo: false }); });
        estr[e.id] = v;
      } else if (e.tipo === 'segmentos') {
        if (!v.length) v.push(novoSegmento());
        estr[e.id] = v;
      }
    }
  }
  const novoObjetivo = () => ({ texto: '', importancia: 5, satisfacao: 5 });
  const novoSegmento = () => ({ nome: '', problemas: '', beneficios: '', foco: false, objetivos: [novoObjetivo()] });

  function arvoreHtml(e, v, pode) {
    if (!pode) {
      const ramos = (v || []).filter((r) => r.length);
      if (!ramos.length) return '<p class="jm-resposta" data-vazia>Sem resposta.</p>';
      return `<div class="jm-arvore">${ramos.map((r, i) => `<div class="jm-ramo"><h4>Causa ${i + 1}</h4><ol>${r.map((c) =>
        `<li${c.alvo ? ' data-alvo' : ''}>${esc(c.texto)}${c.alvo ? ` <span data-etiqueta="ok">O produto ataca</span>` : ''}</li>`).join('')}</ol></div>`).join('')}</div>`;
    }
    return `<div class="jm-arvore">${v.map((r, i) => `
      <div class="jm-ramo"><h4>Causa ${i + 1}</h4>
        ${r.map((c, n) => `${n ? '<span class="jm-porque" aria-hidden="true">por quê?</span>' : ''}
        <div class="jm-causa">
          <textarea rows="2" maxlength="240" data-e="${e.id}" data-r="${i}" data-n="${n}" data-k="texto" aria-label="Causa ${i + 1}, nível ${n + 1}" placeholder="${n ? 'Por que isso acontece?' : 'Uma causa direta do problema'}">${esc(c.texto)}</textarea>
          <label class="jm-marca"><input type="checkbox" data-e="${e.id}" data-r="${i}" data-n="${n}" data-k="alvo"${c.alvo ? ' checked' : ''}> <span>O produto ataca esta causa</span></label>
        </div>`).join('')}
        ${r.length < LIM.niveis ? `<button type="button" class="jm-mais" data-acao="mais-causa" data-e="${e.id}" data-r="${i}">${icone('adicionar')} Por quê?</button>` : ''}
      </div>`).join('')}</div>`;
  }

  function segmentosHtml(e, v, pode) {
    if (!pode) {
      const segs = (v || []).filter((g) => temTexto(g.nome));
      if (!segs.length) return '<p class="jm-resposta" data-vazia>Sem resposta.</p>';
      return `<div class="jm-segs">${segs.map((g, i) => `
        <div class="jm-seg" data-cor="${i + 1}">
          <p class="jm-seg-topo"><span class="jm-cor" aria-hidden="true"></span><strong>${esc(g.nome)}</strong>${g.foco ? ' <span data-etiqueta="ok">Foco da primeira versão</span>' : ''}</p>
          <div class="jm-seg-duas"><div><h4>Dores</h4><p>${esc(g.problemas || 'Sem resposta.')}</p></div><div><h4>Benefícios</h4><p>${esc(g.beneficios || 'Sem resposta.')}</p></div></div>
          ${g.objetivos.length ? `<h4>Objetivos</h4><ul data-livre>${g.objetivos.map((o) => `<li><span>${esc(o.texto)}</span><span class="nota">importância ${o.importancia}/10 · já atendido ${o.satisfacao}/10</span></li>`).join('')}</ul>` : ''}
        </div>`).join('')}</div>`;
    }
    const base = (i) => `data-e="${e.id}" data-g="${i}"`;
    return `<div class="jm-segs">${v.map((g, i) => `
      <fieldset class="jm-seg" data-cor="${i + 1}">
        <legend class="sr-only">Segmento ${i + 1}</legend>
        <div class="jm-seg-topo">
          <span class="jm-cor" aria-hidden="true"></span>
          <input type="text" maxlength="60" ${base(i)} data-k="nome" value="${esc(g.nome)}" aria-label="Nome do segmento ${i + 1}" placeholder="Nome do grupo de clientes">
          <label class="jm-marca"><input type="checkbox" ${base(i)} data-k="foco"${g.foco ? ' checked' : ''}> <span>Foco da primeira versão</span></label>
          ${v.length > 1 ? `<button type="button" class="botao-icone" data-acao="menos-seg" ${base(i)} aria-label="Remover o segmento ${i + 1}" title="Remover segmento">${icone('remover')}</button>` : ''}
        </div>
        <div class="jm-seg-duas">
          <label>Dores: o que incomoda esse grupo hoje<textarea rows="3" maxlength="600" ${base(i)} data-k="problemas">${esc(g.problemas)}</textarea></label>
          <label>Benefícios: o que ele ganha com o seu produto<textarea rows="3" maxlength="600" ${base(i)} data-k="beneficios">${esc(g.beneficios)}</textarea></label>
        </div>
        <div class="jm-objs">
          <h4>Objetivos que esse grupo quer alcançar</h4>
          ${g.objetivos.map((o, n) => `
          <div class="jm-obj">
            <input type="text" maxlength="140" ${base(i)} data-o="${n}" data-k="texto" value="${esc(o.texto)}" aria-label="Objetivo ${n + 1} do segmento ${i + 1}" placeholder="Ex.: saber com antecedência se...">
            <label>Importância <output>${o.importancia}</output><input type="range" min="0" max="10" step="1" ${base(i)} data-o="${n}" data-k="importancia" value="${o.importancia}"></label>
            <label>Já atendido hoje <output>${o.satisfacao}</output><input type="range" min="0" max="10" step="1" ${base(i)} data-o="${n}" data-k="satisfacao" value="${o.satisfacao}"></label>
            <button type="button" class="botao-icone" data-acao="menos-obj" ${base(i)} data-o="${n}" aria-label="Remover o objetivo ${n + 1}" title="Remover objetivo">${icone('fechar')}</button>
          </div>`).join('')}
          ${g.objetivos.length < LIM.objetivos ? `<button type="button" class="jm-mais" data-acao="mais-obj" ${base(i)}>${icone('adicionar')} Adicionar objetivo</button>` : ''}
        </div>
      </fieldset>`).join('')}
      ${v.length < LIM.segmentos ? `<button type="button" class="jm-mais" data-acao="mais-seg" data-e="${e.id}">${icone('adicionar')} Adicionar segmento</button>` : ''}</div>`;
  }

  // Mapa de oportunidades: cada objetivo é um ponto (importância × já atendido hoje).
  // A cor identifica o segmento; o número liga o ponto à tabela logo abaixo.
  function mapaHtml(segs) {
    const pontos = [];
    (segs || []).forEach((g, i) => { if (temTexto(g.nome)) g.objetivos.forEach((o) => { if (temTexto(o.texto)) pontos.push({ ...o, seg: g.nome, cor: i + 1, foco: g.foco, nota: oportunidade(o) }); }); });
    if (!pontos.length) return '<p class="jm-resposta" data-vazia>O mapa aparece quando houver objetivos preenchidos em "Segmentos de clientes".</p>';
    pontos.sort((a, b) => b.nota - a.nota);
    const L = 44, T = 14, W = 420, H = 260; // área do gráfico dentro do SVG
    const x = (n) => L + (n / 10) * W;
    const y = (n) => T + H - (n / 10) * H;
    const usados = new Map(); // pontos na mesma posição: abre em leque para nenhum sumir
    const marcas = pontos.map((p, i) => {
      const chave = p.importancia + ':' + p.satisfacao;
      const k = usados.get(chave) || 0;
      usados.set(chave, k + 1);
      const cx = x(p.importancia) + k * 13, cy = y(p.satisfacao) - k * 5;
      return `<g><title>${esc(p.texto)} (${esc(p.seg)}): importância ${p.importancia}, já atendido ${p.satisfacao}</title>
        <circle class="jm-ponto" data-cor="${p.cor}" cx="${cx}" cy="${cy}" r="8"/><text class="jm-ponto-n" x="${cx}" y="${cy - 12}" text-anchor="middle">${i + 1}</text></g>`;
    }).join('');
    const nomes = [...new Map(pontos.map((p) => [p.cor, p.seg])).entries()].sort((a, b) => a[0] - b[0]);
    return `
      <figure class="jm-mapa">
        <svg viewBox="0 0 ${L + W + 16} ${T + H + 44}" role="img" aria-label="Mapa de oportunidades: ${pontos.length} objetivos por importância e por quanto já são atendidos hoje. Os dados estão na tabela a seguir.">
          <rect class="jm-zona" x="${x(5)}" y="${y(5)}" width="${W / 2}" height="${H / 2}"/>
          <text class="jm-zona-t" x="${x(10) - 8}" y="${y(0) - 8}" text-anchor="end">Maior oportunidade</text>
          <path class="jm-grade" d="M${x(5)} ${T}V${T + H}M${L} ${y(5)}H${L + W}"/>
          <path class="jm-eixo" d="M${L} ${T}V${T + H}H${L + W}"/>
          <text class="jm-eixo-t" x="${L}" y="${T + H + 18}">Pouco importante</text>
          <text class="jm-eixo-t" x="${L + W}" y="${T + H + 18}" text-anchor="end">Muito importante</text>
          <text class="jm-eixo-t" x="${L + W / 2}" y="${T + H + 36}" text-anchor="middle">Importância para o cliente</text>
          <text class="jm-eixo-t" transform="translate(14 ${T + H / 2}) rotate(-90)" text-anchor="middle">Já atendido hoje</text>
          <text class="jm-eixo-t" x="${L - 6}" y="${T + 10}" text-anchor="end">10</text>
          <text class="jm-eixo-t" x="${L - 6}" y="${T + H}" text-anchor="end">0</text>
          ${marcas}
        </svg>
        <figcaption>${nomes.map(([cor, nome]) => `<span><span class="jm-cor" data-cor="${cor}" aria-hidden="true"></span>${esc(nome)}</span>`).join('')}</figcaption>
      </figure>
      <div class="jm-tabela"><table>
        <thead><tr><th scope="col">Nº</th><th scope="col">Objetivo</th><th scope="col">Segmento</th><th scope="col">Importância</th><th scope="col">Já atendido</th><th scope="col">Oportunidade</th></tr></thead>
        <tbody>${pontos.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.texto)}</td><td><span class="jm-cor" data-cor="${p.cor}" aria-hidden="true"></span>${esc(p.seg)}${p.foco ? ' (foco)' : ''}</td><td>${p.importancia}</td><td>${p.satisfacao}</td><td><strong>${p.nota}</strong> <small>de 20</small></td></tr>`).join('')}</tbody>
      </table></div>`;
  }

  // Liga digitação e botões das etapas estruturadas ao estado "estr".
  function ligarEstr(form, m) {
    const redesenhar = (id, focar) => {
      const e = m.etapas.find((x) => x.id === id);
      const caixa = form.querySelector(`[data-estr="${id}"]`);
      caixa.innerHTML = e.tipo === 'arvore' ? arvoreHtml(e, estr[id], true) : segmentosHtml(e, estr[id], true);
      const alvo = focar && caixa.querySelector(focar);
      if (alvo) alvo.focus();
    };
    const mapas = () => m.etapas.filter((e) => e.tipo === 'mapa').forEach((e) => {
      const caixa = form.querySelector(`[data-estr="${e.id}"]`);
      if (caixa) caixa.innerHTML = mapaHtml(estr[e.fonte]);
    });
    form.addEventListener('input', (ev) => {
      const t = ev.target;
      const v = t.dataset && estr[t.dataset.e];
      if (!v) return;
      const valor = t.type === 'checkbox' ? t.checked : t.type === 'range' ? Number(t.value) : t.value;
      if (t.dataset.r != null) v[+t.dataset.r][+t.dataset.n][t.dataset.k] = valor;
      else if (t.dataset.o != null) v[+t.dataset.g].objetivos[+t.dataset.o][t.dataset.k] = valor;
      else v[+t.dataset.g][t.dataset.k] = valor;
      if (t.type === 'range') t.parentElement.querySelector('output').textContent = valor;
      mapas();
    });
    form.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-acao]');
      if (!b) return;
      const id = b.dataset.e;
      const v = estr[id];
      const g = +b.dataset.g;
      let focar = null;
      if (b.dataset.acao === 'mais-causa') { v[+b.dataset.r].push({ texto: '', alvo: false }); focar = `textarea[data-r="${b.dataset.r}"][data-n="${v[+b.dataset.r].length - 1}"]`; }
      if (b.dataset.acao === 'mais-seg') { v.push(novoSegmento()); focar = `input[data-g="${v.length - 1}"][data-k="nome"]`; }
      if (b.dataset.acao === 'menos-seg') { if (temTexto(v[g].nome) && !window.confirm('Remover o segmento "' + v[g].nome + '" e os objetivos dele?')) return; v.splice(g, 1); }
      if (b.dataset.acao === 'mais-obj') { v[g].objetivos.push(novoObjetivo()); focar = `input[data-g="${g}"][data-o="${v[g].objetivos.length - 1}"][data-k="texto"]`; }
      if (b.dataset.acao === 'menos-obj') v[g].objetivos.splice(+b.dataset.o, 1);
      redesenhar(id, focar);
      mapas();
      marcarEtapas(form, m);
      agendar();
    });
  }

  function campoHtml(e, valor, pode) {
    if (e.tipo === 'arvore') return `<div data-estr="${e.id}">${arvoreHtml(e, pode ? estr[e.id] : valor, pode)}</div>`;
    if (e.tipo === 'segmentos') return `<div data-estr="${e.id}">${segmentosHtml(e, pode ? estr[e.id] : valor, pode)}</div>`;
    if (e.tipo === 'mapa') return `<div data-estr="${e.id}">${mapaHtml(pode ? estr[e.fonte] : linha(selecionado).respostas[e.fonte])}</div>`;
    const trava = pode ? '' : ' disabled';
    if (e.tipo === 'multipla' || e.tipo === 'unica') {
      const marcados = e.tipo === 'multipla' ? (valor || []) : [valor];
      return `<div class="jm-opcoes" role="group" aria-labelledby="jm-p-${e.id}">${e.opcoes.map((o) => `
        <label><input type="${e.tipo === 'multipla' ? 'checkbox' : 'radio'}" name="${e.id}" value="${o.id}"${marcados.includes(o.id) ? ' checked' : ''}${trava}> <span>${esc(o.nome)}</span></label>`).join('')}</div>`;
    }
    if (!pode) return valor ? `<p class="jm-resposta">${esc(valor)}</p>` : '<p class="jm-resposta" data-vazia>Sem resposta.</p>';
    if (e.curto) return `<input type="text" name="${e.id}" maxlength="140" value="${esc(valor || '')}" aria-labelledby="jm-p-${e.id}">`;
    return `<textarea name="${e.id}" rows="4" maxlength="1500" aria-labelledby="jm-p-${e.id}"${e.dica ? ` aria-describedby="jm-d-${e.id}"` : ''}>${esc(valor || '')}</textarea>`;
  }

  function desenharModulo() {
    const m = def(selecionado);
    const l = linha(m.id);
    const pode = editavel(l);
    if (pode) prepararEstr(m, l);
    const painel = document.getElementById('jm-painel');
    const aviso = !admin && l.status === 'enviado' ? 'A equipe está revisando este módulo. Você recebe um aviso no sino quando houver retorno.'
      : !admin && l.status === 'aprovado' ? 'Módulo aprovado. As respostas ficam guardadas para consulta.'
        : admin && l.status === 'aberto' ? 'O cliente ainda está preenchendo este módulo.' : '';
    painel.innerHTML = `
      <header class="jm-painel-topo">
        <div><h2>${esc(m.nome)}</h2><p class="nota">${esc(m.resumo)}</p></div>
        <span data-etiqueta="${TOM[l.status]}">${ROTULO[l.status]}</span>
      </header>
      ${l.comentario ? `<blockquote class="jm-retorno" data-tom="${l.status === 'ajustes' ? 'atencao' : 'ok'}"><strong>Retorno da equipe</strong><p>${esc(l.comentario)}</p></blockquote>` : ''}
      ${aviso ? `<p class="jm-aviso">${icone('info')} ${esc(aviso)}</p>` : ''}
      <form id="jm-form" novalidate>
        ${m.etapas.map((e, i) => `
        <div class="jm-etapa" data-etapa="${e.id}"${e.tipo === 'mapa' ? ' data-mostra' : respondida(l.respostas[e.id], e) ? ' data-ok' : ''}>
          <span class="jm-num" aria-hidden="true">${i + 1}</span>
          <div>
            <h3>${esc(e.titulo)}${e.opcional && e.tipo !== 'mapa' ? ' <small>(opcional)</small>' : ''}</h3>
            <p id="jm-p-${e.id}" class="jm-pergunta">${esc(e.pergunta)}</p>
            ${e.dica && pode ? `<p id="jm-d-${e.id}" class="nota">${esc(e.dica)}</p>` : ''}
            ${campoHtml(e, l.respostas[e.id], pode)}
          </div>
        </div>`).join('')}
        ${pode ? `<footer class="jm-rodape">
          <span id="jm-salvo" class="nota" role="status"></span>
          <button type="submit">${l.status === 'ajustes' ? 'Reenviar para revisão' : 'Enviar para revisão'} ${icone('enviado')}</button>
        </footer>` : ''}
      </form>
      ${admin && l.status !== 'aberto' ? `
      <form id="jm-revisao" class="jm-revisao">
        <label for="jm-comentario">Retorno para o cliente</label>
        <textarea id="jm-comentario" rows="3" maxlength="1000" placeholder="O que está bom, o que precisa detalhar...">${esc(l.comentario || '')}</textarea>
        <div class="pagina-acoes">
          <button type="button" data-decisao="ajustes">${icone('editar')} Pedir ajustes</button>
          <button type="submit" data-decisao="aprovado">${icone('aprovar')} ${l.status === 'aprovado' ? 'Manter aprovado' : 'Aprovar módulo'}</button>
        </div>
      </form>` : ''}`;

    const form = document.getElementById('jm-form');
    if (pode) {
      ligarEstr(form, m); // antes: o estado das etapas estruturadas precisa estar em dia quando o salvamento ler
      form.addEventListener('input', () => { marcarEtapas(form, m); agendar(); });
      form.addEventListener('change', () => gravarAgora());
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const botao = form.querySelector('button[type=submit]');
        ocupado(botao, true, 'Enviando...');
        try {
          await gravarAgora(true);
          await pedir({ acao: 'enviar', jornada_id: E.jornada.id, modulo: m.id });
          toast('Módulo enviado para a equipe revisar.');
          const proximo = E.modulos.find((x) => x.status === 'aberto' || x.status === 'ajustes');
          if (proximo) selecionado = proximo.modulo;
          desenhar();
        } catch (e) { ocupado(botao, false); toast(e.message, 'erro'); }
      });
    }
    const revisao = document.getElementById('jm-revisao');
    if (revisao) {
      const avaliar = async (decisao, botao) => {
        ocupado(botao, true, 'Salvando...');
        try {
          await pedir({ acao: 'avaliar', jornada_id: E.jornada.id, modulo: m.id, decisao, comentario: document.getElementById('jm-comentario').value });
          toast(decisao === 'aprovado' ? 'Módulo aprovado.' : 'Ajustes pedidos ao cliente.');
          desenhar();
        } catch (e) { ocupado(botao, false); toast(e.message, 'erro'); }
      };
      revisao.addEventListener('submit', (ev) => { ev.preventDefault(); avaliar('aprovado', revisao.querySelector('[type=submit]')); });
      revisao.querySelector('[data-decisao=ajustes]').addEventListener('click', (ev) => avaliar('ajustes', ev.currentTarget));
    }
  }

  function lerForm(form, m) {
    const r = {};
    for (const e of m.etapas) {
      if (e.tipo === 'mapa') continue;
      if (e.tipo === 'arvore' || e.tipo === 'segmentos') { r[e.id] = JSON.parse(JSON.stringify(estr[e.id] || [])); continue; }
      if (e.tipo === 'multipla') r[e.id] = [...form.querySelectorAll(`input[name="${e.id}"]:checked`)].map((i) => i.value);
      else if (e.tipo === 'unica') r[e.id] = (form.querySelector(`input[name="${e.id}"]:checked`) || {}).value || '';
      else r[e.id] = form.elements[e.id].value.trim();
    }
    return r;
  }
  function marcarEtapas(form, m) {
    const r = lerForm(form, m);
    form.querySelectorAll('.jm-etapa:not([data-mostra])').forEach((el) => el.toggleAttribute('data-ok', respondida(r[el.dataset.etapa], m.etapas.find((e) => e.id === el.dataset.etapa))));
  }

  // Salvamento automático: uma gravação por vez, sempre com o módulo inteiro (a última vence).
  let timer = null;
  let fila = Promise.resolve();
  let sujo = false;
  function agendar() {
    sujo = true;
    const st = document.getElementById('jm-salvo');
    if (st) st.textContent = 'Salvando...';
    clearTimeout(timer);
    timer = setTimeout(() => gravarAgora(), 1200);
  }
  function gravarAgora(propagar = false) {
    clearTimeout(timer);
    const form = document.getElementById('jm-form');
    const m = selecionado !== ORCAMENTO && E && E.jornada ? def(selecionado) : null;
    if (!form || !m || !editavel(linha(m.id)) || !sujo) return fila;
    sujo = false;
    const respostas = lerForm(form, m);
    linha(m.id).respostas = respostas;
    fila = fila.then(async () => {
      const st = () => document.getElementById('jm-salvo');
      try {
        await api(ROTA, { acao: 'salvar', jornada_id: E.jornada.id, modulo: m.id, respostas });
        if (st() && !sujo) st().textContent = 'Salvo às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        if (selecionado === m.id) atualizarNota(m);
      } catch (e) {
        sujo = true;
        if (st()) st().textContent = 'Não foi possível salvar: ' + e.message;
        if (propagar) throw e;
      }
    });
    return fila;
  }
  function atualizarNota(m) {
    const no = document.querySelector(`.jm-no[data-modulo="${m.id}"] .jm-no-nota`);
    const l = linha(m.id);
    if (no && l.status === 'aberto') no.textContent = feitas(m, l.respostas) + ' de ' + contam(m).length;
  }
  window.addEventListener('pagehide', () => { gravarAgora(); });

  // ------------------------------------------------------------------ orçamento
  function desenharOrcamento() {
    const painel = document.getElementById('jm-painel');
    const o = E.orcamento;
    const liberado = aprovados() === E.definicao.length;
    const botaoGerar = (texto) => `<button type="button" id="jm-gerar" class="jm-primario">${icone('ia')} ${texto}</button>`;

    if (!o) {
      const faltam = E.definicao.filter((m) => linha(m.id).status !== 'aprovado');
      painel.innerHTML = `
        <header class="jm-painel-topo"><div><h2>Orçamento do MVP</h2>
          <p class="nota">A plataforma lê as respostas de todos os módulos, lista as funcionalidades do MVP e calcula a estimativa de investimento e de prazo.</p></div>
          <span data-etiqueta="${liberado ? 'info' : 'neutro'}">${liberado ? 'Liberado' : 'Bloqueado'}</span></header>
        ${liberado ? '' : `<p class="jm-aviso">${icone('info')} Falta aprovar: ${faltam.map((m) => esc(m.nome)).join(', ')}.</p>`}
        ${admin && !liberado ? '<p class="nota">Como equipe, você pode gerar uma prévia com as respostas que já existem.</p>' : ''}
        ${liberado || admin ? `<div class="pagina-acoes">${botaoGerar(liberado ? 'Gerar orçamento do MVP' : 'Gerar prévia do orçamento')}</div>` : ''}`;
      ligarGerar();
      return;
    }

    const grupo = (prioridade, titulo, nota) => {
      const itens = o.itens.filter((i) => i.prioridade === prioridade);
      if (!itens.length) return '';
      return `<section class="jm-grupo"><h3>${titulo} <small>${itens.length}</small></h3>${nota ? `<p class="nota">${nota}</p>` : ''}
        <ul data-livre>${itens.map((i) => `<li>
          <div><strong>${esc(i.nome)}</strong><span>${esc(i.descricao || '')}</span></div>
          <span class="jm-item-dados"><span data-etiqueta="neutro">${COMPLEXIDADE[i.complexidade] || ''}</span>${admin && i.horas ? `<span>${i.horas} h</span>` : ''}${admin && i.valor != null ? `<strong>${brl(i.valor)}</strong>` : ''}</span>
        </li>`).join('')}</ul></section>`;
    };
    const bloco = (titulo, itens) => (itens && itens.length ? `<section class="jm-grupo"><h3>${titulo}</h3><ul class="jm-pontos" data-livre>${itens.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>` : '');
    const semanas = (n) => (n === 1 ? '1 semana' : n + ' semanas');

    painel.innerHTML = `
      <header class="jm-painel-topo"><div><h2>Orçamento do MVP</h2><p class="nota">Gerado em ${esc(fmtData(o.created_at))} a partir das suas respostas.</p></div>
        <span data-etiqueta="ok">Pronto</span></header>
      ${o.resumo ? `<p class="jm-resumo">${esc(o.resumo)}</p>` : ''}
      <dl class="jm-numeros">
        <div data-destaque><dt>Investimento estimado do MVP</dt><dd>${brl(o.valor_min)} <small>a</small> ${brl(o.valor_max)}</dd></div>
        <div><dt>Prazo estimado</dt><dd>${o.mvp.semanas ? semanas(o.mvp.semanas) : 'A definir'}</dd></div>
        <div><dt>Funcionalidades no MVP</dt><dd>${o.mvp.quantidade}</dd></div>
        ${o.evolucao && o.evolucao.quantidade ? `<div><dt>Segunda versão (opcional)</dt><dd>${brl(o.evolucao.valor)}</dd></div>` : ''}
      </dl>
      ${admin ? `<p class="nota">Equipe: ${o.mvp.horas} h no MVP (${o.mvp.horas_funcionalidades} h de funcionalidades + ${o.mvp.horas_base} h de base) a ${brl(o.parametros.valor_hora)}/h${o.piso_aplicado ? ' · valor mínimo do catálogo aplicado' : ''}. O cliente não vê horas nem valor por item.</p>` : ''}
      ${grupo('essencial', 'Essenciais: entram no MVP', '')}
      ${grupo('desejavel', 'Desejáveis: segunda versão', 'Ficam fora do valor do MVP.')}
      ${grupo('futuro', 'Para o futuro', 'Ideias registradas, sem estimativa agora.')}
      ${bloco('Premissas', o.premissas)}
      ${bloco('Pontos de atenção', o.riscos)}
      ${bloco('Perguntas em aberto', o.perguntas)}
      <p class="jm-aviso">${icone('info')} Esta é uma estimativa automática. O valor final é confirmado pela equipe depois de uma conversa sobre o escopo.</p>
      <div class="pagina-acoes jm-nao-imprimir">
        ${admin ? botaoGerar('Gerar de novo') : `<a class="botao-link" href="mensagens.html">${icone('mensagens')} Conversar com a equipe</a>`}
        <button type="button" id="jm-imprimir">${icone('pdf')} Salvar em PDF</button>
      </div>`;
    document.getElementById('jm-imprimir').addEventListener('click', () => window.print());
    ligarGerar();
  }

  function ligarGerar() {
    const botao = document.getElementById('jm-gerar');
    if (!botao) return;
    botao.addEventListener('click', async () => {
      ocupado(botao, true, 'Lendo as respostas...');
      try {
        await pedir({ acao: 'gerar_orcamento', jornada_id: E.jornada.id });
        toast('Orçamento do MVP gerado.');
        desenhar();
      } catch (e) { ocupado(botao, false); toast(e.message, 'erro'); }
    });
  }

  carregar();
})();
