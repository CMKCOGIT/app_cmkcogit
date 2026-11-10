// assistente.js — Assistente IA da equipe (SÓ ADMIN): botão fixo em todas as telas do admin e
// modal de chat estilo Claude/ChatGPT. Fala com /api/mensagens-ia?modo=assistente (o servidor confere se é admin,
// aplica os limites e guarda a chave da Groq; nada disso fica no navegador).
// Histórico: só nesta aba (sessionStorage). Ativado por montarMenu() em app.js: AssistenteIA.montar(perfil).
(function () {
  const CHAVE = 'cmk_assistente_v1';
  const MAX_CARACTERES = 4000;
  const SUGESTOES = [
    { titulo: 'Pedir feedback', texto: 'Escreva uma mensagem curta e cordial para eu enviar pelo WhatsApp à minha cliente perguntando o que ela achou da plataforma.' },
    { titulo: 'Follow-up de proposta', texto: 'Escreva um follow-up educado para um cliente que recebeu nossa proposta há 5 dias e ainda não respondeu.' },
    { titulo: 'Ideias para o Instagram', texto: 'Me dê 5 ideias de posts para o Instagram da CMK COGIT esta semana, com legenda curta para cada uma.' },
    { titulo: 'Revisar segurança', texto: 'Quais são os pontos de segurança mais importantes para revisar antes de publicar um site com formulário de contato?' }
  ];
  const est = { mensagens: [], gerando: null, perfil: null, montado: false, voltarFoco: null };

  function carregar() { try { est.mensagens = JSON.parse(sessionStorage.getItem(CHAVE)).mensagens || []; } catch (_) { est.mensagens = []; } }
  function salvar() { try { sessionStorage.setItem(CHAVE, JSON.stringify({ mensagens: est.mensagens.slice(-40) })); } catch (_) {} }

  // ---------------------------------------------------------------
  // Markdown seguro (o texto é escapado ANTES de formatar; links só http/https)
  // ---------------------------------------------------------------
  function inline(t) {
    return t
      .replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<.,;:!?)])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  }
  function markdown(fonte) {
    const linhas = esc(fonte || '').replace(/\r/g, '').split('\n');
    const out = [];
    let i = 0;
    const lista = (tipo, re) => {
      const itens = [];
      while (i < linhas.length && re.test(linhas[i])) { itens.push(`<li>${inline(linhas[i].replace(re, ''))}</li>`); i += 1; }
      out.push(`<${tipo}>${itens.join('')}</${tipo}>`);
    };
    while (i < linhas.length) {
      const l = linhas[i];
      const cerca = /^\s*```\s*([\w+-]*)\s*$/.exec(l);
      if (cerca) {
        const cod = [];
        i += 1;
        while (i < linhas.length && !/^\s*```\s*$/.test(linhas[i])) { cod.push(linhas[i]); i += 1; }
        i += 1;
        out.push(`<div class="ia-codigo"><div class="ia-codigo-topo"><span>${cerca[1] || 'código'}</span><button type="button" data-copiar-codigo>Copiar</button></div><pre><code>${cod.join('\n')}</code></pre></div>`);
        continue;
      }
      if (/^\s*$/.test(l)) { i += 1; continue; }
      const h = /^(#{1,4})\s+(.*)$/.exec(l);
      if (h) { const n = Math.min(4, h[1].length + 2); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i += 1; continue; }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { out.push('<hr>'); i += 1; continue; }
      if (/^\s*&gt;\s?/.test(l)) {
        const q = [];
        while (i < linhas.length && /^\s*&gt;\s?/.test(linhas[i])) { q.push(inline(linhas[i].replace(/^\s*&gt;\s?/, ''))); i += 1; }
        out.push(`<blockquote>${q.join('<br>')}</blockquote>`);
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < linhas.length && /^\s*\|?\s*:?-{2,}/.test(linhas[i + 1])) {
        const celulas = (s) => s.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
        const cab = celulas(l);
        i += 2;
        const corpo = [];
        while (i < linhas.length && /^\s*\|.*\|\s*$/.test(linhas[i])) { corpo.push(celulas(linhas[i])); i += 1; }
        out.push(`<div class="ia-tabela"><table><thead><tr>${cab.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${corpo.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (/^\s*[-*+•]\s+/.test(l)) { lista('ul', /^\s*[-*+•]\s+/); continue; }
      if (/^\s*\d+[.)]\s+/.test(l)) { lista('ol', /^\s*\d+[.)]\s+/); continue; }
      const p = [];
      while (i < linhas.length && !/^\s*$/.test(linhas[i]) && !/^(#{1,4})\s|^\s*```|^\s*[-*+•]\s+|^\s*\d+[.)]\s+|^\s*&gt;/.test(linhas[i])) { p.push(inline(linhas[i])); i += 1; }
      if (!p.length) { out.push(`<p>${inline(l)}</p>`); i += 1; } else out.push(`<p>${p.join('<br>')}</p>`);
    }
    return out.join('');
  }

  // ---------------------------------------------------------------
  // Interface
  // ---------------------------------------------------------------
  function montarDialogo() {
    const dlg = document.createElement('dialog');
    dlg.id = 'dlg-assistente';
    dlg.className = 'ia-dialogo';
    dlg.setAttribute('aria-labelledby', 'ia-titulo');
    dlg.innerHTML = `
      <header class="ia-topo">
        <span class="ia-marca" aria-hidden="true">${icone('ia')}</span>
        <div class="ia-topo-texto"><h2 id="ia-titulo">Assistente IA</h2><p>Base da CMK COGIT · não acessa a internet</p></div>
        <button type="button" class="ia-acao" id="ia-nova" title="Nova conversa">${icone('nova-conversa')}<span>Nova conversa</span></button>
        <button type="button" class="ia-acao ia-fechar" data-fechar aria-label="Fechar o assistente">${icone('fechar')}</button>
      </header>
      <div class="ia-rolagem" id="ia-rolagem">
        <section class="ia-boas-vindas" id="ia-boas-vindas" aria-labelledby="ia-oi">
          <span class="ia-marca ia-marca-grande" aria-hidden="true">${icone('ia')}</span>
          <h3 id="ia-oi">Como posso ajudar, ${esc(primeiroNome())}?</h3>
          <p>Mensagens para clientes, vendas, marketing, desenvolvimento, QA, segurança e dúvidas sobre a CMK COGIT.</p>
          <ul class="ia-sugestoes">${SUGESTOES.map((s, n) => `<li><button type="button" data-sugestao="${n}"><strong>${esc(s.titulo)}</strong><span>${esc(s.texto)}</span></button></li>`).join('')}</ul>
        </section>
        <ol class="ia-mensagens" id="ia-mensagens" aria-live="polite" aria-relevant="additions text"></ol>
      </div>
      <form class="ia-compositor" id="ia-form" autocomplete="off">
        <div class="ia-campo">
          <label for="ia-texto" class="so-leitor-tela">Mensagem para o assistente</label>
          <textarea id="ia-texto" rows="1" maxlength="${MAX_CARACTERES}" placeholder="Pergunte ou peça um texto..."></textarea>
          <button type="submit" class="ia-enviar" id="ia-enviar" aria-label="Enviar" title="Enviar (Enter)">${icone('enviado')}</button>
          <button type="button" class="ia-enviar ia-parar" id="ia-parar" hidden aria-label="Parar a resposta" title="Parar">${icone('parar')}</button>
        </div>
        <p class="ia-rodape"><span id="ia-contador"></span><span>Pode errar. Confira antes de enviar a um cliente.<span class="ia-dica-teclado"> <kbd>Enter</kbd> envia · <kbd>Shift</kbd>+<kbd>Enter</kbd> quebra a linha</span></span></p>
      </form>`;
    document.body.appendChild(dlg);

    const texto = dlg.querySelector('#ia-texto');
    const altura = () => { texto.style.height = 'auto'; texto.style.height = Math.min(texto.scrollHeight, 200) + 'px'; };
    const contar = () => {
      const n = texto.value.length;
      const c = dlg.querySelector('#ia-contador');
      c.textContent = n > MAX_CARACTERES * 0.8 ? `${n} / ${MAX_CARACTERES}` : '';
      dlg.querySelector('#ia-enviar').disabled = !texto.value.trim() || Boolean(est.gerando);
    };
    texto.addEventListener('input', () => { altura(); contar(); });
    texto.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); dlg.querySelector('#ia-form').requestSubmit(); }
    });
    dlg.querySelector('#ia-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const t = texto.value.trim();
      if (!t || est.gerando) return;
      texto.value = ''; altura(); contar();
      perguntar(t);
    });
    dlg.querySelector('#ia-parar').addEventListener('click', () => { if (est.gerando) est.gerando.abort(); });
    dlg.querySelector('#ia-nova').addEventListener('click', () => {
      if (est.gerando) est.gerando.abort();
      est.mensagens = []; salvar(); render();
      texto.focus();
    });
    dlg.querySelector('[data-fechar]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) { dlg.close(); return; }
      const s = e.target.closest('[data-sugestao]');
      if (s) { texto.value = SUGESTOES[Number(s.dataset.sugestao)].texto; altura(); contar(); texto.focus(); texto.setSelectionRange(texto.value.length, texto.value.length); return; }
      const cp = e.target.closest('[data-copiar]');
      if (cp) { copiar(est.mensagens[Number(cp.dataset.copiar)].texto, cp); return; }
      const cc = e.target.closest('[data-copiar-codigo]');
      if (cc) { copiar(cc.closest('.ia-codigo').querySelector('code').textContent, cc); return; }
      if (e.target.closest('[data-tentar]')) tentarDeNovo();
    });
    dlg.addEventListener('close', () => {
      document.documentElement.classList.remove('ia-aberto');
      if (est.voltarFoco && document.contains(est.voltarFoco)) est.voltarFoco.focus();
    });
    return dlg;
  }
  const primeiroNome = () => String((est.perfil && est.perfil.nome) || '').trim().split(/\s+/)[0] || 'equipe';
  const dlgEl = () => document.getElementById('dlg-assistente') || montarDialogo();

  async function copiar(t, botao) {
    try {
      await navigator.clipboard.writeText(t || '');
      const antes = botao.innerHTML;
      botao.innerHTML = botao.matches('[data-copiar-codigo]') ? 'Copiado' : `${icone('ok')}<span>Copiado</span>`;
      setTimeout(() => { botao.innerHTML = antes; }, 1500);
    } catch (_) { toast('Não foi possível copiar.', 'erro'); }
  }

  function mensagemHtml(m, n) {
    if (m.papel === 'user') return `<li class="ia-msg" data-papel="user"><div class="ia-balao">${esc(m.texto).replace(/\n/g, '<br>')}</div></li>`;
    const ultima = n === est.mensagens.length - 1;
    const gerando = ultima && est.gerando;
    const corpo = m.erro
      ? `<p class="ia-erro" role="alert">${icone('alerta')} ${esc(m.erro)}</p>`
      : (m.texto ? markdown(m.texto) : '') + (gerando ? '<span class="ia-cursor" aria-hidden="true"></span>' : '') + (!m.texto && gerando ? '<span class="ia-pensando">Pensando</span>' : '');
    const acoes = gerando ? '' : `<div class="ia-msg-acoes">
        ${m.texto && !m.erro ? `<button type="button" data-copiar="${n}">${icone('copiar')}<span>Copiar</span></button>` : ''}
        ${ultima && (m.erro || m.interrompida) ? `<button type="button" data-tentar>${icone('recarregar')}<span>Tentar novamente</span></button>` : ''}
        ${m.interrompida ? '<small>Resposta interrompida.</small>' : ''}
        ${m.limite ? '<small>A resposta chegou ao tamanho máximo. Peça "continue" para seguir.</small>' : ''}
      </div>`;
    const base = m.base && m.base.length ? `<details class="ia-base"><summary>${icone('descricao')} Base usada (${m.base.length})</summary><ul>${m.base.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></details>` : '';
    return `<li class="ia-msg" data-papel="assistente"><span class="ia-marca ia-marca-mini" aria-hidden="true">${icone('ia')}</span>
      <div class="ia-resposta"${gerando ? ' aria-busy="true"' : ''}>${corpo}${base}${acoes}</div></li>`;
  }

  let agendado = false;
  function render() {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => {
      agendado = false;
      const dlg = dlgEl();
      const rol = dlg.querySelector('#ia-rolagem');
      const noFim = rol.scrollHeight - rol.scrollTop - rol.clientHeight < 80;
      dlg.querySelector('#ia-boas-vindas').hidden = est.mensagens.length > 0;
      dlg.querySelector('#ia-mensagens').innerHTML = est.mensagens.map(mensagemHtml).join('');
      dlg.querySelector('#ia-enviar').hidden = Boolean(est.gerando);
      dlg.querySelector('#ia-parar').hidden = !est.gerando;
      dlg.querySelector('#ia-enviar').disabled = !dlg.querySelector('#ia-texto').value.trim() || Boolean(est.gerando);
      if (noFim || est.rolarFim) { rol.scrollTop = rol.scrollHeight; est.rolarFim = false; }
    });
  }

  // ---------------------------------------------------------------
  // Conversa com o servidor (streaming NDJSON)
  // ---------------------------------------------------------------
  async function perguntar(t) {
    est.mensagens.push({ papel: 'user', texto: t });
    await responder();
  }
  async function tentarDeNovo() {
    const ultima = est.mensagens[est.mensagens.length - 1];
    if (ultima && ultima.papel === 'assistente') est.mensagens.pop();
    if (!est.mensagens.length || est.mensagens[est.mensagens.length - 1].papel !== 'user') return;
    await responder();
  }
  async function responder() {
    const historico = est.mensagens.filter((m) => !m.erro && m.texto).map((m) => ({ papel: m.papel, texto: m.texto }));
    const resp = { papel: 'assistente', texto: '' };
    est.mensagens.push(resp);
    const controle = new AbortController();
    est.gerando = controle;
    est.rolarFim = true;
    render();
    try {
      const sessao = await getSessao();
      if (!sessao) throw new Error('Sua sessão expirou. Entre novamente.');
      const r = await fetch('/api/mensagens-ia?modo=assistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sessao.access_token },
        body: JSON.stringify({ mensagens: historico }),
        signal: controle.signal
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.erro || 'O assistente não respondeu agora. Tente de novo.');
      }
      const leitor = r.body.getReader();
      const dec = new TextDecoder();
      let resto = '';
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        resto += dec.decode(value, { stream: true });
        const linhas = resto.split('\n');
        resto = linhas.pop();
        for (const l of linhas) {
          if (!l.trim()) continue;
          let ev;
          try { ev = JSON.parse(l); } catch (_) { continue; }
          if (ev.t === 'inicio') resp.base = ev.base || [];
          else if (ev.t === 'd') { resp.texto += ev.c; render(); }
          else if (ev.t === 'fim') { if (ev.motivo === 'limite') resp.limite = true; }
          else if (ev.t === 'erro') { if (resp.texto) resp.interrompida = true; else resp.erro = ev.erro; }
        }
      }
      if (!resp.texto && !resp.erro) resp.erro = 'O assistente não devolveu texto. Tente de novo.';
    } catch (e) {
      if (e.name === 'AbortError') { resp.interrompida = true; if (!resp.texto) resp.erro = 'Você parou a resposta.'; }
      else if (resp.texto) resp.interrompida = true;
      else resp.erro = /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Sem conexão. Verifique sua internet e tente de novo.' : e.message;
    } finally {
      est.gerando = null;
      salvar();
      render();
      if (dlgEl().open && !window.matchMedia('(pointer: coarse)').matches) dlgEl().querySelector('#ia-texto').focus({ preventScroll: true });
    }
  }

  // ---------------------------------------------------------------
  // Abrir / botão fixo
  // ---------------------------------------------------------------
  function abrir() {
    const dlg = dlgEl();
    if (dlg.open) return;
    est.voltarFoco = document.activeElement;
    render();
    dlg.showModal();
    document.documentElement.classList.add('ia-aberto');
    est.rolarFim = true;
    render();
    if (!window.matchMedia('(pointer: coarse)').matches) dlg.querySelector('#ia-texto').focus();
  }

  window.AssistenteIA = {
    montar(perfil) {
      if (!perfil || perfil.role !== 'admin') return; // botão só para admin (o servidor também bloqueia)
      est.perfil = perfil;
      if (est.montado) return;
      est.montado = true;
      carregar();
      const fab = document.createElement('button');
      fab.type = 'button';
      fab.id = 'ia-fab';
      fab.className = 'ia-fab';
      fab.setAttribute('aria-haspopup', 'dialog');
      fab.setAttribute('aria-label', 'Abrir o Assistente IA');
      fab.title = 'Assistente IA';
      fab.innerHTML = `${icone('ia')}<span>Assistente</span>`;
      fab.addEventListener('click', abrir);
      document.body.appendChild(fab);
      document.addEventListener('click', (e) => { if (e.target.closest('[data-abrir-assistente]')) abrir(); });
      document.querySelectorAll('[data-abrir-assistente]').forEach((b) => { b.hidden = false; });
    },
    abrir,
    _markdown: markdown
  };
})();
