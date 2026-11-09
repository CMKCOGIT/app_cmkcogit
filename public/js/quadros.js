// quadros.js — Quadros de tarefas da equipe, estilo Trello (sql/27_quadros.sql). Só admin.
//   · Seletor de quadro: por projeto (criado sozinho), por empresa ou tema interno
//   · Visões: Quadro (kanban com arrastar e soltar), Lista (tabela ordenável), Minhas tarefas
//   · Cartão completo: descrição, responsáveis, etiquetas, datas, prioridade, capa, checklists,
//     anexos, comentários, histórico, ligação com cliente/projeto, mover, duplicar, arquivar
//   · Filtros (responsável, prazo, prioridade, etiqueta) e busca; tempo real entre admins
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;
  const $ = (id) => document.getElementById(id);

  const CORES = { azul: '#1A2C52', ceu: '#8EA6D8', verde: '#1E7A4C', amarelo: '#D9A21B', laranja: '#C2410C', vermelho: '#B42318', roxo: '#6B46C1', cinza: '#8A8D91', grafite: '#2A2D30' };
  const NOME_COR = { azul: 'Marinho', ceu: 'Céu', verde: 'Verde', amarelo: 'Amarelo', laranja: 'Laranja', vermelho: 'Vermelho', roxo: 'Roxo', cinza: 'Cinza', grafite: 'Grafite' };
  const CLARAS = new Set(['ceu', 'amarelo']);
  const PRIORIDADES = { urgente: 'Urgente', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
  const ORDEM_PRIO = { urgente: 0, alta: 1, media: 2, baixa: 3 };
  const TIPO_QUADRO = { projeto: 'Projeto', empresa: 'Empresa', interno: 'Tema interno' };
  const BUCKET = 'quadros';
  const LIMITE_ARQUIVO = 25 * 1024 * 1024;
  const TOQUE = window.matchMedia('(pointer: coarse)').matches;
  const CAMPOS_CARTAO = 'id, quadro_id, lista_id, titulo, descricao, posicao, prioridade, inicio, prazo, concluido_em, capa_cor, cliente_id, projeto_id, arquivado_em, created_at, cartao_responsaveis(usuario_id), cartao_etiquetas(etiqueta_id), cartao_checklists(cartao_checklist_itens(feito)), cartao_comentarios(count), cartao_anexos(count)';

  const est = {
    quadros: [], quadro: null, listas: [], cartoes: [], etiquetas: [], admins: [], clientes: null, projetos: null, empresas: [],
    visao: 'quadro', busca: '', filtros: { resp: new Set(), prazo: new Set(), prio: new Set(), etq: new Set() },
    ordem: { campo: 'prazo', dir: 1 }, arrastando: false, canal: null, cartao: null, ctx: null
  };
  const params = new URLSearchParams(location.search);

  // ---------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------
  const corHex = (c) => CORES[c] || (/^#[0-9a-f]{6}$/i.test(c || '') ? c : CORES.azul);
  const nomeDe = (id) => { const a = est.admins.find((x) => x.id === id); return a ? (a.nome || a.email) : 'Alguém'; };
  const avatar = (id, extra = '') => `<span class="avatar qd-avatar ${extra}" title="${esc(nomeDe(id))}" aria-label="${esc(nomeDe(id))}">${esc(iniciais(nomeDe(id)))}</span>`;
  const hojeLocal = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  function estadoPrazo(c) {
    if (!c.prazo) return null;
    if (c.concluido_em) return 'feito';
    const p = new Date(c.prazo);
    const agora = new Date();
    if (p < agora) return 'atrasado';
    const h = hojeLocal();
    const amanha = new Date(h); amanha.setDate(h.getDate() + 1);
    if (p < amanha) return 'hoje';
    const semana = new Date(h); semana.setDate(h.getDate() + 3);
    return p < semana ? 'breve' : 'ok';
  }
  function textoPrazo(d, comHora = true) {
    const x = new Date(d);
    const dia = x.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
    const hora = x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return comHora && hora !== '23:59' ? dia + ', ' + hora : dia;
  }
  function formatar(t) {
    let h = esc(t || '');
    h = h.replace(/(^|[\s(>])\*([^*\n]+?)\*(?=$|[\s).,!?:;<])/g, '$1<strong>$2</strong>')
      .replace(/(^|[\s(>])_([^_\n]+?)_(?=$|[\s).,!?:;<])/g, '$1<em>$2</em>')
      .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
    // listas simples: linhas que começam com "- " ou "1. "
    return h.split('\n').map((l) => (/^\s*[-•]\s+/.test(l) ? '<span class="qd-li">' + l.replace(/^\s*[-•]\s+/, '') + '</span>'
      : /^\s*\d+[.)]\s+/.test(l) ? '<span class="qd-li qd-li-num">' + l + '</span>' : l)).join('<br>').replace(/<\/span><br>/g, '</span>');
  }
  const tamanho = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  function posicaoEntre(antes, depois) {
    if (antes == null && depois == null) return 1000;
    if (antes == null) return depois / 2;
    if (depois == null) return antes + 1000;
    return (antes + depois) / 2;
  }
  function erroBanco(e, acao) {
    const m = e && e.message ? e.message : String(e);
    toast(`Não foi possível ${acao}: ${m}`, 'erro');
  }
  function fecharPopovers(exceto) {
    document.querySelectorAll('.qd-popover:not([hidden]), .qd-painel-quadros:not([hidden]), .qd-menu-lista:not([hidden])').forEach((p) => {
      if (p === exceto || (exceto && p.contains(exceto))) return;
      p.hidden = true;
      document.querySelector(`[aria-controls="${p.id}"]`)?.setAttribute('aria-expanded', 'false');
    });
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('dialog, .qd-popover, [aria-controls], .qd-menu-lista, .qd-lista-mais')) fecharPopovers();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) fecharPopovers(); });
  function alternar(botao, painel) {
    const abrir = painel.hidden;
    fecharPopovers();
    painel.hidden = !abrir;
    botao.setAttribute('aria-expanded', String(abrir));
    if (abrir) painel.querySelector('input, button, a')?.focus();
  }
  function paleta(caixa, atual, nome) {
    caixa.innerHTML = Object.keys(CORES).map((c) => `<label class="qd-cor-opcao" title="${NOME_COR[c]}">
      <input type="radio" name="${nome}" value="${c}"${c === atual ? ' checked' : ''}><span style="--cor:${CORES[c]}"></span><span class="so-leitor-tela">${NOME_COR[c]}</span></label>`).join('');
  }
  function corEscolhida(caixa) { return (caixa.querySelector('input:checked') || {}).value || 'azul'; }
  function ligarDialogo(dlg) {
    dlg.querySelector('[data-fechar]')?.addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }

  // ---------------------------------------------------------------
  // Carregar quadros e pessoas
  // ---------------------------------------------------------------
  async function carregarQuadros() {
    const { data, error } = await db.from('quadros')
      .select('*, projeto:projetos(id, codigo, nome, status_projeto, cliente_id), empresa:empresas(id, nome, cor), cartoes(count)')
      .is('arquivado_em', null).is('cartoes.concluido_em', null).is('cartoes.arquivado_em', null)
      .order('fixado', { ascending: false }).order('nome');
    if (error) {
      mostrarErro(/quadros|schema cache|relation/i.test(error.message) ? 'Os quadros ainda não estão ativos no banco (rode o sql/27_quadros.sql).' : 'Não foi possível carregar os quadros: ' + error.message);
      return false;
    }
    est.quadros = data || [];
    renderListaQuadros();
    return true;
  }
  async function carregarAdmins() {
    const { data } = await db.from('profiles').select('id, nome, email').eq('role', 'admin').order('nome');
    est.admins = data || [];
    $('avatar-eu').textContent = iniciais(perfil.nome || perfil.email);
  }
  let promessaClientes = null;
  function carregarClientesProjetos() {
    if (est.clientes) return Promise.resolve();
    if (!promessaClientes) promessaClientes = buscarClientesProjetos().finally(() => { promessaClientes = null; });
    return promessaClientes;
  }
  async function buscarClientesProjetos() {
    const [c, p] = await Promise.all([
      db.from('profiles').select('id, nome, email, empresa_id').neq('role', 'admin').order('nome'),
      db.from('projetos').select('id, codigo, nome, cliente_id, empresa_id, status_projeto').order('created_at', { ascending: false })
    ]);
    est.clientes = c.data || [];
    est.projetos = p.data || [];
  }
  async function carregarEmpresas() {
    const { data } = await db.from('empresas').select('*').order('nome');
    est.empresas = data || [];
  }

  // ---------------------------------------------------------------
  // Seletor de quadros
  // ---------------------------------------------------------------
  function nomeQuadro(q) { return q.nome; }
  function renderListaQuadros() {
    const n = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const busca = n($('busca-quadros').value);
    const casa = (q) => !busca || n(q.nome + ' ' + (q.empresa ? q.empresa.nome : '') + ' ' + (q.projeto ? q.projeto.codigo + ' ' + q.projeto.nome : '')).includes(busca);
    const grupos = [
      ['Fixados', est.quadros.filter((q) => q.fixado && casa(q))],
      ['Temas internos', est.quadros.filter((q) => !q.fixado && q.tipo === 'interno' && casa(q))],
      ['Empresas', est.quadros.filter((q) => !q.fixado && q.tipo === 'empresa' && casa(q))],
      ['Projetos', est.quadros.filter((q) => !q.fixado && q.tipo === 'projeto' && casa(q))]
    ].filter(([, l]) => l.length);
    $('lista-quadros').innerHTML = grupos.length ? grupos.map(([t, l]) => `<p class="qd-grupo-quadros">${esc(t)}</p>
      <ul>${l.map((q) => {
        const abertos = (q.cartoes && q.cartoes[0] && q.cartoes[0].count) || 0;
        return `<li><button type="button" data-quadro="${esc(q.id)}"${est.quadro && est.quadro.id === q.id ? ' aria-current="true"' : ''}>
          <span class="qd-cor" style="--cor:${corHex(q.cor)}" aria-hidden="true"></span>
          <span class="qd-quadro-item"><strong>${esc(nomeQuadro(q))}</strong><small>${esc(TIPO_QUADRO[q.tipo])}${q.empresa && q.tipo !== 'empresa' ? ' · ' + esc(q.empresa.nome) : ''}</small></span>
          ${abertos ? `<span class="qd-quadro-cont" aria-label="${abertos} cartões abertos">${abertos}</span>` : ''}
          ${q.fixado ? icone('fixado', 'qd-fixado') : ''}</button></li>`;
      }).join('')}</ul>`).join('') : '<p class="qd-vazio-mini">Nenhum quadro encontrado.</p>';
  }
  $('btn-quadros').addEventListener('click', () => { alternar($('btn-quadros'), $('painel-quadros')); if (!$('painel-quadros').hidden) { $('busca-quadros').value = ''; renderListaQuadros(); $('busca-quadros').focus(); } });
  $('busca-quadros').addEventListener('input', renderListaQuadros);
  $('busca-quadros').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('lista-quadros').querySelector('[data-quadro]')?.click(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); $('lista-quadros').querySelector('[data-quadro]')?.focus(); }
  });
  $('lista-quadros').addEventListener('click', (e) => {
    const b = e.target.closest('[data-quadro]');
    if (!b) return;
    fecharPopovers();
    abrirQuadro(b.dataset.quadro);
  });

  // ---------------------------------------------------------------
  // Abrir quadro
  // ---------------------------------------------------------------
  async function abrirQuadro(id, { manterCartao = false } = {}) {
    const q = est.quadros.find((x) => x.id === id) || est.quadros[0];
    if (!q) { renderSemQuadros(); return; }
    est.quadro = q;
    try { localStorage.setItem('cmk_quadro_atual', q.id); } catch (_) {}
    const p = new URLSearchParams(location.search);
    p.set('quadro', q.id);
    if (!manterCartao) p.delete('cartao');
    history.replaceState(null, '', location.pathname + '?' + p);
    document.title = q.nome + ' · Quadros | CMKCOGIT';
    $('qd-cor-atual').style.setProperty('--cor', corHex(q.cor));
    $('qd-nome-atual').textContent = q.nome;
    $('qd-tipo-atual').textContent = TIPO_QUADRO[q.tipo] + (q.empresa && q.tipo !== 'empresa' ? ' · ' + q.empresa.nome : '');
    const lp = $('link-projeto-quadro');
    lp.hidden = !q.projeto_id;
    if (q.projeto_id) lp.href = 'projeto.html?id=' + encodeURIComponent(q.projeto_id);
    document.querySelector('[data-q="fixar"] span').textContent = q.fixado ? 'Desafixar do topo' : 'Fixar no topo';
    renderListaQuadros();
    // troca de quadro: some o conteúdo do anterior na hora (nada de criar cartão na coluna errada)
    if (!est.quadroCarregado || est.quadroCarregado !== q.id) {
      est.listas = []; est.cartoes = []; est.etiquetas = [];
      $('qd-kanban').setAttribute('aria-busy', 'true');
      $('qd-kanban').innerHTML = '<div class="qd-lista" data-esqueleto></div><div class="qd-lista" data-esqueleto></div><div class="qd-lista" data-esqueleto></div>';
      $('qd-tabela').innerHTML = ''; $('qd-resumo').innerHTML = '';
    }
    await carregarQuadro();
    ouvirQuadro();
  }

  async function carregarQuadro() {
    const q = est.quadro;
    const [l, c, e] = await Promise.all([
      db.from('quadro_listas').select('*').eq('quadro_id', q.id).is('arquivada_em', null).order('posicao'),
      db.from('cartoes').select(CAMPOS_CARTAO).eq('quadro_id', q.id).is('arquivado_em', null).order('posicao'),
      db.from('quadro_etiquetas').select('*').eq('quadro_id', q.id).order('created_at')
    ]);
    if (est.quadro !== q) return;
    if (l.error || c.error || e.error) { mostrarErro('Não foi possível carregar o quadro: ' + (l.error || c.error || e.error).message); return; }
    mostrarErro('');
    est.quadroCarregado = q.id;
    est.listas = l.data;
    est.cartoes = c.data;
    est.etiquetas = e.data;
    renderFiltros();
    render();
  }

  function renderSemQuadros() {
    $('qd-nome-atual').textContent = 'Nenhum quadro';
    $('qd-kanban').removeAttribute('aria-busy');
    $('qd-kanban').innerHTML = `<div class="qd-vazio"><p><strong>Nenhum quadro ainda.</strong> Crie o primeiro para organizar as tarefas da equipe.</p>
      <button type="button" data-primario id="btn-primeiro-quadro">Criar quadro</button></div>`;
    $('btn-primeiro-quadro').addEventListener('click', () => abrirDialogoQuadro());
  }

  // ---------------------------------------------------------------
  // Filtros e busca
  // ---------------------------------------------------------------
  function renderFiltros() {
    const marcado = (set, v) => (set.has(v) ? ' checked' : '');
    $('filtro-responsaveis').innerHTML = `<label><input type="checkbox" value="eu"${marcado(est.filtros.resp, 'eu')}> Atribuídos a mim</label>
      <label><input type="checkbox" value="ninguem"${marcado(est.filtros.resp, 'ninguem')}> Sem responsável</label>` +
      est.admins.filter((a) => a.id !== perfil.id).map((a) => `<label><input type="checkbox" value="${esc(a.id)}"${marcado(est.filtros.resp, a.id)}> ${esc(a.nome || a.email)}</label>`).join('');
    $('filtro-etiquetas').innerHTML = est.etiquetas.length ? est.etiquetas.map((t) => `<label><input type="checkbox" value="${esc(t.id)}"${marcado(est.filtros.etq, t.id)}>
      <span class="qd-etq" style="--etq:${corHex(t.cor)}"${CLARAS.has(t.cor) ? ' data-clara' : ''}>${esc(t.nome || NOME_COR[t.cor])}</span></label>`).join('') : '<small>Nenhuma etiqueta neste quadro.</small>';
    ['filtro-prazo', 'filtro-prioridade'].forEach((id) => $(id).querySelectorAll('input').forEach((i) => {
      i.checked = (id === 'filtro-prazo' ? est.filtros.prazo : est.filtros.prio).has(i.value);
    }));
  }
  $('painel-filtros').addEventListener('change', (e) => {
    const i = e.target;
    if (!i.matches('input[type=checkbox]')) return;
    const grupo = i.closest('#filtro-responsaveis') ? 'resp' : i.closest('#filtro-prazo') ? 'prazo' : i.closest('#filtro-prioridade') ? 'prio' : 'etq';
    if (i.checked) est.filtros[grupo].add(i.value); else est.filtros[grupo].delete(i.value);
    render();
  });
  $('btn-filtros').addEventListener('click', () => alternar($('btn-filtros'), $('painel-filtros')));
  $('btn-limpar-filtros').addEventListener('click', () => { Object.values(est.filtros).forEach((s) => s.clear()); renderFiltros(); render(); });
  let timerBusca = null;
  $('busca-cartoes').addEventListener('input', (e) => { clearTimeout(timerBusca); timerBusca = setTimeout(() => { est.busca = e.target.value; render(); }, 120); });
  const totalFiltros = () => Object.values(est.filtros).reduce((t, s) => t + s.size, 0) + (est.busca.trim() ? 1 : 0);

  function passaFiltro(c) {
    const f = est.filtros;
    const n = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (est.busca.trim() && !n(c.titulo + ' ' + (c.descricao || '')).includes(n(est.busca.trim()))) return false;
    const resp = (c.cartao_responsaveis || []).map((r) => r.usuario_id);
    if (f.resp.size && ![...f.resp].some((v) => (v === 'eu' ? resp.includes(perfil.id) : v === 'ninguem' ? !resp.length : resp.includes(v)))) return false;
    if (f.prio.size && !f.prio.has(c.prioridade)) return false;
    const etqs = (c.cartao_etiquetas || []).map((x) => x.etiqueta_id);
    if (f.etq.size && ![...f.etq].some((v) => etqs.includes(v))) return false;
    if (f.prazo.size) {
      const e = estadoPrazo(c);
      const semana = c.prazo && !c.concluido_em && new Date(c.prazo) - new Date() < 7 * 86400000 && new Date(c.prazo) > new Date();
      const ok = (f.prazo.has('atrasado') && e === 'atrasado') || (f.prazo.has('hoje') && e === 'hoje') || (f.prazo.has('semana') && semana)
        || (f.prazo.has('sem') && !c.prazo) || (f.prazo.has('concluido') && c.concluido_em);
      if (!ok) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------
  // Render geral
  // ---------------------------------------------------------------
  function render() {
    const n = totalFiltros();
    $('cont-filtros').hidden = !n;
    $('cont-filtros').textContent = n;
    $('btn-filtros').toggleAttribute('data-ativo', n > 0);
    renderResumo();
    $('qd-kanban').hidden = est.visao !== 'quadro';
    $('atalhos-listas').hidden = est.visao !== 'quadro';
    $('qd-tabela').hidden = est.visao !== 'lista';
    $('qd-minhas').hidden = est.visao !== 'minhas';
    $('qd-resumo').hidden = est.visao === 'minhas';
    document.querySelector('.qd-ferramentas').toggleAttribute('data-minhas', est.visao === 'minhas');
    if (est.visao === 'quadro') renderKanban();
    else if (est.visao === 'lista') renderTabela();
    else renderMinhas();
  }

  function renderResumo() {
    const abertos = est.cartoes.filter((c) => !c.concluido_em);
    const atrasados = abertos.filter((c) => estadoPrazo(c) === 'atrasado').length;
    const hoje = abertos.filter((c) => estadoPrazo(c) === 'hoje').length;
    const meus = abertos.filter((c) => (c.cartao_responsaveis || []).some((r) => r.usuario_id === perfil.id)).length;
    const pct = est.cartoes.length ? Math.round((est.cartoes.length - abertos.length) / est.cartoes.length * 100) : 0;
    const item = (rotulo, valor, filtro, tom) => `<li><button type="button"${filtro ? ` data-atalho-filtro="${filtro}"` : ' disabled'}${tom && valor ? ` data-tom="${tom}"` : ''}><strong>${valor}</strong><span>${rotulo}</span></button></li>`;
    $('qd-resumo').innerHTML = item('abertos', abertos.length, null) + item('atrasados', atrasados, 'atrasado', 'perigo')
      + item('vencem hoje', hoje, 'hoje', 'atencao') + item('comigo', meus, 'eu') + `<li class="qd-resumo-progresso"><span>${pct}% concluído</span><progress max="100" value="${pct}">${pct}%</progress></li>`;
  }
  $('qd-resumo').addEventListener('click', (e) => {
    const b = e.target.closest('[data-atalho-filtro]');
    if (!b) return;
    const v = b.dataset.atalhoFiltro;
    const grupo = v === 'eu' ? est.filtros.resp : est.filtros.prazo;
    if (grupo.has(v)) grupo.delete(v); else grupo.add(v);
    renderFiltros(); render();
  });

  // ---------------------------------------------------------------
  // Kanban
  // ---------------------------------------------------------------
  function cartaoHtml(c) {
    const etqs = (c.cartao_etiquetas || []).map((x) => est.etiquetas.find((t) => t.id === x.etiqueta_id)).filter(Boolean);
    const itens = (c.cartao_checklists || []).flatMap((k) => k.cartao_checklist_itens || []);
    const feitos = itens.filter((i) => i.feito).length;
    const coment = (c.cartao_comentarios && c.cartao_comentarios[0] && c.cartao_comentarios[0].count) || 0;
    const anexos = (c.cartao_anexos && c.cartao_anexos[0] && c.cartao_anexos[0].count) || 0;
    const ep = estadoPrazo(c);
    const resp = (c.cartao_responsaveis || []).map((r) => r.usuario_id);
    const rotuloPrazo = { atrasado: 'atrasado', hoje: 'vence hoje', breve: 'vence em breve', ok: '', feito: 'concluído' }[ep] || '';
    return `<li class="qd-cartao" data-cartao="${esc(c.id)}" tabindex="0" ${TOQUE ? '' : 'draggable="true"'}${c.concluido_em ? ' data-concluido' : ''}${c.prioridade ? ` data-prioridade="${c.prioridade}"` : ''}
        aria-label="${esc(c.titulo)}${rotuloPrazo ? ', ' + rotuloPrazo : ''}">
      ${c.capa_cor ? `<span class="qd-cartao-faixa-capa" style="--capa:${corHex(c.capa_cor)}" aria-hidden="true"></span>` : ''}
      ${etqs.length ? `<span class="qd-etiquetas">${etqs.map((t) => `<span class="qd-etq" style="--etq:${corHex(t.cor)}"${CLARAS.has(t.cor) ? ' data-clara' : ''} title="${esc(t.nome || NOME_COR[t.cor])}">${esc(t.nome)}</span>`).join('')}</span>` : ''}
      <span class="qd-cartao-titulo">${c.concluido_em ? icone('ok', 'qd-ok') : ''}${esc(c.titulo)}</span>
      <span class="qd-cartao-rodape">
        <span class="qd-badges">
          ${c.prioridade && c.prioridade !== 'baixa' ? `<span class="qd-badge" data-prio="${c.prioridade}" title="Prioridade ${esc(PRIORIDADES[c.prioridade])}">${icone('prioridade')}${esc(PRIORIDADES[c.prioridade])}</span>` : ''}
          ${c.prazo ? `<span class="qd-badge" data-prazo="${ep}" title="Prazo ${esc(fmtDataHora(c.prazo))}">${icone('prazo')}${esc(textoPrazo(c.prazo, false))}</span>` : ''}
          ${c.descricao ? `<span class="qd-badge" title="Tem descrição">${icone('descricao')}</span>` : ''}
          ${coment ? `<span class="qd-badge" title="${coment} comentários">${icone('comentario')}${coment}</span>` : ''}
          ${anexos ? `<span class="qd-badge" title="${anexos} anexos">${icone('anexo')}${anexos}</span>` : ''}
          ${itens.length ? `<span class="qd-badge"${feitos === itens.length ? ' data-completo' : ''} title="Checklist ${feitos} de ${itens.length}">${icone('checklist')}${feitos}/${itens.length}</span>` : ''}
        </span>
        ${resp.length ? `<span class="qd-avatares">${resp.slice(0, 3).map((id) => avatar(id)).join('')}${resp.length > 3 ? `<span class="avatar qd-avatar qd-avatar-mais">+${resp.length - 3}</span>` : ''}</span>` : ''}
      </span>
    </li>`;
  }

  function renderKanban() {
    const k = $('qd-kanban');
    k.removeAttribute('aria-busy');
    // o quadro se redesenha (tempo real, filtros): preserva o que a pessoa estava fazendo
    const formAberto = k.querySelector('.qd-form-cartao:not([hidden])');
    const guardado = {
      rolagemX: k.scrollLeft,
      rolagens: Object.fromEntries([...k.querySelectorAll('.qd-cartoes')].map((ol) => [ol.dataset.lista, ol.scrollTop])),
      form: formAberto ? { lista: formAberto.closest('.qd-lista').dataset.lista, valor: formAberto.querySelector('textarea').value, foco: document.activeElement === formAberto.querySelector('textarea') } : null,
      novaLista: $('form-nova-lista') && !$('form-nova-lista').hidden ? { valor: $('nome-nova-lista').value, foco: document.activeElement === $('nome-nova-lista') } : null
    };
    const filtrando = totalFiltros() > 0;
    k.innerHTML = est.listas.map((l) => {
      const todos = est.cartoes.filter((c) => c.lista_id === l.id).sort((a, b) => a.posicao - b.posicao);
      const visiveis = todos.filter(passaFiltro);
      const cheio = l.limite && todos.length > l.limite;
      return `<section class="qd-lista" data-lista="${esc(l.id)}" aria-labelledby="lista-${esc(l.id)}"${cheio ? ' data-cheia' : ''}>
        <header class="qd-lista-topo" ${TOQUE ? '' : 'draggable="true"'}>
          <h2 id="lista-${esc(l.id)}"><button type="button" class="qd-lista-nome" data-renomear-lista title="Renomear lista">${esc(l.nome)}</button></h2>
          ${l.conclui ? `<span class="qd-lista-conclui" title="Cartões aqui contam como concluídos">${icone('ok')}</span>` : ''}
          <span class="qd-lista-cont" title="${l.limite ? 'Limite de ' + l.limite + ' cartões' : ''}">${filtrando ? visiveis.length + '/' : ''}${todos.length}${l.limite ? ' de ' + l.limite : ''}</span>
          <div class="qd-lista-mais">
            <button type="button" class="acao-icone" data-menu-lista aria-label="Opções da lista ${esc(l.nome)}" aria-expanded="false">${icone('opcoes')}</button>
            <div class="qd-menu-lista qd-menu" role="menu" hidden>
              <button type="button" role="menuitem" data-l="adicionar">${icone('adicionar')} Adicionar cartão</button>
              <button type="button" role="menuitem" data-l="limite">${icone('filtros')} ${l.limite ? 'Mudar limite (' + l.limite + ')' : 'Definir limite de cartões'}</button>
              <button type="button" role="menuitem" data-l="conclui">${icone('ok')} ${l.conclui ? 'Não marcar como concluído' : 'Marcar cartões aqui como concluídos'}</button>
              <button type="button" role="menuitem" data-l="ordenar">${icone('prazo')} Ordenar por prazo</button>
              <button type="button" role="menuitem" data-l="esquerda">${icone('voltar')} Mover para a esquerda</button>
              <button type="button" role="menuitem" data-l="direita">${icone('avancar')} Mover para a direita</button>
              <button type="button" role="menuitem" data-l="arquivar" data-perigo>${icone('arquivar')} Arquivar lista</button>
            </div>
          </div>
        </header>
        <ol class="qd-cartoes" data-lista="${esc(l.id)}">${visiveis.map(cartaoHtml).join('')}${!todos.length ? '<li class="qd-lista-vazia">Arraste cartões para cá ou adicione um.</li>' : ''}</ol>
        <footer class="qd-lista-rodape">
          <button type="button" class="qd-add-cartao" data-add-cartao>${icone('adicionar')} Adicionar cartão</button>
          <form class="qd-form-cartao" hidden>
            <label class="so-leitor-tela" for="novo-${esc(l.id)}">Título do cartão</label>
            <textarea id="novo-${esc(l.id)}" rows="2" maxlength="300" placeholder="Título do cartão"></textarea>
            <p class="pagina-acoes"><button type="submit" data-primario>Adicionar</button><button type="button" class="acao-icone" data-cancelar-cartao aria-label="Cancelar">${icone('fechar')}</button></p>
          </form>
        </footer>
      </section>`;
    }).join('') + `<section class="qd-lista qd-nova-lista" aria-label="Nova lista">
        <button type="button" id="btn-nova-lista">${icone('adicionar')} Adicionar lista</button>
        <form id="form-nova-lista" hidden>
          <label class="so-leitor-tela" for="nome-nova-lista">Nome da lista</label>
          <input id="nome-nova-lista" maxlength="80" placeholder="Nome da lista">
          <p class="pagina-acoes"><button type="submit" data-primario>Adicionar lista</button><button type="button" class="acao-icone" id="cancelar-nova-lista" aria-label="Cancelar">${icone('fechar')}</button></p>
        </form>
      </section>`;
    k.scrollLeft = guardado.rolagemX;
    k.querySelectorAll('.qd-cartoes').forEach((ol) => { if (guardado.rolagens[ol.dataset.lista]) ol.scrollTop = guardado.rolagens[ol.dataset.lista]; });
    if (guardado.form) {
      const sec = k.querySelector(`.qd-lista[data-lista="${CSS.escape(guardado.form.lista)}"]`);
      if (sec) {
        sec.querySelector('[data-add-cartao]').hidden = true;
        const f = sec.querySelector('.qd-form-cartao');
        f.hidden = false;
        f.querySelector('textarea').value = guardado.form.valor;
        if (guardado.form.foco) f.querySelector('textarea').focus({ preventScroll: true });
      }
    }
    if (guardado.novaLista) {
      $('btn-nova-lista').hidden = true; $('form-nova-lista').hidden = false;
      $('nome-nova-lista').value = guardado.novaLista.valor;
      if (guardado.novaLista.foco) $('nome-nova-lista').focus({ preventScroll: true });
    }
    $('atalhos-listas').innerHTML = est.listas.map((l) => `<button type="button" data-ir-lista="${esc(l.id)}">${esc(l.nome)} <small>${est.cartoes.filter((c) => c.lista_id === l.id).length}</small></button>`).join('');
  }

  // ---- interações do kanban ----
  $('atalhos-listas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ir-lista]');
    if (b) document.querySelector(`.qd-lista[data-lista="${CSS.escape(b.dataset.irLista)}"]`)?.scrollIntoView({ behavior: MOVIMENTO_REDUZIDO ? 'auto' : 'smooth', inline: 'start', block: 'nearest' });
  });
  const kanban = $('qd-kanban');
  kanban.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-add-cartao]')) { abrirFormCartao(t.closest('.qd-lista')); return; }
    if (t.closest('[data-cancelar-cartao]')) { fecharFormCartao(t.closest('.qd-lista')); return; }
    if (t.closest('#btn-nova-lista')) { $('btn-nova-lista').hidden = true; $('form-nova-lista').hidden = false; $('nome-nova-lista').focus(); return; }
    if (t.closest('#cancelar-nova-lista')) { $('btn-nova-lista').hidden = false; $('form-nova-lista').hidden = true; return; }
    if (t.closest('[data-renomear-lista]')) { renomearLista(t.closest('.qd-lista')); return; }
    const menuBotao = t.closest('[data-menu-lista]');
    if (menuBotao) {
      const m = menuBotao.nextElementSibling;
      const abrir = m.hidden;
      fecharPopovers();
      m.hidden = !abrir;
      menuBotao.setAttribute('aria-expanded', String(abrir));
      if (abrir) m.querySelector('button').focus();
      return;
    }
    const acao = t.closest('[data-l]');
    if (acao) { fecharPopovers(); await acaoLista(acao.dataset.l, t.closest('.qd-lista').dataset.lista); return; }
    const cartao = t.closest('.qd-cartao');
    if (cartao && !est.arrastando) abrirCartao(cartao.dataset.cartao);
  });
  kanban.addEventListener('keydown', (e) => {
    const cartao = e.target.closest('.qd-cartao');
    if (cartao && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirCartao(cartao.dataset.cartao); }
    if (e.target.matches('.qd-form-cartao textarea')) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit(); }
      if (e.key === 'Escape') { e.preventDefault(); fecharFormCartao(e.target.closest('.qd-lista')); }
    }
    if (e.key === 'Escape' && e.target.closest('.qd-menu-lista')) { fecharPopovers(); e.target.closest('.qd-lista-mais').querySelector('[data-menu-lista]').focus(); }
  });
  kanban.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (e.target.id === 'form-nova-lista') {
      const nome = $('nome-nova-lista').value.trim();
      if (!nome) return;
      const ult = est.listas[est.listas.length - 1];
      const { data, error } = await db.from('quadro_listas').insert({ quadro_id: est.quadro.id, nome, posicao: posicaoEntre(ult && ult.posicao, null) }).select().single();
      if (error) { erroBanco(error, 'criar a lista'); return; }
      est.listas.push(data);
      render();
      $('btn-nova-lista').click();
      return;
    }
    if (e.target.matches('.qd-form-cartao')) {
      const ta = e.target.querySelector('textarea');
      const titulo = ta.value.trim();
      if (!titulo) return;
      const listaId = e.target.closest('.qd-lista').dataset.lista;
      const daLista = est.cartoes.filter((c) => c.lista_id === listaId).sort((a, b) => a.posicao - b.posicao);
      const ult = daLista[daLista.length - 1];
      ta.value = '';
      const base = { quadro_id: est.quadro.id, lista_id: listaId, titulo, posicao: posicaoEntre(ult && ult.posicao, null) };
      if (est.quadro.projeto_id) { base.projeto_id = est.quadro.projeto_id; if (est.quadro.projeto) base.cliente_id = est.quadro.projeto.cliente_id; }
      const { data, error } = await db.from('cartoes').insert(base).select(CAMPOS_CARTAO).single();
      if (error) { erroBanco(error, 'criar o cartão'); ta.value = titulo; return; }
      est.cartoes.push(data);
      render();
      abrirFormCartao(document.querySelector(`.qd-lista[data-lista="${CSS.escape(listaId)}"]`));
    }
  });
  function abrirFormCartao(lista) {
    if (!lista) return;
    document.querySelectorAll('.qd-form-cartao:not([hidden])').forEach((f) => { if (!lista.contains(f)) fecharFormCartao(f.closest('.qd-lista')); });
    lista.querySelector('[data-add-cartao]').hidden = true;
    const f = lista.querySelector('.qd-form-cartao');
    f.hidden = false;
    f.querySelector('textarea').focus();
    lista.querySelector('.qd-cartoes').scrollTop = 1e6;
  }
  function fecharFormCartao(lista) {
    if (!lista) return;
    lista.querySelector('[data-add-cartao]').hidden = false;
    lista.querySelector('.qd-form-cartao').hidden = true;
  }
  function renomearLista(sec) {
    const l = est.listas.find((x) => x.id === sec.dataset.lista);
    const h = sec.querySelector('h2');
    h.innerHTML = `<input class="qd-input-lista" value="${esc(l.nome)}" maxlength="80" aria-label="Nome da lista">`;
    const i = h.querySelector('input');
    i.focus(); i.select();
    const salvar = async (gravar) => {
      const nome = i.value.trim();
      if (gravar && nome && nome !== l.nome) {
        const { error } = await db.from('quadro_listas').update({ nome }).eq('id', l.id);
        if (error) erroBanco(error, 'renomear'); else l.nome = nome;
      }
      render();
    };
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } if (e.key === 'Escape') { i.dataset.cancelar = '1'; i.blur(); } });
    i.addEventListener('blur', () => salvar(!i.dataset.cancelar), { once: true });
  }
  async function acaoLista(acao, id) {
    const i = est.listas.findIndex((x) => x.id === id);
    const l = est.listas[i];
    if (acao === 'adicionar') { abrirFormCartao(document.querySelector(`.qd-lista[data-lista="${CSS.escape(id)}"]`)); return; }
    if (acao === 'limite') {
      const v = prompt('Máximo de cartões nesta lista (deixe vazio para sem limite):', l.limite || '');
      if (v === null) return;
      const n = v.trim() ? Math.max(1, Math.min(999, parseInt(v, 10) || 0)) : null;
      const { error } = await db.from('quadro_listas').update({ limite: n }).eq('id', id);
      if (error) return erroBanco(error, 'mudar o limite');
      l.limite = n;
    } else if (acao === 'conclui') {
      const { error } = await db.from('quadro_listas').update({ conclui: !l.conclui }).eq('id', id);
      if (error) return erroBanco(error, 'mudar a lista');
      l.conclui = !l.conclui;
      toast(l.conclui ? 'Cartões movidos para esta lista passam a contar como concluídos.' : 'Esta lista não marca mais como concluído.');
    } else if (acao === 'ordenar') {
      const daLista = est.cartoes.filter((c) => c.lista_id === id).sort((a, b) => (a.prazo ? new Date(a.prazo) : Infinity) - (b.prazo ? new Date(b.prazo) : Infinity));
      await Promise.all(daLista.map((c, n) => { c.posicao = (n + 1) * 1000; return db.from('cartoes').update({ posicao: c.posicao }).eq('id', c.id); }));
    } else if (acao === 'esquerda' || acao === 'direita') {
      const j = acao === 'esquerda' ? i - 1 : i + 1;
      if (j < 0 || j >= est.listas.length) return;
      const vizinho = est.listas[j];
      const depois = acao === 'esquerda' ? est.listas[j - 1] : est.listas[j + 1];
      const nova = acao === 'esquerda' ? posicaoEntre(depois && depois.posicao, vizinho.posicao) : posicaoEntre(vizinho.posicao, depois && depois.posicao);
      const { error } = await db.from('quadro_listas').update({ posicao: nova }).eq('id', id);
      if (error) return erroBanco(error, 'mover a lista');
      l.posicao = nova;
      est.listas.sort((a, b) => a.posicao - b.posicao);
    } else if (acao === 'arquivar') {
      const n = est.cartoes.filter((c) => c.lista_id === id).length;
      if (!confirm(`Arquivar a lista "${l.nome}"${n ? ` e seus ${n} cartões` : ''}? Você pode restaurar em "Itens arquivados".`)) return;
      const { error } = await db.from('quadro_listas').update({ arquivada_em: new Date().toISOString() }).eq('id', id);
      if (error) return erroBanco(error, 'arquivar a lista');
      est.listas.splice(i, 1);
      est.cartoes = est.cartoes.filter((c) => c.lista_id !== id);
    }
    render();
  }

  // ---- arrastar e soltar (mouse; no toque, "Mover" no cartão) ----
  let arrasto = null;
  const marcador = document.createElement('li');
  marcador.className = 'qd-marcador';
  marcador.setAttribute('aria-hidden', 'true');
  const marcadorLista = document.createElement('section');
  marcadorLista.className = 'qd-lista qd-marcador-lista';
  kanban.addEventListener('dragstart', (e) => {
    const cartao = e.target.closest('.qd-cartao');
    const topo = e.target.closest('.qd-lista-topo');
    if (cartao) {
      arrasto = { tipo: 'cartao', id: cartao.dataset.cartao, el: cartao };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', cartao.dataset.cartao);
      marcador.style.height = cartao.offsetHeight + 'px';
      requestAnimationFrame(() => cartao.classList.add('qd-arrastado'));
    } else if (topo) {
      const sec = topo.closest('.qd-lista');
      arrasto = { tipo: 'lista', id: sec.dataset.lista, el: sec };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', sec.dataset.lista);
      marcadorLista.style.height = sec.offsetHeight + 'px';
      requestAnimationFrame(() => sec.classList.add('qd-arrastado'));
    } else return;
    est.arrastando = true;
    document.body.classList.add('qd-arrastando');
  });
  kanban.addEventListener('dragover', (e) => {
    if (!arrasto) return;
    e.preventDefault();
    if (arrasto.tipo === 'cartao') {
      const ol = e.target.closest('.qd-cartoes') || e.target.closest('.qd-lista:not(.qd-nova-lista)')?.querySelector('.qd-cartoes');
      if (!ol) return;
      const irmaos = [...ol.querySelectorAll('.qd-cartao:not(.qd-arrastado)')];
      const depois = irmaos.find((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      ol.querySelector('.qd-lista-vazia')?.setAttribute('hidden', '');
      if (depois) ol.insertBefore(marcador, depois); else ol.appendChild(marcador);
      // rola a área do quadro perto das bordas
      const k = kanban.getBoundingClientRect();
      if (e.clientX > k.right - 60) kanban.scrollLeft += 18; else if (e.clientX < k.left + 60) kanban.scrollLeft -= 18;
    } else {
      const secs = [...kanban.querySelectorAll('.qd-lista:not(.qd-nova-lista):not(.qd-arrastado):not(.qd-marcador-lista)')];
      const depois = secs.find((s) => { const r = s.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
      kanban.insertBefore(marcadorLista, depois || kanban.querySelector('.qd-nova-lista'));
    }
  });
  kanban.addEventListener('drop', async (e) => {
    if (!arrasto) return;
    e.preventDefault();
    const a = arrasto;
    if (a.tipo === 'cartao' && marcador.parentNode) {
      const ol = marcador.parentNode;
      const listaId = ol.dataset.lista;
      const antes = marcador.previousElementSibling?.closest('.qd-cartao');
      const depois = marcador.nextElementSibling?.closest('.qd-cartao');
      const pa = antes && est.cartoes.find((c) => c.id === antes.dataset.cartao);
      const pd = depois && est.cartoes.find((c) => c.id === depois.dataset.cartao);
      const c = est.cartoes.find((x) => x.id === a.id);
      const pos = posicaoEntre(pa && pa.posicao, pd && pd.posicao);
      limparArrasto();
      if (c && (c.lista_id !== listaId || c.posicao !== pos)) await moverCartao(c, listaId, pos);
    } else if (a.tipo === 'lista' && marcadorLista.parentNode) {
      const antes = marcadorLista.previousElementSibling?.closest('.qd-lista:not(.qd-arrastado)');
      const depois = marcadorLista.nextElementSibling?.closest('.qd-lista:not(.qd-nova-lista):not(.qd-arrastado)');
      const la = antes && est.listas.find((x) => x.id === antes.dataset.lista);
      const ld = depois && est.listas.find((x) => x.id === depois.dataset.lista);
      const l = est.listas.find((x) => x.id === a.id);
      const pos = posicaoEntre(la && la.posicao, ld && ld.posicao);
      limparArrasto();
      if (l && l.posicao !== pos) {
        l.posicao = pos;
        est.listas.sort((x, y) => x.posicao - y.posicao);
        render();
        const { error } = await db.from('quadro_listas').update({ posicao: pos }).eq('id', l.id);
        if (error) { erroBanco(error, 'mover a lista'); carregarQuadro(); }
      } else render();
    } else limparArrasto();
  });
  kanban.addEventListener('dragend', () => { if (arrasto) { limparArrasto(); render(); } });
  function limparArrasto() {
    marcador.remove(); marcadorLista.remove();
    document.querySelectorAll('.qd-arrastado').forEach((x) => x.classList.remove('qd-arrastado'));
    document.body.classList.remove('qd-arrastando');
    arrasto = null;
    setTimeout(() => { est.arrastando = false; }, 50);
  }
  async function moverCartao(c, listaId, pos, quadroId = null) {
    const antes = { lista_id: c.lista_id, posicao: c.posicao, quadro_id: c.quadro_id };
    const lista = est.listas.find((l) => l.id === listaId);
    const novaLista = lista;
    if (lista && lista.limite && c.lista_id !== listaId && est.cartoes.filter((x) => x.lista_id === listaId).length >= lista.limite) {
      toast(`A lista "${lista.nome}" passou do limite de ${lista.limite} cartões.`, 'erro');
    }
    Object.assign(c, { lista_id: listaId, posicao: pos });
    const campos = { lista_id: listaId, posicao: pos };
    if (quadroId && quadroId !== antes.quadro_id) campos.quadro_id = quadroId;
    if (novaLista && novaLista.conclui && !c.concluido_em) c.concluido_em = new Date().toISOString();
    render();
    const { data, error } = await db.from('cartoes').update(campos).eq('id', c.id).select(CAMPOS_CARTAO).single();
    if (error) { Object.assign(c, antes); render(); erroBanco(error, 'mover o cartão'); return false; }
    if (campos.quadro_id) {
      est.cartoes = est.cartoes.filter((x) => x.id !== c.id);
      await db.from('cartao_etiquetas').delete().eq('cartao_id', c.id); // etiquetas são de cada quadro
    } else Object.assign(c, data);
    render();
    return true;
  }

  // ---------------------------------------------------------------
  // Lista (tabela)
  // ---------------------------------------------------------------
  function renderTabela() {
    const lista = est.cartoes.filter(passaFiltro);
    const nomeLista = (id) => (est.listas.find((l) => l.id === id) || {}).nome || '-';
    const ordemLista = (id) => est.listas.findIndex((l) => l.id === id);
    const { campo, dir } = est.ordem;
    const val = {
      titulo: (c) => c.titulo.toLowerCase(), lista: (c) => ordemLista(c.lista_id) * 1e6 + c.posicao,
      prazo: (c) => (c.prazo ? new Date(c.prazo).getTime() : Infinity), prioridade: (c) => (c.prioridade ? ORDEM_PRIO[c.prioridade] : 9)
    }[campo];
    lista.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
    const cab = (c, t) => `<th scope="col" aria-sort="${campo === c ? (dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-ordenar="${c}">${t}${campo === c ? icone(dir > 0 ? 'subiu' : 'desceu') : ''}</button></th>`;
    $('qd-tabela').innerHTML = lista.length ? `<div class="qd-tabela-rolagem"><table class="tabela-limpa">
      <thead><tr>${cab('titulo', 'Cartão')}${cab('lista', 'Lista')}<th scope="col">Responsáveis</th>${cab('prazo', 'Prazo')}${cab('prioridade', 'Prioridade')}<th scope="col">Etiquetas</th><th scope="col">Checklist</th></tr></thead>
      <tbody>${lista.map((c) => {
        const itens = (c.cartao_checklists || []).flatMap((k) => k.cartao_checklist_itens || []);
        const ep = estadoPrazo(c);
        const etqs = (c.cartao_etiquetas || []).map((x) => est.etiquetas.find((t) => t.id === x.etiqueta_id)).filter(Boolean);
        return `<tr data-cartao="${esc(c.id)}" tabindex="0"${c.concluido_em ? ' data-concluido' : ''}>
          <td><span class="qd-tabela-titulo">${c.concluido_em ? icone('ok', 'qd-ok') : ''}${esc(c.titulo)}</span></td>
          <td>${esc(nomeLista(c.lista_id))}</td>
          <td><span class="qd-avatares">${(c.cartao_responsaveis || []).map((r) => avatar(r.usuario_id)).join('') || '<span class="nota">—</span>'}</span></td>
          <td>${c.prazo ? `<span class="qd-badge" data-prazo="${ep}">${esc(textoPrazo(c.prazo))}</span>` : '<span class="nota">—</span>'}</td>
          <td>${c.prioridade ? `<span class="qd-badge" data-prio="${c.prioridade}">${esc(PRIORIDADES[c.prioridade])}</span>` : '<span class="nota">—</span>'}</td>
          <td><span class="qd-etiquetas">${etqs.map((t) => `<span class="qd-etq" style="--etq:${corHex(t.cor)}"${CLARAS.has(t.cor) ? ' data-clara' : ''}>${esc(t.nome)}</span>`).join('')}</span></td>
          <td>${itens.length ? itens.filter((i) => i.feito).length + '/' + itens.length : '<span class="nota">—</span>'}</td></tr>`;
      }).join('')}</tbody></table></div>` : `<p class="qd-vazio">${est.cartoes.length ? 'Nenhum cartão com estes filtros.' : 'Este quadro ainda não tem cartões.'}</p>`;
  }
  $('qd-tabela').addEventListener('click', (e) => {
    const o = e.target.closest('[data-ordenar]');
    if (o) { const c = o.dataset.ordenar; est.ordem = { campo: c, dir: est.ordem.campo === c ? -est.ordem.dir : 1 }; renderTabela(); return; }
    const tr = e.target.closest('tr[data-cartao]');
    if (tr) abrirCartao(tr.dataset.cartao);
  });
  $('qd-tabela').addEventListener('keydown', (e) => { const tr = e.target.closest('tr[data-cartao]'); if (tr && e.key === 'Enter') abrirCartao(tr.dataset.cartao); });

  // ---------------------------------------------------------------
  // Minhas tarefas (todos os quadros)
  // ---------------------------------------------------------------
  let minhas = [];
  async function carregarMinhas() {
    const { data, error } = await db.from('cartao_responsaveis')
      .select('cartao:cartoes!inner(id, titulo, prazo, prioridade, concluido_em, arquivado_em, quadro_id, lista_id, quadro:quadros(nome, cor, arquivado_em), lista:quadro_listas(nome))')
      .eq('usuario_id', perfil.id).is('cartao.concluido_em', null).is('cartao.arquivado_em', null);
    if (error) { $('qd-minhas').innerHTML = `<p class="qd-vazio">Não foi possível carregar: ${esc(error.message)}</p>`; return; }
    minhas = (data || []).map((r) => r.cartao).filter((c) => c && c.quadro && !c.quadro.arquivado_em);
    $('cont-minhas').hidden = !minhas.length;
    $('cont-minhas').textContent = minhas.length;
  }
  function renderMinhas() {
    const h = hojeLocal();
    const amanha = new Date(h); amanha.setDate(h.getDate() + 1);
    const semana = new Date(h); semana.setDate(h.getDate() + 7);
    const grupo = (c) => {
      if (!c.prazo) return 'sem';
      const p = new Date(c.prazo);
      return p < new Date() ? 'atrasadas' : p < amanha ? 'hoje' : p < semana ? 'semana' : 'depois';
    };
    const titulos = { atrasadas: 'Atrasadas', hoje: 'Hoje', semana: 'Próximos 7 dias', depois: 'Mais adiante', sem: 'Sem prazo' };
    const lista = minhas.filter((c) => !est.busca.trim() || c.titulo.toLowerCase().includes(est.busca.trim().toLowerCase()))
      .sort((a, b) => (a.prazo ? new Date(a.prazo) : Infinity) - (b.prazo ? new Date(b.prazo) : Infinity) || (ORDEM_PRIO[a.prioridade] ?? 9) - (ORDEM_PRIO[b.prioridade] ?? 9));
    if (!lista.length) {
      $('qd-minhas').innerHTML = `<div class="qd-vazio"><p><strong>Nada com você agora.</strong> Os cartões em que você for marcado como responsável aparecem aqui, de todos os quadros.</p></div>`;
      return;
    }
    $('qd-minhas').innerHTML = Object.keys(titulos).map((g) => {
      const itens = lista.filter((c) => grupo(c) === g);
      if (!itens.length) return '';
      return `<section class="qd-minhas-grupo" data-grupo="${g}"><h2>${titulos[g]} <small>${itens.length}</small></h2><ul>
        ${itens.map((c) => `<li class="qd-minha">
          <label class="qd-check" title="Marcar como concluído"><input type="checkbox" data-concluir="${esc(c.id)}"><span class="so-leitor-tela">Concluir ${esc(c.titulo)}</span></label>
          <button type="button" class="qd-minha-abrir" data-abrir-minha="${esc(c.id)}" data-quadro="${esc(c.quadro_id)}">
            <strong>${esc(c.titulo)}</strong>
            <small><span class="qd-cor" style="--cor:${corHex(c.quadro.cor)}" aria-hidden="true"></span>${esc(c.quadro.nome)} · ${esc(c.lista ? c.lista.nome : '')}</small>
          </button>
          ${c.prioridade && c.prioridade !== 'baixa' ? `<span class="qd-badge" data-prio="${c.prioridade}">${esc(PRIORIDADES[c.prioridade])}</span>` : ''}
          ${c.prazo ? `<span class="qd-badge" data-prazo="${estadoPrazo(c)}">${icone('prazo')}${esc(textoPrazo(c.prazo))}</span>` : ''}
        </li>`).join('')}</ul></section>`;
    }).join('');
  }
  $('qd-minhas').addEventListener('change', async (e) => {
    const i = e.target.closest('[data-concluir]');
    if (!i) return;
    const id = i.dataset.concluir;
    i.disabled = true;
    const { error } = await db.from('cartoes').update({ concluido_em: new Date().toISOString() }).eq('id', id);
    if (error) { i.checked = false; i.disabled = false; return erroBanco(error, 'concluir'); }
    i.closest('li').classList.add('qd-saindo');
    toast('Tarefa concluída.');
    setTimeout(async () => { await carregarMinhas(); renderMinhas(); }, 350);
    const c = est.cartoes.find((x) => x.id === id);
    if (c) c.concluido_em = new Date().toISOString();
  });
  $('qd-minhas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-abrir-minha]');
    if (b) abrirCartao(b.dataset.abrirMinha);
  });

  // ---- visões ----
  document.querySelectorAll('.qd-visoes [data-visao]').forEach((b) => b.addEventListener('click', async () => {
    est.visao = b.dataset.visao;
    document.querySelectorAll('.qd-visoes [data-visao]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const p = new URLSearchParams(location.search);
    if (est.visao === 'quadro') p.delete('visao'); else p.set('visao', est.visao);
    history.replaceState(null, '', location.pathname + '?' + p);
    try { localStorage.setItem('cmk_quadro_visao', est.visao); } catch (_) {}
    if (est.visao === 'minhas') { $('qd-minhas').innerHTML = '<p data-esqueleto-linha></p><p data-esqueleto-linha></p>'; await carregarMinhas(); }
    render();
  }));

  // ---------------------------------------------------------------
  // Cartão (detalhe)
  // ---------------------------------------------------------------
  const dlgCartao = $('dlg-cartao');
  ligarDialogo(dlgCartao);
  dlgCartao.addEventListener('close', () => {
    fecharPop();
    const p = new URLSearchParams(location.search);
    p.delete('cartao');
    history.replaceState(null, '', location.pathname + '?' + p);
    if (est.canalCartao) { db.removeChannel(est.canalCartao); est.canalCartao = null; }
    est.cartao = null;
    if (est.visao === 'minhas') carregarMinhas().then(renderMinhas);
  });

  async function abrirCartao(id) {
    // trocar de cartão com o título em edição: salva o atual antes (e não leva o texto para o próximo)
    if (est.cartao && document.activeElement === $('cartao-titulo')) $('cartao-titulo').blur();
    est.cartao = null;
    const { data: c, error } = await db.from('cartoes').select('*, quadro:quadros(id, nome, cor, projeto_id)').eq('id', id).maybeSingle();
    if (error || !c) { toast('Cartão não encontrado.', 'erro'); return; }
    // contexto do quadro do cartão (pode ser outro, vindo de "Minhas tarefas")
    if (est.quadro && c.quadro_id === est.quadro.id) est.ctx = { listas: est.listas, etiquetas: est.etiquetas };
    else {
      const [l, e] = await Promise.all([
        db.from('quadro_listas').select('*').eq('quadro_id', c.quadro_id).is('arquivada_em', null).order('posicao'),
        db.from('quadro_etiquetas').select('*').eq('quadro_id', c.quadro_id)
      ]);
      est.ctx = { listas: l.data || [], etiquetas: e.data || [] };
    }
    est.cartao = { ...c, responsaveis: [], etiquetasIds: [], checklists: [], anexos: [] };
    dlgCartao.setAttribute('aria-busy', 'true');
    const p = new URLSearchParams(location.search);
    p.set('cartao', c.id);
    history.replaceState(null, '', location.pathname + '?' + p);
    if (!dlgCartao.open) dlgCartao.showModal();
    $('cartao-titulo').value = c.titulo;
    $('cartao-descricao-ver').hidden = false; $('cartao-descricao-editar').hidden = true;
    $('novo-comentario').value = '';
    renderCartao();
    await recarregarCartao();
    dlgCartao.removeAttribute('aria-busy');
    if (!TOQUE) $('cartao-titulo').focus({ preventScroll: true });
    if (est.canalCartao) db.removeChannel(est.canalCartao);
    try {
      est.canalCartao = db.channel('cartao-' + c.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cartao_comentarios', filter: 'cartao_id=eq.' + c.id }, () => carregarTimeline())
        .subscribe();
    } catch (_) {}
  }

  async function recarregarCartao() {
    const id = est.cartao.id;
    const [c, r, et, ck, ax] = await Promise.all([
      db.from('cartoes').select('*, quadro:quadros(id, nome, cor, projeto_id)').eq('id', id).single(),
      db.from('cartao_responsaveis').select('usuario_id').eq('cartao_id', id),
      db.from('cartao_etiquetas').select('etiqueta_id').eq('cartao_id', id),
      db.from('cartao_checklists').select('*, cartao_checklist_itens(*)').eq('cartao_id', id).order('posicao'),
      db.from('cartao_anexos').select('*').eq('cartao_id', id).order('created_at', { ascending: false })
    ]);
    if (c.error) { toast('Não foi possível abrir o cartão.', 'erro'); dlgCartao.close(); return; }
    est.cartao = { ...c.data, responsaveis: (r.data || []).map((x) => x.usuario_id), etiquetasIds: (et.data || []).map((x) => x.etiqueta_id), checklists: ck.data || [], anexos: ax.data || [] };
    renderCartao();
    carregarTimeline();
  }

  function renderCartao() {
    const c = est.cartao;
    const capa = $('cartao-capa');
    capa.hidden = !c.capa_cor;
    if (c.capa_cor) capa.style.setProperty('--capa', corHex(c.capa_cor));
    const ta = $('cartao-titulo');
    if (document.activeElement !== ta) ta.value = c.titulo;
    autoAltura(ta);
    const lista = est.ctx.listas.find((l) => l.id === c.lista_id);
    $('cartao-onde').innerHTML = `na lista <button type="button" class="qd-link" data-abrir="mover">${esc(lista ? lista.nome : '—')}</button> · ${esc(c.quadro.nome)}${c.arquivado_em ? ' · <strong class="qd-arquivado">Arquivado</strong>' : ''}`;
    // faixa: o que o cartão já tem
    const etqs = c.etiquetasIds.map((id) => est.ctx.etiquetas.find((t) => t.id === id)).filter(Boolean);
    const ep = estadoPrazo(c);
    const blocos = [];
    if (c.responsaveis.length) blocos.push(`<div><h4>Responsáveis</h4><button type="button" class="qd-faixa-valor" data-abrir="responsaveis"><span class="qd-avatares">${c.responsaveis.map((u) => avatar(u)).join('')}</span>${icone('adicionar')}</button></div>`);
    if (etqs.length) blocos.push(`<div><h4>Etiquetas</h4><button type="button" class="qd-faixa-valor" data-abrir="etiquetas"><span class="qd-etiquetas">${etqs.map((t) => `<span class="qd-etq qd-etq-grande" style="--etq:${corHex(t.cor)}"${CLARAS.has(t.cor) ? ' data-clara' : ''}>${esc(t.nome || NOME_COR[t.cor])}</span>`).join('')}</span>${icone('adicionar')}</button></div>`);
    if (c.prazo || c.inicio) blocos.push(`<div><h4>Datas</h4><div class="qd-faixa-datas">
        ${c.prazo ? `<label class="qd-check"><input type="checkbox" id="chk-concluido"${c.concluido_em ? ' checked' : ''}><span class="so-leitor-tela">Concluído</span></label>` : ''}
        <button type="button" class="qd-faixa-valor" data-abrir="datas">${c.inicio ? esc(fmtData(c.inicio)) + ' → ' : ''}${c.prazo ? esc(textoPrazo(c.prazo)) : 'sem prazo'}
        ${ep && ep !== 'ok' ? `<span class="qd-badge" data-prazo="${ep}">${{ atrasado: 'Atrasado', hoje: 'Hoje', breve: 'Em breve', feito: 'Concluído' }[ep]}</span>` : ''}</button></div></div>`);
    else blocos.push(`<div><h4>Status</h4><label class="qd-check qd-check-texto"><input type="checkbox" id="chk-concluido"${c.concluido_em ? ' checked' : ''}> Concluído</label></div>`);
    if (c.prioridade) blocos.push(`<div><h4>Prioridade</h4><button type="button" class="qd-faixa-valor" data-abrir="prioridade"><span class="qd-badge" data-prio="${c.prioridade}">${icone('prioridade')}${esc(PRIORIDADES[c.prioridade])}</span></button></div>`);
    if (c.cliente_id || c.projeto_id) {
      const cli = (est.clientes || []).find((x) => x.id === c.cliente_id);
      const proj = (est.projetos || []).find((x) => x.id === c.projeto_id);
      blocos.push(`<div><h4>Ligado a</h4><div class="qd-ligacoes">
        ${c.projeto_id ? `<a href="projeto.html?id=${esc(c.projeto_id)}">${icone('projetos')}${esc(proj ? (proj.codigo ? proj.codigo + ' · ' : '') + proj.nome : 'Projeto')}</a>` : ''}
        ${c.cliente_id ? `<a href="mensagens.html?cliente=${esc(c.cliente_id)}">${icone('mensagens')}${esc(cli ? cli.nome || cli.email : 'Cliente')}</a>` : ''}
        <button type="button" class="acao-icone" data-abrir="ligacoes" aria-label="Mudar ligações">${icone('editar')}</button></div></div>`);
    }
    $('cartao-faixa').innerHTML = blocos.join('');
    $('chk-concluido')?.addEventListener('change', (e) => salvarCartao({ concluido_em: e.target.checked ? new Date().toISOString() : null }));
    // descrição
    $('cartao-descricao-ver').innerHTML = c.descricao ? formatar(c.descricao) : '<span class="nota">Adicione uma descrição mais detalhada...</span>';
    $('cartao-descricao-ver').toggleAttribute('data-vazia', !c.descricao);
    renderChecklists();
    renderAnexos();
    // ações
    $('btn-arquivar-cartao').querySelector('span').textContent = c.arquivado_em ? 'Restaurar' : 'Arquivar';
    $('btn-arquivar-cartao').querySelector('use').setAttribute('href', '/assets/icons/bi.svg#' + (c.arquivado_em ? 'restaurar' : 'arquivar'));
    $('btn-excluir-cartao').hidden = !c.arquivado_em;
  }

  function autoAltura(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
  $('cartao-titulo').addEventListener('input', (e) => autoAltura(e.target));
  $('cartao-titulo').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  $('cartao-titulo').addEventListener('blur', (e) => {
    if (!est.cartao) return;
    const t = e.target.value.trim();
    if (!t) { e.target.value = est.cartao.titulo; return; }
    if (t !== est.cartao.titulo) salvarCartao({ titulo: t });
  });

  async function salvarCartao(campos, { silencioso = false } = {}) {
    const c = est.cartao;
    const { data, error } = await db.from('cartoes').update(campos).eq('id', c.id).select('*, quadro:quadros(id, nome, cor, projeto_id)').single();
    if (error) { erroBanco(error, 'salvar'); renderCartao(); return false; }
    Object.assign(est.cartao, data);
    renderCartao();
    if (!silencioso) carregarTimeline();
    atualizarNoQuadro(c.id);
    return true;
  }
  let timerAtualizar = {};
  function atualizarNoQuadro(id) {
    clearTimeout(timerAtualizar[id]);
    timerAtualizar[id] = setTimeout(async () => {
      if (!est.quadro) return;
      const { data } = await db.from('cartoes').select(CAMPOS_CARTAO).eq('id', id).maybeSingle();
      const i = est.cartoes.findIndex((x) => x.id === id);
      if (!data || data.arquivado_em || data.quadro_id !== est.quadro.id) { if (i >= 0) est.cartoes.splice(i, 1); }
      else if (i >= 0) est.cartoes[i] = data; else est.cartoes.push(data);
      render();
    }, 150);
  }

  // ---- descrição ----
  function editarDescricao() {
    $('cartao-descricao-ver').hidden = true;
    $('cartao-descricao-editar').hidden = false;
    $('cartao-descricao').value = est.cartao.descricao || '';
    $('cartao-descricao').focus();
  }
  $('cartao-descricao-ver').addEventListener('click', (e) => { if (!e.target.closest('a')) editarDescricao(); });
  $('cartao-descricao-ver').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); editarDescricao(); } });
  const fecharDescricao = () => { $('cartao-descricao-ver').hidden = false; $('cartao-descricao-editar').hidden = true; };
  $('btn-cancelar-desc').addEventListener('click', fecharDescricao);
  $('btn-salvar-desc').addEventListener('click', async () => {
    const v = $('cartao-descricao').value.trim();
    if (await salvarCartao({ descricao: v || null }, { silencioso: true })) fecharDescricao();
  });
  $('cartao-descricao').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('btn-salvar-desc').click(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecharDescricao(); }
  });

  // ---- checklists ----
  function renderChecklists() {
    const lst = est.cartao.checklists;
    $('secao-checklists').hidden = !lst.length;
    $('cartao-checklists').innerHTML = lst.map((k) => {
      const itens = (k.cartao_checklist_itens || []).sort((a, b) => a.posicao - b.posicao);
      const feitos = itens.filter((i) => i.feito).length;
      const pct = itens.length ? Math.round(feitos / itens.length * 100) : 0;
      const ocultar = k._ocultar;
      return `<div class="qd-checklist" data-checklist="${esc(k.id)}">
        <header><button type="button" class="qd-checklist-titulo" data-renomear-check>${esc(k.titulo)}</button>
          <span class="qd-checklist-acoes">${feitos ? `<button type="button" data-ocultar-feitos>${ocultar ? 'Mostrar' : 'Ocultar'} feitos (${feitos})</button>` : ''}<button type="button" data-excluir-check>Excluir</button></span></header>
        <div class="qd-progresso"><span>${pct}%</span><progress max="100" value="${pct}"${pct === 100 ? ' data-completo' : ''}>${pct}%</progress></div>
        <ul>${itens.filter((i) => !(ocultar && i.feito)).map((i) => `<li data-item="${esc(i.id)}"${i.feito ? ' data-feito' : ''}>
          <label class="qd-check"><input type="checkbox" data-marcar-item${i.feito ? ' checked' : ''}><span class="so-leitor-tela">Feito</span></label>
          <button type="button" class="qd-item-texto" data-editar-item>${formatar(i.texto)}</button>
          ${i.responsavel_id ? avatar(i.responsavel_id, 'qd-avatar-mini') : ''}
          <button type="button" class="acao-icone qd-item-excluir" data-excluir-item aria-label="Excluir item">${icone('remover')}</button></li>`).join('')}</ul>
        <form class="qd-add-item"><label class="so-leitor-tela" for="item-${esc(k.id)}">Novo item</label>
          <input id="item-${esc(k.id)}" maxlength="500" placeholder="Adicionar um item"><button type="submit">Adicionar</button></form>
      </div>`;
    }).join('');
  }
  $('btn-add-checklist').addEventListener('click', async () => {
    const titulo = prompt('Nome da checklist:', 'Checklist');
    if (titulo === null) return;
    const ult = est.cartao.checklists[est.cartao.checklists.length - 1];
    const { data, error } = await db.from('cartao_checklists').insert({ cartao_id: est.cartao.id, titulo: titulo.trim() || 'Checklist', posicao: posicaoEntre(ult && ult.posicao, null) }).select('*, cartao_checklist_itens(*)').single();
    if (error) return erroBanco(error, 'criar a checklist');
    est.cartao.checklists.push(data);
    renderChecklists();
    $('cartao-checklists').querySelector(`[data-checklist="${data.id}"] .qd-add-item input`)?.focus();
  });
  $('cartao-checklists').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const input = f.querySelector('input');
    const texto = input.value.trim();
    if (!texto) return;
    const k = est.cartao.checklists.find((x) => x.id === f.closest('[data-checklist]').dataset.checklist);
    const itens = k.cartao_checklist_itens || [];
    const ult = itens.reduce((m, i) => Math.max(m, i.posicao), 0);
    input.value = '';
    const { data, error } = await db.from('cartao_checklist_itens').insert({ checklist_id: k.id, texto, posicao: ult + 1000 }).select().single();
    if (error) { input.value = texto; return erroBanco(error, 'adicionar o item'); }
    itens.push(data);
    k.cartao_checklist_itens = itens;
    renderChecklists();
    $('cartao-checklists').querySelector(`[data-checklist="${k.id}"] .qd-add-item input`).focus();
    atualizarNoQuadro(est.cartao.id);
  });
  $('cartao-checklists').addEventListener('change', async (e) => {
    if (!e.target.matches('[data-marcar-item]')) return;
    const id = e.target.closest('[data-item]').dataset.item;
    const k = est.cartao.checklists.find((x) => (x.cartao_checklist_itens || []).some((i) => i.id === id));
    const item = k.cartao_checklist_itens.find((i) => i.id === id);
    item.feito = e.target.checked;
    renderChecklists();
    const { error } = await db.from('cartao_checklist_itens').update({ feito: item.feito }).eq('id', id);
    if (error) { item.feito = !item.feito; renderChecklists(); return erroBanco(error, 'marcar o item'); }
    atualizarNoQuadro(est.cartao.id);
    carregarTimeline();
  });
  $('cartao-checklists').addEventListener('click', async (e) => {
    const box = e.target.closest('[data-checklist]');
    if (!box) return;
    const k = est.cartao.checklists.find((x) => x.id === box.dataset.checklist);
    if (e.target.closest('[data-ocultar-feitos]')) { k._ocultar = !k._ocultar; renderChecklists(); return; }
    if (e.target.closest('[data-excluir-check]')) {
      if (!confirm(`Excluir a checklist "${k.titulo}"?`)) return;
      const { error } = await db.from('cartao_checklists').delete().eq('id', k.id);
      if (error) return erroBanco(error, 'excluir');
      est.cartao.checklists = est.cartao.checklists.filter((x) => x !== k);
      renderChecklists(); atualizarNoQuadro(est.cartao.id); return;
    }
    if (e.target.closest('[data-renomear-check]')) {
      const t = prompt('Nome da checklist:', k.titulo);
      if (!t || !t.trim() || t.trim() === k.titulo) return;
      const { error } = await db.from('cartao_checklists').update({ titulo: t.trim() }).eq('id', k.id);
      if (error) return erroBanco(error, 'renomear');
      k.titulo = t.trim(); renderChecklists(); return;
    }
    const li = e.target.closest('[data-item]');
    if (!li) return;
    const item = k.cartao_checklist_itens.find((i) => i.id === li.dataset.item);
    if (e.target.closest('[data-excluir-item]')) {
      const { error } = await db.from('cartao_checklist_itens').delete().eq('id', item.id);
      if (error) return erroBanco(error, 'excluir o item');
      k.cartao_checklist_itens = k.cartao_checklist_itens.filter((i) => i !== item);
      renderChecklists(); atualizarNoQuadro(est.cartao.id); return;
    }
    if (e.target.closest('[data-editar-item]') && !e.target.closest('a')) {
      const b = e.target.closest('[data-editar-item]');
      b.outerHTML = `<input class="qd-item-input" value="${esc(item.texto)}" maxlength="500" aria-label="Texto do item">`;
      const i = li.querySelector('.qd-item-input');
      i.focus(); i.select();
      const salvar = async (gravar) => {
        const t = i.value.trim();
        if (gravar && t && t !== item.texto) {
          const { error } = await db.from('cartao_checklist_itens').update({ texto: t }).eq('id', item.id);
          if (error) erroBanco(error, 'editar o item'); else item.texto = t;
        }
        renderChecklists();
      };
      i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); i.blur(); } if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); i.dataset.cancelar = '1'; i.blur(); } });
      i.addEventListener('blur', () => salvar(!i.dataset.cancelar), { once: true });
    }
  });

  // ---- anexos ----
  const urlsAnexos = new Map();
  async function renderAnexos() {
    const lista = est.cartao.anexos;
    $('secao-anexos').hidden = !lista.length;
    const faltam = lista.map((a) => a.path).filter((p) => !urlsAnexos.has(p));
    if (faltam.length) {
      const { data } = await db.storage.from(BUCKET).createSignedUrls(faltam, 3600);
      (data || []).forEach((d) => { if (d.signedUrl) urlsAnexos.set(d.path, d.signedUrl); });
    }
    $('cartao-anexos').innerHTML = lista.map((a) => {
      const u = urlsAnexos.get(a.path);
      const img = /^image\//.test(a.mime || '');
      return `<li data-anexo="${esc(a.id)}">
        <a class="qd-anexo-previa" ${u ? `href="${esc(u)}" target="_blank" rel="noopener noreferrer"` : ''} aria-label="Abrir ${esc(a.nome)}">${img && u ? `<img src="${esc(u)}" alt="" loading="lazy">` : `<span>${esc((a.nome.split('.').pop() || '').slice(0, 4).toUpperCase())}</span>`}</a>
        <span class="qd-anexo-texto"><strong>${esc(a.nome)}</strong><small>${a.tamanho ? tamanho(a.tamanho) + ' · ' : ''}${esc(tempoRelativo(a.created_at))} · ${esc(nomeDe(a.enviado_por))}</small>
          <span class="qd-anexo-acoes">${u ? `<a href="${esc(u)}" download="${esc(a.nome)}">Baixar</a>` : ''}<button type="button" data-excluir-anexo>Excluir</button></span></span>
      </li>`;
    }).join('');
  }
  $('cartao-arquivo').addEventListener('change', async (e) => {
    const arquivos = [...e.target.files];
    e.target.value = '';
    for (const f of arquivos) {
      if (f.size > LIMITE_ARQUIVO) { toast(f.name + ' passa de 25 MB.', 'erro'); continue; }
      const seguro = f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').slice(-80) || 'arquivo';
      const caminho = `${est.cartao.quadro_id}/${est.cartao.id}/${crypto.randomUUID()}-${seguro}`;
      toast('Enviando ' + f.name + '...');
      const up = await db.storage.from(BUCKET).upload(caminho, f, { contentType: f.type || 'application/octet-stream' });
      if (up.error) { erroBanco(up.error, 'enviar ' + f.name); continue; }
      const { data, error } = await db.from('cartao_anexos').insert({ cartao_id: est.cartao.id, nome: f.name, path: caminho, mime: f.type || null, tamanho: f.size }).select().single();
      if (error) { await db.storage.from(BUCKET).remove([caminho]); erroBanco(error, 'registrar o anexo'); continue; }
      est.cartao.anexos.unshift(data);
    }
    renderAnexos();
    carregarTimeline();
    atualizarNoQuadro(est.cartao.id);
  });
  $('cartao-anexos').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-excluir-anexo]')) return;
    const a = est.cartao.anexos.find((x) => x.id === e.target.closest('[data-anexo]').dataset.anexo);
    if (!confirm(`Excluir o anexo "${a.nome}"?`)) return;
    const { error } = await db.from('cartao_anexos').delete().eq('id', a.id);
    if (error) return erroBanco(error, 'excluir o anexo');
    db.storage.from(BUCKET).remove([a.path]);
    est.cartao.anexos = est.cartao.anexos.filter((x) => x !== a);
    renderAnexos(); carregarTimeline(); atualizarNoQuadro(est.cartao.id);
  });

  // ---- comentários + histórico ----
  const TEXTO_ACAO = {
    criou: (d) => `criou este cartão${d.lista ? ' em ' + d.lista : ''}`, moveu: (d) => `moveu de ${d.de} para ${d.para}`,
    mudou_quadro: (d) => `moveu do quadro ${d.de} para ${d.para}`, renomeou: (d) => `renomeou para “${d.para}”`,
    prazo: (d) => `definiu o prazo para ${textoPrazo(d.prazo)}`, tirou_prazo: () => 'removeu o prazo', concluiu: () => 'marcou como concluído',
    reabriu: () => 'reabriu o cartão', arquivou: () => 'arquivou o cartão', restaurou: () => 'restaurou o cartão',
    prioridade: (d) => (d.para ? `mudou a prioridade para ${PRIORIDADES[d.para]}` : 'tirou a prioridade'),
    marcou_responsavel: (d) => `marcou ${d.nome} como responsável`, tirou_responsavel: (d) => `tirou ${d.nome} dos responsáveis`,
    anexou: (d) => `anexou ${d.nome}`, tirou_anexo: (d) => `removeu o anexo ${d.nome}`, item_feito: (d) => `concluiu “${d.item}”`,
    item_reaberto: (d) => `reabriu “${d.item}”`, comentou: () => null
  };
  async function carregarTimeline() {
    if (!est.cartao) return;
    const id = est.cartao.id;
    const [co, at] = await Promise.all([
      db.from('cartao_comentarios').select('*').eq('cartao_id', id).order('created_at', { ascending: false }),
      $('mostrar-atividade').checked ? db.from('cartao_atividade').select('*').eq('cartao_id', id).neq('acao', 'comentou').order('created_at', { ascending: false }).limit(60) : { data: [] }
    ]);
    if (!est.cartao || est.cartao.id !== id) return;
    const itens = [...(co.data || []).map((x) => ({ ...x, _tipo: 'c' })), ...(at.data || []).map((x) => ({ ...x, _tipo: 'a' }))]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    $('cartao-timeline').innerHTML = itens.map((x) => {
      if (x._tipo === 'a') {
        const f = TEXTO_ACAO[x.acao];
        const t = f ? f(x.detalhe || {}) : x.acao;
        return t ? `<li class="qd-evento">${avatar(x.autor_id, 'qd-avatar-mini')}<p><strong>${esc(x.autor_id ? nomeDe(x.autor_id) : 'Sistema')}</strong> ${esc(t)} <time datetime="${esc(x.created_at)}" title="${esc(fmtDataHora(x.created_at))}">${esc(tempoRelativo(x.created_at))}</time></p></li>` : '';
      }
      const meu = x.autor_id === perfil.id;
      return `<li class="qd-comentario" data-comentario="${esc(x.id)}">${avatar(x.autor_id)}
        <div><p class="qd-comentario-topo"><strong>${esc(nomeDe(x.autor_id))}</strong> <time datetime="${esc(x.created_at)}" title="${esc(fmtDataHora(x.created_at))}">${esc(tempoRelativo(x.created_at))}</time>${x.editado_em ? ' <small>(editado)</small>' : ''}</p>
          <div class="qd-comentario-corpo">${formatar(x.corpo)}</div>
          ${meu ? `<p class="qd-comentario-acoes"><button type="button" data-editar-coment>Editar</button><button type="button" data-apagar-coment>Excluir</button></p>` : ''}</div></li>`;
    }).join('') || '<li class="qd-evento nota">Nenhuma atividade ainda.</li>';
    est.comentarios = co.data || [];
  }
  $('mostrar-atividade').addEventListener('change', carregarTimeline);
  const novoComent = $('novo-comentario');
  novoComent.addEventListener('input', () => { $('btn-comentar').disabled = !novoComent.value.trim(); autoAltura(novoComent); });
  novoComent.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('form-comentario').requestSubmit(); } });
  $('form-comentario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const corpo = novoComent.value.trim();
    if (!corpo) return;
    ocupado($('btn-comentar'), true);
    const { error } = await db.from('cartao_comentarios').insert({ cartao_id: est.cartao.id, autor_id: perfil.id, corpo });
    ocupado($('btn-comentar'), false);
    if (error) return erroBanco(error, 'comentar');
    novoComent.value = ''; autoAltura(novoComent); $('btn-comentar').disabled = true;
    carregarTimeline(); atualizarNoQuadro(est.cartao.id);
  });
  $('cartao-timeline').addEventListener('click', async (e) => {
    const li = e.target.closest('[data-comentario]');
    if (!li) return;
    const c = est.comentarios.find((x) => x.id === li.dataset.comentario);
    if (e.target.closest('[data-apagar-coment]')) {
      if (!confirm('Excluir este comentário?')) return;
      const { error } = await db.from('cartao_comentarios').delete().eq('id', c.id);
      if (error) return erroBanco(error, 'excluir');
      carregarTimeline(); atualizarNoQuadro(est.cartao.id);
    } else if (e.target.closest('[data-editar-coment]')) {
      const box = li.querySelector('.qd-comentario-corpo');
      box.innerHTML = `<textarea rows="3" maxlength="5000" aria-label="Editar comentário">${esc(c.corpo)}</textarea><p class="pagina-acoes"><button type="button" data-salvar-coment data-primario>Salvar</button><button type="button" data-cancelar-coment>Cancelar</button></p>`;
      box.querySelector('textarea').focus();
    } else if (e.target.closest('[data-cancelar-coment]')) carregarTimeline();
    else if (e.target.closest('[data-salvar-coment]')) {
      const v = li.querySelector('textarea').value.trim();
      if (!v) return;
      const { error } = await db.from('cartao_comentarios').update({ corpo: v, editado_em: new Date().toISOString() }).eq('id', c.id);
      if (error) return erroBanco(error, 'editar');
      carregarTimeline();
    }
  });

  // ---- painéis de ação (responsáveis, etiquetas, datas, prioridade, capa, ligações, mover) ----
  const pop = $('pop-cartao');
  function fecharPop() { pop.hidden = true; }
  $('pop-fechar').addEventListener('click', fecharPop);
  dlgCartao.addEventListener('click', (e) => {
    const b = e.target.closest('[data-abrir]');
    if (b) { abrirPop(b.dataset.abrir); return; }
    if (!pop.hidden && !e.target.closest('#pop-cartao')) fecharPop();
  });
  dlgCartao.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { e.preventDefault(); fecharPop(); } });

  async function abrirPop(qual) {
    const c = est.cartao;
    const titulos = { responsaveis: 'Responsáveis', etiquetas: 'Etiquetas', datas: 'Datas', prioridade: 'Prioridade', capa: 'Capa', ligacoes: 'Cliente e projeto', mover: 'Mover cartão' };
    $('pop-cartao-titulo').textContent = titulos[qual];
    const corpo = $('pop-cartao-corpo');
    pop.dataset.qual = qual;
    if (qual === 'responsaveis') {
      corpo.innerHTML = `<ul class="qd-pop-lista">${est.admins.map((a) => `<li><label><input type="checkbox" value="${esc(a.id)}"${c.responsaveis.includes(a.id) ? ' checked' : ''}>
        ${avatar(a.id)}<span>${esc(a.nome || a.email)}${a.id === perfil.id ? ' <small>(você)</small>' : ''}</span></label></li>`).join('')}</ul>`;
    } else if (qual === 'etiquetas') {
      corpo.innerHTML = `<ul class="qd-pop-lista">${est.ctx.etiquetas.map((t) => `<li><label><input type="checkbox" value="${esc(t.id)}"${c.etiquetasIds.includes(t.id) ? ' checked' : ''}>
        <span class="qd-etq qd-etq-grande qd-etq-cheia" style="--etq:${corHex(t.cor)}"${CLARAS.has(t.cor) ? ' data-clara' : ''}>${esc(t.nome || NOME_COR[t.cor])}</span></label></li>`).join('') || '<li class="nota">Nenhuma etiqueta.</li>'}</ul>
        ${c.quadro_id === (est.quadro && est.quadro.id) ? '<button type="button" id="pop-editar-etiquetas">Criar ou editar etiquetas</button>' : ''}`;
      $('pop-editar-etiquetas')?.addEventListener('click', abrirEtiquetas);
    } else if (qual === 'datas') {
      const p = c.prazo ? new Date(c.prazo) : null;
      const dia = p ? p.toLocaleDateString('sv-SE') : '';
      const hora = p ? p.toTimeString().slice(0, 5) : '18:00';
      corpo.innerHTML = `<form id="form-datas" class="qd-pop-form">
        <p><label for="d-inicio">Início</label><input type="date" id="d-inicio" value="${esc(c.inicio || '')}"></p>
        <div class="qd-pop-linha"><p><label for="d-prazo">Prazo</label><input type="date" id="d-prazo" value="${esc(dia)}"></p>
          <p><label for="d-hora">Hora</label><input type="time" id="d-hora" value="${esc(hora)}"></p></div>
        <p class="qd-pop-atalhos"><button type="button" data-dias="0">Hoje</button><button type="button" data-dias="1">Amanhã</button><button type="button" data-dias="7">Em 1 semana</button></p>
        <p class="pagina-acoes"><button type="submit" data-primario>Salvar</button><button type="button" id="d-remover">Remover datas</button></p></form>`;
      corpo.querySelectorAll('[data-dias]').forEach((b) => b.addEventListener('click', () => {
        const d = new Date(); d.setDate(d.getDate() + Number(b.dataset.dias));
        $('d-prazo').value = d.toLocaleDateString('sv-SE');
      }));
      $('form-datas').addEventListener('submit', async (e) => {
        e.preventDefault();
        const prazo = $('d-prazo').value ? new Date($('d-prazo').value + 'T' + ($('d-hora').value || '23:59') + ':00').toISOString() : null;
        if (await salvarCartao({ prazo, inicio: $('d-inicio').value || null })) fecharPop();
      });
      $('d-remover').addEventListener('click', async () => { if (await salvarCartao({ prazo: null, inicio: null })) fecharPop(); });
    } else if (qual === 'prioridade') {
      corpo.innerHTML = `<ul class="qd-pop-lista">${[['', 'Sem prioridade'], ...Object.entries(PRIORIDADES)].map(([v, t]) => `<li><label><input type="radio" name="pop-prio" value="${v}"${(c.prioridade || '') === v ? ' checked' : ''}>
        ${v ? `<span class="qd-badge" data-prio="${v}">${icone('prioridade')}${t}</span>` : `<span>${t}</span>`}</label></li>`).join('')}</ul>`;
    } else if (qual === 'capa') {
      corpo.innerHTML = `<div class="qd-cores" id="pop-cores"></div><p class="pagina-acoes"><button type="button" id="pop-sem-capa">Remover capa</button></p>`;
      paleta($('pop-cores'), c.capa_cor, 'pop-capa');
      $('pop-cores').addEventListener('change', () => salvarCartao({ capa_cor: corEscolhida($('pop-cores')) }, { silencioso: true }));
      $('pop-sem-capa').addEventListener('click', () => { salvarCartao({ capa_cor: null }, { silencioso: true }); fecharPop(); });
    } else if (qual === 'ligacoes') {
      corpo.innerHTML = '<p data-esqueleto-linha></p>';
      pop.hidden = false;
      await carregarClientesProjetos();
      corpo.innerHTML = `<form id="form-ligacoes" class="qd-pop-form">
        <p><label for="l-cliente">Cliente</label><select id="l-cliente"><option value="">Nenhum</option>${est.clientes.map((x) => `<option value="${esc(x.id)}"${x.id === c.cliente_id ? ' selected' : ''}>${esc(x.nome || x.email)}</option>`).join('')}</select></p>
        <p><label for="l-projeto">Projeto</label><select id="l-projeto"><option value="">Nenhum</option>${est.projetos.map((x) => `<option value="${esc(x.id)}"${x.id === c.projeto_id ? ' selected' : ''}>${esc((x.codigo ? x.codigo + ' · ' : '') + x.nome)}</option>`).join('')}</select></p>
        <p class="pagina-acoes"><button type="submit" data-primario>Salvar</button></p></form>`;
      $('l-projeto').addEventListener('change', () => { const pj = est.projetos.find((x) => x.id === $('l-projeto').value); if (pj && !$('l-cliente').value) $('l-cliente').value = pj.cliente_id; });
      $('form-ligacoes').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (await salvarCartao({ cliente_id: $('l-cliente').value || null, projeto_id: $('l-projeto').value || null }, { silencioso: true })) fecharPop();
      });
    } else if (qual === 'mover') {
      corpo.innerHTML = `<form id="form-mover" class="qd-pop-form">
        <p><label for="m-quadro">Quadro</label><select id="m-quadro">${est.quadros.map((q) => `<option value="${esc(q.id)}"${q.id === c.quadro_id ? ' selected' : ''}>${esc(q.nome)}</option>`).join('')}</select></p>
        <div class="qd-pop-linha"><p><label for="m-lista">Lista</label><select id="m-lista"></select></p>
          <p><label for="m-pos">Posição</label><select id="m-pos"><option value="fim">No fim</option><option value="inicio">No início</option></select></p></div>
        <p class="pagina-acoes"><button type="submit" data-primario>Mover</button></p></form>`;
      const preencherListas = async () => {
        const qid = $('m-quadro').value;
        let listas = qid === c.quadro_id ? est.ctx.listas : null;
        if (!listas) { const { data } = await db.from('quadro_listas').select('*').eq('quadro_id', qid).is('arquivada_em', null).order('posicao'); listas = data || []; }
        $('m-lista').innerHTML = listas.map((l) => `<option value="${esc(l.id)}"${l.id === c.lista_id ? ' selected' : ''}>${esc(l.nome)}</option>`).join('');
        $('m-lista')._listas = listas;
      };
      await preencherListas();
      $('m-quadro').addEventListener('change', preencherListas);
      $('form-mover').addEventListener('submit', async (e) => {
        e.preventDefault();
        const qid = $('m-quadro').value;
        const lid = $('m-lista').value;
        if (!lid) return;
        const { data: irmaos } = await db.from('cartoes').select('posicao').eq('lista_id', lid).is('arquivado_em', null).order('posicao');
        const ps = (irmaos || []).map((x) => x.posicao);
        const pos = $('m-pos').value === 'inicio' ? posicaoEntre(null, ps[0] ?? null) : posicaoEntre(ps[ps.length - 1] ?? null, null);
        const campos = { lista_id: lid, posicao: pos };
        if (qid !== c.quadro_id) campos.quadro_id = qid;
        const ok = await salvarCartao(campos);
        if (!ok) return;
        if (campos.quadro_id) {
          await db.from('cartao_etiquetas').delete().eq('cartao_id', c.id);
          est.ctx = { listas: $('m-lista')._listas, etiquetas: (await db.from('quadro_etiquetas').select('*').eq('quadro_id', qid)).data || [] };
          est.cartao.etiquetasIds = [];
          renderCartao();
          toast('Cartão movido para outro quadro.');
        }
        fecharPop();
      });
    }
    pop.hidden = false;
    pop.querySelector('input, select, button:not(#pop-fechar)')?.focus();
  }
  pop.addEventListener('change', async (e) => {
    const c = est.cartao;
    const qual = pop.dataset.qual;
    if (qual === 'responsaveis' && e.target.matches('input[type=checkbox]')) {
      const id = e.target.value;
      const r = e.target.checked
        ? await db.from('cartao_responsaveis').insert({ cartao_id: c.id, usuario_id: id })
        : await db.from('cartao_responsaveis').delete().eq('cartao_id', c.id).eq('usuario_id', id);
      if (r.error) { e.target.checked = !e.target.checked; return erroBanco(r.error, 'mudar responsáveis'); }
      c.responsaveis = e.target.checked ? [...c.responsaveis, id] : c.responsaveis.filter((x) => x !== id);
      renderCartao(); carregarTimeline(); atualizarNoQuadro(c.id);
    } else if (qual === 'etiquetas' && e.target.matches('input[type=checkbox]')) {
      const id = e.target.value;
      const r = e.target.checked
        ? await db.from('cartao_etiquetas').insert({ cartao_id: c.id, etiqueta_id: id })
        : await db.from('cartao_etiquetas').delete().eq('cartao_id', c.id).eq('etiqueta_id', id);
      if (r.error) { e.target.checked = !e.target.checked; return erroBanco(r.error, 'mudar etiquetas'); }
      c.etiquetasIds = e.target.checked ? [...c.etiquetasIds, id] : c.etiquetasIds.filter((x) => x !== id);
      renderCartao(); atualizarNoQuadro(c.id);
    } else if (qual === 'prioridade' && e.target.name === 'pop-prio') {
      await salvarCartao({ prioridade: e.target.value || null });
      fecharPop();
    }
  });

  // ---- ações do cartão ----
  $('btn-arquivar-cartao').addEventListener('click', async () => {
    const arquivar = !est.cartao.arquivado_em;
    if (await salvarCartao({ arquivado_em: arquivar ? new Date().toISOString() : null })) toast(arquivar ? 'Cartão arquivado.' : 'Cartão restaurado.');
  });
  $('btn-excluir-cartao').addEventListener('click', async () => {
    const c = est.cartao;
    if (!confirm(`Excluir de vez o cartão "${c.titulo}"? Comentários, checklists e anexos também serão apagados.`)) return;
    const caminhos = c.anexos.map((a) => a.path);
    const { error } = await db.from('cartoes').delete().eq('id', c.id);
    if (error) return erroBanco(error, 'excluir');
    if (caminhos.length) db.storage.from(BUCKET).remove(caminhos);
    est.cartoes = est.cartoes.filter((x) => x.id !== c.id);
    dlgCartao.close();
    render();
    toast('Cartão excluído.');
  });
  $('btn-copiar-link').addEventListener('click', async () => {
    const url = location.origin + '/admin-quadros.html?quadro=' + est.cartao.quadro_id + '&cartao=' + est.cartao.id;
    try { await navigator.clipboard.writeText(url); toast('Link copiado.'); } catch (_) { prompt('Copie o link:', url); }
  });
  $('btn-copiar-cartao').addEventListener('click', async () => {
    const c = est.cartao;
    const campos = ['quadro_id', 'lista_id', 'descricao', 'prioridade', 'inicio', 'prazo', 'capa_cor', 'cliente_id', 'projeto_id', 'solicitacao_id', 'conversa_id'];
    const novo = Object.fromEntries(campos.map((k) => [k, c[k]]));
    novo.titulo = (c.titulo + ' (cópia)').slice(0, 300);
    novo.posicao = c.posicao + 0.5;
    const { data, error } = await db.from('cartoes').insert(novo).select('id').single();
    if (error) return erroBanco(error, 'duplicar');
    await Promise.all([
      c.etiquetasIds.length ? db.from('cartao_etiquetas').insert(c.etiquetasIds.map((id) => ({ cartao_id: data.id, etiqueta_id: id }))) : null,
      ...c.checklists.map(async (k) => {
        const { data: nk } = await db.from('cartao_checklists').insert({ cartao_id: data.id, titulo: k.titulo, posicao: k.posicao }).select('id').single();
        if (nk && (k.cartao_checklist_itens || []).length) await db.from('cartao_checklist_itens').insert(k.cartao_checklist_itens.map((i) => ({ checklist_id: nk.id, texto: i.texto, posicao: i.posicao })));
      })
    ]);
    atualizarNoQuadro(data.id);
    toast('Cartão duplicado.');
    abrirCartao(data.id);
  });

  // ---------------------------------------------------------------
  // Quadro: criar, editar, fixar, arquivar
  // ---------------------------------------------------------------
  const dlgQuadro = $('dlg-quadro');
  ligarDialogo(dlgQuadro);
  async function abrirDialogoQuadro(editar = null, preset = {}) {
    await Promise.all([carregarClientesProjetos(), carregarEmpresas()]);
    $('quadro-id').value = editar ? editar.id : '';
    $('dlg-quadro-titulo').textContent = editar ? 'Editar quadro' : 'Novo quadro';
    $('btn-salvar-quadro').textContent = editar ? 'Salvar' : 'Criar quadro';
    const tipo = editar ? editar.tipo : preset.tipo || 'interno';
    dlgQuadro.querySelectorAll('[name=quadro-tipo]').forEach((r) => { r.checked = r.value === tipo; r.disabled = Boolean(editar); });
    $('quadro-empresa').innerHTML = est.empresas.map((x) => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('') || '<option value="">Cadastre uma empresa primeiro</option>';
    $('quadro-projeto').innerHTML = est.projetos.map((x) => `<option value="${esc(x.id)}">${esc((x.codigo ? x.codigo + ' · ' : '') + x.nome)}</option>`).join('') || '<option value="">Nenhum projeto</option>';
    if (preset.empresa_id) $('quadro-empresa').value = preset.empresa_id;
    $('quadro-nome').value = editar ? editar.nome : '';
    $('quadro-descricao').value = editar ? editar.descricao || '' : '';
    paleta($('quadro-cores'), Object.keys(CORES).find((k) => CORES[k].toLowerCase() === String(editar ? editar.cor : '').toLowerCase()) || 'azul', 'quadro-cor');
    tipoQuadroMudou();
    dlgQuadro.showModal();
    $('quadro-nome').focus();
  }
  function tipoQuadroMudou() {
    const t = (dlgQuadro.querySelector('[name=quadro-tipo]:checked') || {}).value;
    const editando = Boolean($('quadro-id').value);
    $('campo-quadro-empresa').hidden = t !== 'empresa' || editando;
    $('campo-quadro-projeto').hidden = t !== 'projeto' || editando;
    if (!editando && !$('quadro-nome').value.trim()) {
      if (t === 'empresa') $('quadro-nome').placeholder = (est.empresas.find((x) => x.id === $('quadro-empresa').value) || {}).nome || 'Nome da empresa';
      else if (t === 'projeto') $('quadro-nome').placeholder = $('quadro-projeto').selectedOptions[0]?.textContent || '';
      else $('quadro-nome').placeholder = 'Ex.: Marketing 2026';
    }
  }
  $('quadro-tipos').addEventListener('change', tipoQuadroMudou);
  $('quadro-empresa').addEventListener('change', tipoQuadroMudou);
  $('quadro-projeto').addEventListener('change', tipoQuadroMudou);
  $('form-quadro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('quadro-id').value;
    const tipo = (dlgQuadro.querySelector('[name=quadro-tipo]:checked') || {}).value;
    const nome = $('quadro-nome').value.trim() || $('quadro-nome').placeholder.replace(/^Ex\.: /, '');
    const dados = { nome, descricao: $('quadro-descricao').value.trim() || null, cor: CORES[corEscolhida($('quadro-cores'))] };
    if (!nome) { toast('Dê um nome ao quadro.', 'erro'); return; }
    ocupado($('btn-salvar-quadro'), true);
    let r;
    if (id) r = await db.from('quadros').update(dados).eq('id', id).select('id').single();
    else {
      if (tipo === 'projeto') {
        const existente = est.quadros.find((q) => q.projeto_id === $('quadro-projeto').value);
        if (existente) { ocupado($('btn-salvar-quadro'), false); dlgQuadro.close(); toast('Esse projeto já tem quadro: abrindo.'); abrirQuadro(existente.id); return; }
      }
      const extra = tipo === 'empresa' ? { empresa_id: $('quadro-empresa').value || null } : tipo === 'projeto' ? { projeto_id: $('quadro-projeto').value || null } : {};
      if (tipo !== 'interno' && !Object.values(extra)[0]) { ocupado($('btn-salvar-quadro'), false); toast('Escolha ' + (tipo === 'empresa' ? 'a empresa.' : 'o projeto.'), 'erro'); return; }
      if (tipo === 'projeto') { const pj = est.projetos.find((x) => x.id === extra.projeto_id); if (pj && pj.empresa_id) extra.empresa_id = pj.empresa_id; }
      r = await db.from('quadros').insert({ ...dados, tipo, ...extra, criado_por: perfil.id }).select('id').single();
    }
    ocupado($('btn-salvar-quadro'), false);
    if (r.error) return erroBanco(r.error, 'salvar o quadro');
    dlgQuadro.close();
    await carregarQuadros();
    abrirQuadro(r.data.id);
    toast(id ? 'Quadro atualizado.' : 'Quadro criado com as listas padrão.');
  });
  $('btn-novo-quadro-painel').addEventListener('click', () => { fecharPopovers(); abrirDialogoQuadro(); });
  $('btn-menu-quadro').addEventListener('click', () => alternar($('btn-menu-quadro'), $('menu-quadro')));
  $('menu-quadro').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    fecharPopovers();
    const q = est.quadro;
    if (b.dataset.q === 'editar') abrirDialogoQuadro(q);
    else if (b.dataset.q === 'etiquetas') abrirEtiquetas();
    else if (b.dataset.q === 'arquivados') abrirArquivados();
    else if (b.dataset.q === 'fixar') {
      const { error } = await db.from('quadros').update({ fixado: !q.fixado }).eq('id', q.id);
      if (error) return erroBanco(error, 'fixar');
      q.fixado = !q.fixado;
      await carregarQuadros(); abrirQuadro(q.id);
      toast(q.fixado ? 'Quadro fixado no topo.' : 'Quadro desafixado.');
    } else if (b.dataset.q === 'arquivar') {
      if (!confirm(`Arquivar o quadro "${q.nome}"? Ele some da lista, mas nada é apagado.`)) return;
      const { error } = await db.from('quadros').update({ arquivado_em: new Date().toISOString() }).eq('id', q.id);
      if (error) return erroBanco(error, 'arquivar');
      await carregarQuadros();
      abrirQuadro(est.quadros[0] && est.quadros[0].id);
      toast('Quadro arquivado.');
    }
  });

  // ---- etiquetas do quadro ----
  const dlgEtq = $('dlg-etiquetas');
  ligarDialogo(dlgEtq);
  dlgEtq.addEventListener('close', () => { renderFiltros(); render(); if (est.cartao) { est.ctx.etiquetas = est.etiquetas; renderCartao(); } });
  function abrirEtiquetas() {
    paleta($('etiqueta-cores'), 'azul', 'nova-etq');
    renderEtiquetasEdicao();
    dlgEtq.showModal();
  }
  function renderEtiquetasEdicao() {
    $('etiquetas-edicao').innerHTML = est.etiquetas.map((t) => `<li data-etiqueta="${esc(t.id)}">
      <span class="qd-etq qd-etq-grande qd-etq-cheia" style="--etq:${corHex(t.cor)}"${CLARAS.has(t.cor) ? ' data-clara' : ''}>${esc(t.nome || NOME_COR[t.cor])}</span>
      <label class="so-leitor-tela" for="etq-n-${esc(t.id)}">Nome</label><input id="etq-n-${esc(t.id)}" value="${esc(t.nome)}" maxlength="40" data-etq-nome>
      <label class="so-leitor-tela" for="etq-c-${esc(t.id)}">Cor</label><select id="etq-c-${esc(t.id)}" data-etq-cor>${Object.keys(CORES).map((c) => `<option value="${c}"${c === t.cor ? ' selected' : ''}>${NOME_COR[c]}</option>`).join('')}</select>
      <button type="button" class="acao-icone" data-etq-excluir aria-label="Excluir etiqueta">${icone('remover')}</button></li>`).join('') || '<li class="nota">Nenhuma etiqueta ainda.</li>';
  }
  $('etiquetas-edicao').addEventListener('change', async (e) => {
    const li = e.target.closest('[data-etiqueta]');
    if (!li) return;
    const t = est.etiquetas.find((x) => x.id === li.dataset.etiqueta);
    const campos = e.target.matches('[data-etq-nome]') ? { nome: e.target.value.trim() } : { cor: e.target.value };
    const { error } = await db.from('quadro_etiquetas').update(campos).eq('id', t.id);
    if (error) return erroBanco(error, 'salvar a etiqueta');
    Object.assign(t, campos);
    renderEtiquetasEdicao();
  });
  $('etiquetas-edicao').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-etq-excluir]')) return;
    const t = est.etiquetas.find((x) => x.id === e.target.closest('[data-etiqueta]').dataset.etiqueta);
    if (!confirm(`Excluir a etiqueta "${t.nome || NOME_COR[t.cor]}"? Ela sai de todos os cartões.`)) return;
    const { error } = await db.from('quadro_etiquetas').delete().eq('id', t.id);
    if (error) return erroBanco(error, 'excluir');
    est.etiquetas = est.etiquetas.filter((x) => x !== t);
    est.cartoes.forEach((c) => { c.cartao_etiquetas = (c.cartao_etiquetas || []).filter((x) => x.etiqueta_id !== t.id); });
    renderEtiquetasEdicao();
  });
  $('form-etiqueta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { data, error } = await db.from('quadro_etiquetas').insert({ quadro_id: est.quadro.id, nome: $('etiqueta-nome').value.trim(), cor: corEscolhida($('etiqueta-cores')) }).select().single();
    if (error) return erroBanco(error, 'criar a etiqueta');
    est.etiquetas.push(data);
    $('etiqueta-nome').value = '';
    renderEtiquetasEdicao();
  });

  // ---- arquivados ----
  const dlgArq = $('dlg-arquivados');
  ligarDialogo(dlgArq);
  async function abrirArquivados() {
    dlgArq.showModal();
    $('lista-arquivados').innerHTML = '<li data-esqueleto-linha></li>';
    const [c, l] = await Promise.all([
      db.from('cartoes').select('id, titulo, arquivado_em, lista:quadro_listas(nome, arquivada_em)').eq('quadro_id', est.quadro.id).not('arquivado_em', 'is', null).order('arquivado_em', { ascending: false }),
      db.from('quadro_listas').select('id, nome, arquivada_em').eq('quadro_id', est.quadro.id).not('arquivada_em', 'is', null)
    ]);
    const itens = [
      ...(l.data || []).map((x) => `<li><span>${icone('quadros')}<strong>Lista: ${esc(x.nome)}</strong><small>arquivada ${esc(tempoRelativo(x.arquivada_em))}</small></span><button type="button" data-restaurar-lista="${esc(x.id)}">Restaurar</button></li>`),
      ...(c.data || []).map((x) => `<li><span>${icone('arquivar')}<strong>${esc(x.titulo)}</strong><small>${esc(x.lista ? x.lista.nome : '')} · arquivado ${esc(tempoRelativo(x.arquivado_em))}</small></span>
        <span class="pagina-acoes"><button type="button" data-abrir-arq="${esc(x.id)}">Abrir</button><button type="button" data-restaurar-cartao="${esc(x.id)}">Restaurar</button></span></li>`)
    ];
    $('lista-arquivados').innerHTML = itens.join('') || '<li class="nota">Nada arquivado neste quadro.</li>';
  }
  $('lista-arquivados').addEventListener('click', async (e) => {
    const rl = e.target.closest('[data-restaurar-lista]');
    const rc = e.target.closest('[data-restaurar-cartao]');
    const ab = e.target.closest('[data-abrir-arq]');
    if (rl) {
      const { error } = await db.from('quadro_listas').update({ arquivada_em: null }).eq('id', rl.dataset.restaurarLista);
      if (error) return erroBanco(error, 'restaurar');
    } else if (rc) {
      const { error } = await db.from('cartoes').update({ arquivado_em: null }).eq('id', rc.dataset.restaurarCartao);
      if (error) return erroBanco(error, 'restaurar');
    } else if (ab) { dlgArq.close(); abrirCartao(ab.dataset.abrirArq); return; } else return;
    toast('Restaurado.');
    await carregarQuadro();
    abrirArquivados();
  });

  // ---------------------------------------------------------------
  // Empresas
  // ---------------------------------------------------------------
  const dlgEmp = $('dlg-empresas');
  ligarDialogo(dlgEmp);
  $('btn-empresas-painel').addEventListener('click', () => { fecharPopovers(); abrirEmpresas(); });
  async function abrirEmpresas() {
    $('empresas-lista').innerHTML = '<li data-esqueleto-linha></li><li data-esqueleto-linha></li>';
    $('form-empresa').hidden = true;
    $('empresas-lista-painel').hidden = false;
    dlgEmp.showModal();
    est.clientes = null;
    await Promise.all([carregarEmpresas(), carregarClientesProjetos()]);
    renderEmpresas();
  }
  function renderEmpresas() {
    $('empresas-lista').innerHTML = est.empresas.map((x) => {
      const cl = est.clientes.filter((c) => c.empresa_id === x.id).length;
      const pj = est.projetos.filter((p) => p.empresa_id === x.id).length;
      return `<li><button type="button" data-empresa="${esc(x.id)}"><span class="qd-cor qd-cor-grande" style="--cor:${corHex(x.cor)}" aria-hidden="true">${esc(iniciais(x.nome))}</span>
        <span><strong>${esc(x.nome)}</strong><small>${cl} ${cl === 1 ? 'cliente' : 'clientes'} · ${pj} ${pj === 1 ? 'projeto' : 'projetos'}${x.site ? ' · ' + esc(x.site) : ''}</small></span>${icone('avancar')}</button></li>`;
    }).join('') || '<li class="qd-vazio-mini">Nenhuma empresa cadastrada. Crie a primeira para agrupar clientes e projetos.</li>';
  }
  $('empresas-lista').addEventListener('click', (e) => { const b = e.target.closest('[data-empresa]'); if (b) editarEmpresa(est.empresas.find((x) => x.id === b.dataset.empresa)); });
  $('btn-nova-empresa').addEventListener('click', () => editarEmpresa(null));
  $('btn-voltar-empresas').addEventListener('click', () => { $('form-empresa').hidden = true; $('empresas-lista-painel').hidden = false; renderEmpresas(); });
  async function editarEmpresa(x) {
    await carregarClientesProjetos();
    $('empresas-lista-painel').hidden = true;
    $('form-empresa').hidden = false;
    $('empresa-id').value = x ? x.id : '';
    $('empresa-nome').value = x ? x.nome : '';
    $('empresa-documento').value = x ? x.documento || '' : '';
    $('empresa-site').value = x ? x.site || '' : '';
    $('empresa-obs').value = x ? x.observacoes || '' : '';
    paleta($('empresa-cores'), Object.keys(CORES).find((k) => CORES[k].toLowerCase() === String(x ? x.cor : '').toLowerCase()) || 'azul', 'empresa-cor');
    const opc = (lista, campo, rot) => lista.map((i) => `<label><input type="checkbox" value="${esc(i.id)}"${x && i.empresa_id === x.id ? ' checked' : ''}> ${esc(rot(i))}${i.empresa_id && (!x || i.empresa_id !== x.id) ? ` <small>(${esc((est.empresas.find((e) => e.id === i.empresa_id) || {}).nome || 'outra')})</small>` : ''}</label>`).join('') || '<small>Nenhum.</small>';
    $('empresa-clientes').innerHTML = opc(est.clientes, 'empresa_id', (c) => c.nome || c.email);
    $('empresa-projetos').innerHTML = opc(est.projetos, 'empresa_id', (p) => (p.codigo ? p.codigo + ' · ' : '') + p.nome);
    $('btn-excluir-empresa').hidden = !x;
    $('btn-quadro-empresa').hidden = !x;
    $('empresa-nome').focus();
  }
  $('form-empresa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('empresa-id').value;
    const nome = $('empresa-nome').value.trim();
    if (!nome) { toast('Dê um nome à empresa.', 'erro'); return; }
    const dados = { nome, documento: $('empresa-documento').value.replace(/\D/g, '') || null, site: $('empresa-site').value.trim() || null, observacoes: $('empresa-obs').value.trim() || null, cor: CORES[corEscolhida($('empresa-cores'))] };
    ocupado($('btn-salvar-empresa'), true);
    const r = id ? await db.from('empresas').update(dados).eq('id', id).select().single() : await db.from('empresas').insert(dados).select().single();
    if (r.error) { ocupado($('btn-salvar-empresa'), false); return erroBanco(r.error, /uq_empresas_nome|duplicate/i.test(r.error.message) ? 'salvar: já existe uma empresa com esse nome' : 'salvar a empresa'); }
    const emp = r.data;
    const sincronizar = async (tabela, lista, caixa) => {
      const marcados = new Set([...$(caixa).querySelectorAll('input:checked')].map((i) => i.value));
      const entrar = lista.filter((i) => marcados.has(i.id) && i.empresa_id !== emp.id).map((i) => i.id);
      const sair = lista.filter((i) => !marcados.has(i.id) && i.empresa_id === emp.id).map((i) => i.id);
      if (entrar.length) await db.from(tabela).update({ empresa_id: emp.id }).in('id', entrar);
      if (sair.length) await db.from(tabela).update({ empresa_id: null }).in('id', sair);
    };
    await Promise.all([sincronizar('profiles', est.clientes, 'empresa-clientes'), sincronizar('projetos', est.projetos, 'empresa-projetos')]);
    ocupado($('btn-salvar-empresa'), false);
    toast('Empresa salva.');
    est.clientes = null;
    await Promise.all([carregarEmpresas(), carregarClientesProjetos(), carregarQuadros()]);
    editarEmpresa(est.empresas.find((x) => x.id === emp.id));
  });
  $('btn-excluir-empresa').addEventListener('click', async () => {
    const id = $('empresa-id').value;
    const x = est.empresas.find((e) => e.id === id);
    if (!confirm(`Excluir a empresa "${x.nome}"? Clientes e projetos continuam, só perdem o vínculo. O quadro da empresa também é excluído.`)) return;
    const { error } = await db.from('empresas').delete().eq('id', id);
    if (error) return erroBanco(error, 'excluir');
    await Promise.all([carregarEmpresas(), carregarQuadros()]);
    est.clientes = null; await carregarClientesProjetos();
    $('btn-voltar-empresas').click();
    if (est.quadro && est.quadro.empresa_id === id && est.quadro.tipo === 'empresa') abrirQuadro(est.quadros[0] && est.quadros[0].id);
  });
  $('btn-quadro-empresa').addEventListener('click', async () => {
    const id = $('empresa-id').value;
    let q = est.quadros.find((x) => x.tipo === 'empresa' && x.empresa_id === id);
    if (!q) {
      const emp = est.empresas.find((x) => x.id === id);
      const { data, error } = await db.from('quadros').insert({ tipo: 'empresa', empresa_id: id, nome: emp.nome, cor: emp.cor, criado_por: perfil.id }).select('id').single();
      if (error) return erroBanco(error, 'criar o quadro');
      await carregarQuadros();
      q = { id: data.id };
      toast('Quadro da empresa criado.');
    }
    dlgEmp.close();
    abrirQuadro(q.id);
  });

  // ---------------------------------------------------------------
  // Tempo real (outro admin mexeu no quadro)
  // ---------------------------------------------------------------
  let timerRecarga = null;
  function ouvirQuadro() {
    if (est.canal) db.removeChannel(est.canal);
    const id = est.quadro.id;
    const recarregar = () => {
      clearTimeout(timerRecarga);
      timerRecarga = setTimeout(() => {
        if (est.arrastando || document.querySelector('.qd-input-lista')) { recarregar(); return; }
        carregarQuadro();
      }, 700);
    };
    try {
      est.canal = db.channel('quadro-' + id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cartoes', filter: 'quadro_id=eq.' + id }, recarregar)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'quadro_listas', filter: 'quadro_id=eq.' + id }, recarregar)
        .subscribe();
    } catch (_) {}
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && est.quadro && !est.arrastando) carregarQuadro(); });

  // Atalho de teclado: "n" adiciona cartão na primeira lista
  document.addEventListener('keydown', (e) => {
    const digitando = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (digitando || document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'n' && est.visao === 'quadro' && est.listas.length) { e.preventDefault(); abrirFormCartao(document.querySelector('.qd-lista[data-lista]')); }
    if (e.key === 'f') { e.preventDefault(); $('busca-cartoes').focus(); }
  });

  // ---------------------------------------------------------------
  // Início
  // ---------------------------------------------------------------
  const [, okQuadros] = await Promise.all([carregarAdmins(), carregarQuadros()]);
  if (!okQuadros) { $('qd-kanban').removeAttribute('aria-busy'); $('qd-kanban').innerHTML = ''; return; }
  carregarClientesProjetos();
  carregarMinhas();
  if (params.get('busca')) { $('busca-cartoes').value = params.get('busca'); est.busca = params.get('busca'); }
  let guardado = null;
  try { guardado = localStorage.getItem('cmk_quadro_atual'); } catch (_) {}
  const inicial = params.get('quadro') || guardado;
  const visao = params.get('visao') || (() => { try { return localStorage.getItem('cmk_quadro_visao'); } catch (_) { return null; } })();
  if (visao && visao !== 'quadro') document.querySelector(`.qd-visoes [data-visao="${visao}"]`)?.click();
  await abrirQuadro(est.quadros.some((q) => q.id === inicial) ? inicial : est.quadros[0] && est.quadros[0].id, { manterCartao: true });
  if (params.get('cartao')) abrirCartao(params.get('cartao'));
})();
