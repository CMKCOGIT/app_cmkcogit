// =====================================================================
// admin.js — Solicitações (admin): lista com filtros e contagem por status.
// Cada card abre o modal de itens e valor (js/editor-solicitacao.js, o mesmo
// editor que aparece embutido na página da solicitação).
// Todo valor é recalculado no servidor (/api/admin-solicitacao); o navegador
// só mostra o rascunho. O banco também bloqueia quem não é admin.
// =====================================================================
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;

  const lista = document.getElementById('lista-admin');
  const pilulas = [...document.querySelectorAll('#filtro > [data-status]')];
  const busca = document.getElementById('busca');
  const periodo = document.getElementById('periodo');
  const params = new URLSearchParams(window.location.search);
  const filtro = { value: pilulas.some((b) => b.dataset.status === params.get('filtro')) ? params.get('filtro') : 'em_validacao' };
  busca.value = params.get('busca') || '';
  if (busca.value) filtro.value = params.get('filtro') || 'todas';

  const LIMITE_LISTA = 100;
  let solicitacoes = [];

  const marcarPilulas = () => pilulas.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === filtro.value)));
  marcarPilulas();
  pilulas.forEach((b) => b.addEventListener('click', () => { filtro.value = b.dataset.status; marcarPilulas(); carregar(); }));
  busca.addEventListener('input', render);
  periodo.addEventListener('change', carregar); // período filtrado no banco (não só nas 100 mais recentes)
  document.getElementById('barra-admin').addEventListener('submit', (e) => e.preventDefault());
  document.getElementById('btn-recarregar').addEventListener('click', () => { carregar(); contarPorStatus(); });
  lista.addEventListener('click', aoClicarNaLista);
  // modal de itens e valor (js/editor-solicitacao.js, o mesmo da página da solicitação)
  const editor = criarEditorSolicitacao({
    perfil,
    raiz: document.getElementById('modal-solicitacao'),
    corpo: document.getElementById('modal-sol-corpo'),
    rodape: document.getElementById('modal-sol-rodape'),
    titulo: document.getElementById('modal-sol-titulo'),
    subtitulo: document.getElementById('modal-sol-sub'),
    aoFechar: async (mudou) => { if (mudou) await carregar(); }
  });
  const abrir = (id, gatilho) => editor.abrir(solicitacoes.find((x) => x.id === id), gatilho);
  await Promise.all([carregar(), contarPorStatus()]);
  // admin-solicitacao.html "Editar itens e valor" abre o modal direto (?editar=<id>)
  const editar = params.get('editar');
  if (editar && /^[0-9a-f-]{36}$/i.test(editar)) {
    if (!solicitacoes.some((x) => x.id === editar)) {
      const { data } = await db.from('solicitacoes')
        .select('*, cliente:profiles!solicitacoes_cliente_id_fkey(nome, email, telefone), pagamentos(id, status, valor, metodo, pago_em, mp_ultimo_status)')
        .eq('id', editar).maybeSingle();
      if (data) { solicitacoes.unshift(data); render(); }
    }
    abrir(editar, null);
  }

  // =================================================================
  // Lista
  // =================================================================
  async function carregar() {
    mostrarErro('');
    if (!solicitacoes.length) lista.innerHTML = '<article data-esqueleto></article><article data-esqueleto></article>';
    lista.setAttribute('aria-busy', 'true');
    let q = db
      .from('solicitacoes')
      .select('*, cliente:profiles!solicitacoes_cliente_id_fkey(nome, email, telefone), pagamentos(id, status, valor, metodo, pago_em, mp_ultimo_status)')
      .order('created_at', { ascending: false })
      .limit(LIMITE_LISTA);
    if (filtro.value !== 'todas') q = q.eq('status', filtro.value);
    const dias = Number(periodo.value);
    if (dias) q = q.gte('created_at', new Date(Date.now() - dias * 86400000).toISOString());
    const { data, error } = await q;
    lista.removeAttribute('aria-busy');
    if (error) {
      mostrarErro('Não foi possível carregar: ' + error.message);
      lista.innerHTML = '';
      return;
    }
    solicitacoes = data || [];
    render();
  }

  function render() {
    const normal = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const q = normal(busca.value.trim());
    const dias = Number(periodo.value);
    const limite = dias ? Date.now() - dias * 86400000 : 0;
    const visiveis = solicitacoes.filter((s) => (!limite || new Date(s.created_at).getTime() >= limite)
      && (!q || [s.codigo, s.cliente && s.cliente.nome, s.cliente && s.cliente.email].some((t) => normal(t).includes(q))));
    const limiteAtingido = solicitacoes.length >= LIMITE_LISTA;
    document.getElementById('contagem').textContent = solicitacoes.length
      ? `${visiveis.length} de ${solicitacoes.length} ${solicitacoes.length === 1 ? 'solicitação' : 'solicitações'} neste status`
        + (limiteAtingido ? ` (mostrando só as ${LIMITE_LISTA} mais recentes deste status)` : '') : '';
    if (!visiveis.length) {
      lista.innerHTML = `<p data-vazio>${solicitacoes.length ? 'Nada encontrado com essa busca ou período.' : 'Nenhuma solicitação neste filtro.'}</p>`;
      return;
    }
    lista.innerHTML = visiveis.map(cardHtml).join('');
  }

  // Painel lateral: quantas solicitações há em cada status (contagem no banco)
  async function contarPorStatus() {
    const ul = document.getElementById('contagem-status');
    const status = ['em_validacao', 'em_analise', 'ajustes_solicitados', 'aguardando_cliente', 'aguardando_pagamento', 'paga', 'cancelada'];
    const NOMES = { em_validacao: 'Aguardando análise', em_analise: 'Em análise', ajustes_solicitados: 'Ajustes solicitados', aguardando_cliente: 'Aguardando cliente', aguardando_pagamento: 'Pagamento liberado', paga: 'Pagas', cancelada: 'Canceladas' };
    const icones = { em_validacao: 'em-validacao', em_analise: 'em-validacao', ajustes_solicitados: 'editar', aguardando_cliente: 'clientes', aguardando_pagamento: 'pagamentos', paga: 'aprovar', cancelada: 'cancelado' };
    const res = await Promise.all(status.map((st) => db.from('solicitacoes').select('id', { count: 'exact', head: true }).eq('status', st)));
    ul.innerHTML = status.map((st, i) => `<li><button type="button" class="widget-item" data-ir-status="${st}">${icone(icones[st])}
      <span><strong>${esc(NOMES[st])}</strong></span><span class="widget-valor">${res[i].error ? '—' : Number(res[i].count) || 0}</span></button></li>`).join('');
    ul.querySelectorAll('[data-ir-status]').forEach((b) => b.addEventListener('click', () => {
      filtro.value = b.dataset.irStatus; marcarPilulas(); carregar();
    }));
  }

  function cardHtml(s) {
    const c = s.cliente || {};
    const r = s.resumo || {};
    const itens = [...(r.itens || []), ...(r.mensais || []), ...(r.complementos || [])];
    const editavel = solicitacaoEditavel(s);
    const acao = editavel ? 'Itens e valor' : 'Ver itens';
    const sel = s.selecao || {};
    const pers = 'personalizacao' in sel ? `<span data-etiqueta="${sel.personalizacao ? 'ok' : 'neutro'}">${sel.personalizacao ? 'Site personalizado' : 'Sem personalização'}</span>` : '';
    return `
      <article data-solicitacao="${esc(s.id)}">
        <header>
          <h2>${esc(s.codigo)}</h2>
          ${etiquetaSolicitacaoAdmin(s)}
          <span data-etiqueta="neutro">${s.estruturado ? 'Preço fechado' : 'Sob medida'}</span>
          ${pers}
          <span data-valores>
            <small>Estimativa</small> <strong>${s.tipo_preco === 'from' ? 'a partir de ' : ''}${brl(s.valor_calculado)}</strong>
            <small>· Final</small> <strong>${s.valor_final != null ? brl(s.valor_final) : '—'}</strong>
          </span>
        </header>
        <p data-cliente-sol><strong>${esc(c.nome || '-')}</strong> · ${esc(c.email || '-')}${c.telefone ? ' · ' + esc(formatarTelefone(c.telefone)) : ''}
          <small>· ${s.origem === 'diagnostico' ? 'Diagnóstico da home' : 'Monte sua solução'} · ${fmtDataHora(s.created_at)}</small></p>
        <ul data-chips-itens aria-label="Itens">
          ${itens.slice(0, 6).map((i) => `<li${i.adicionado === 'equipe' ? ' data-equipe' : ''}>${esc(i.nome)}</li>`).join('')}
          ${itens.length > 6 ? `<li data-mais>+${itens.length - 6}</li>` : ''}
        </ul>
        ${s.status === 'cancelada' && s.motivo_cancelamento ? `<p data-motivo><small>Motivo do cancelamento:</small> ${esc(s.motivo_cancelamento)}</p>` : ''}
        <p data-acoes-card>
          <a class="botao-link" href="admin-solicitacao.html?id=${encodeURIComponent(s.id)}">${s.status === 'em_validacao' ? 'Analisar projeto' : 'Abrir projeto'}</a>
          <button type="button" data-abrir="${esc(s.id)}">${acao}</button>
          ${s.comprovante_token ? `<button type="button" data-reenviar="${esc(s.id)}">${icone('whatsapp')} Reenviar comprovante</button>
            <a href="comprovante.html?t=${encodeURIComponent(s.comprovante_token)}" target="_blank" rel="noopener">${icone('comprovante')} Ver comprovante</a>` : ''}
          ${s.aprovado_em ? `<small>Aprovada em ${fmtDataHora(s.aprovado_em)}${s.comprovante && s.comprovante.aprovado_por ? ' por ' + esc(s.comprovante.aprovado_por) : ''}</small>` : ''}
        </p>
      </article>`;
  }


  function aoClicarNaLista(e) {
    const reenviarBtn = e.target.closest('[data-reenviar]');
    if (reenviarBtn) return editor.reenviar(reenviarBtn.dataset.reenviar, reenviarBtn);
    const abrirBtn = e.target.closest('[data-abrir]');
    if (abrirBtn) return abrir(abrirBtn.dataset.abrir, abrirBtn);
    if (e.target.closest('a, button, input, select, textarea, summary')) return;
    const card = e.target.closest('article[data-solicitacao]');
    if (card) abrir(card.dataset.solicitacao, card.querySelector('[data-abrir]'));
  }

})();
