// jornada.js — Jornada MVP. Cliente: responde os módulos e envia para revisão.
// Equipe (admin): lista as jornadas, lê as respostas, aprova ou pede ajustes.
// No fim, o orçamento do MVP (escopo lido pela IA, valores calculados no servidor).
// A trilha (módulos e perguntas) vem de /api/jornada: a fonte é lib/jornada.js.
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;
  const admin = ehAdmin(perfil);
  const raiz = document.getElementById('jornada');
  const idDaUrl = new URLSearchParams(window.location.search).get('id');
  const ORCAMENTO = 'orcamento';

  const ROTULO = { aberto: 'Em preenchimento', enviado: 'Em revisão', ajustes: 'Ajustes pedidos', aprovado: 'Aprovado' };
  const TOM = { aberto: 'neutro', enviado: 'info', ajustes: 'atencao', aprovado: 'ok' };
  const COMPLEXIDADE = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };

  let E = null;          // { definicao, jornada, modulos, orcamento, cliente }
  let selecionado = null; // id do módulo aberto ou ORCAMENTO

  if (admin) document.getElementById('jm-subtitulo').textContent = 'Acompanhe as respostas dos clientes, aprove ou peça ajustes em cada módulo e gere o orçamento do MVP.';

  const def = (id) => E.definicao.find((m) => m.id === id);
  const linha = (id) => E.modulos.find((m) => m.modulo === id);
  const respondida = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v));
  const aprovados = () => E.modulos.filter((m) => m.status === 'aprovado').length;
  const editavel = (l) => !admin && (l.status === 'aberto' || l.status === 'ajustes');

  async function pedir(corpo) {
    const dados = await api('jornada', corpo);
    E = { ...E, ...dados };
    return dados;
  }

  // ------------------------------------------------------------------ entrada
  async function carregar() {
    try {
      E = await api('jornada' + (admin && idDaUrl ? '?id=' + encodeURIComponent(idDaUrl) : ''), null, 'GET');
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
      const feitas = m.etapas.filter((e) => respondida(l.respostas[e.id])).length;
      const nota = l.status === 'aberto' ? `${feitas} de ${m.etapas.length}` : ROTULO[l.status];
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
  function campoHtml(e, valor, pode) {
    const trava = pode ? '' : ' disabled';
    if (e.tipo === 'multipla' || e.tipo === 'unica') {
      const marcados = e.tipo === 'multipla' ? (valor || []) : [valor];
      return `<div class="jm-opcoes" role="group" aria-labelledby="jm-p-${e.id}">${e.opcoes.map((o) => `
        <label><input type="${e.tipo === 'multipla' ? 'checkbox' : 'radio'}" name="${e.id}" value="${o.id}"${marcados.includes(o.id) ? ' checked' : ''}${trava}> <span>${esc(o.nome)}</span></label>`).join('')}</div>`;
    }
    if (!pode) return valor ? `<p class="jm-resposta">${esc(valor)}</p>` : '<p class="jm-resposta" data-vazia>Sem resposta.</p>';
    return `<textarea name="${e.id}" rows="4" maxlength="1500" aria-labelledby="jm-p-${e.id}"${e.dica ? ` aria-describedby="jm-d-${e.id}"` : ''}>${esc(valor || '')}</textarea>`;
  }

  function desenharModulo() {
    const m = def(selecionado);
    const l = linha(m.id);
    const pode = editavel(l);
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
        <div class="jm-etapa" data-etapa="${e.id}"${respondida(l.respostas[e.id]) ? ' data-ok' : ''}>
          <span class="jm-num" aria-hidden="true">${i + 1}</span>
          <div>
            <h3>${esc(e.titulo)}${e.opcional ? ' <small>(opcional)</small>' : ''}</h3>
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
      if (e.tipo === 'multipla') r[e.id] = [...form.querySelectorAll(`input[name="${e.id}"]:checked`)].map((i) => i.value);
      else if (e.tipo === 'unica') r[e.id] = (form.querySelector(`input[name="${e.id}"]:checked`) || {}).value || '';
      else r[e.id] = form.elements[e.id].value.trim();
    }
    return r;
  }
  function marcarEtapas(form, m) {
    const r = lerForm(form, m);
    form.querySelectorAll('.jm-etapa').forEach((el) => el.toggleAttribute('data-ok', respondida(r[el.dataset.etapa])));
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
        await api('jornada', { acao: 'salvar', jornada_id: E.jornada.id, modulo: m.id, respostas });
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
    if (no && l.status === 'aberto') no.textContent = m.etapas.filter((e) => respondida(l.respostas[e.id])).length + ' de ' + m.etapas.length;
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
