// =====================================================================
// admin-pagamentos.js — aba "Pagamentos" do admin: todas as cobranças
// (solicitações, funcionalidades e renovações), filtros, busca, "verificar no
// Mercado Pago", os pagamentos que precisam de revisão (sql/33) com
// "marcar como resolvido" (sql/34) e os últimos avisos do Mercado Pago.
// =====================================================================
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;

  const params = new URLSearchParams(window.location.search);
  const busca = document.getElementById('busca');
  const tabela = document.getElementById('tabela-pagamentos');
  const contagem = document.getElementById('contagem');
  busca.value = params.get('busca') || '';
  let status = ['pendente', 'pago', 'cancelado', 'reembolsado'].includes(params.get('filtro')) ? params.get('filtro') : 'todas';
  let periodo = 0;
  let pagamentos = [];
  let eventos = [];

  ligarPilulas('filtro-status', 'status', (v) => { status = v; render(); }, status);
  ligarPilulas('filtro-periodo', 'periodo', (v) => { periodo = Number(v); render(); }, '0');
  busca.addEventListener('input', render);
  document.getElementById('barra-pagamentos').addEventListener('submit', (e) => e.preventDefault());
  document.getElementById('btn-recarregar').addEventListener('click', carregar);
  await carregar();
  if (params.get('ver') === 'problemas') document.getElementById('secao-problemas').scrollIntoView({ block: 'start' });

  async function carregar() {
    mostrarErro('');
    const [pg, ev] = await Promise.all([
      db.from('pagamentos')
        .select('*, cliente:profiles!pagamentos_cliente_id_fkey(id, nome, email, telefone), solicitacao:solicitacoes!pagamentos_solicitacao_id_fkey(id, codigo, status), projeto:projetos!pagamentos_projeto_id_fkey(id, codigo, nome)')
        .order('created_at', { ascending: false }).limit(1000),
      db.from('pagamento_eventos').select('*').order('created_at', { ascending: false }).limit(300)
    ]);
    if (pg.error || ev.error) {
      mostrarErro('Não foi possível carregar: ' + (pg.error || ev.error).message);
      tabela.innerHTML = '';
      return;
    }
    pagamentos = (pg.data || []).map((p) => ({
      ...p,
      texto: normalizar([p.descricao, p.cliente && p.cliente.nome, p.cliente && p.cliente.email, p.solicitacao && p.solicitacao.codigo, p.projeto && p.projeto.codigo, p.mp_payment_id].join(' '))
    }));
    eventos = ev.data || [];
    renderResumo();
    renderProblemas();
    render();
    renderEventos();
  }

  // ---------------- resumo ----------------
  function renderResumo() {
    const mes = new Date(); mes.setDate(1); mes.setHours(0, 0, 0, 0);
    const soma = (lista) => lista.reduce((t, p) => t + Number(p.valor || 0), 0);
    const pagosMes = pagamentos.filter((p) => p.status === 'pago' && new Date(p.pago_em || p.created_at) >= mes);
    const abertos = pagamentos.filter((p) => p.status === 'pendente');
    const vencidos = abertos.filter(vencida);
    const problemas = problemasAbertos();
    document.getElementById('resumo-pagamentos').innerHTML = [
      { rotulo: 'Recebido no mês', valor: soma(pagosMes), formato: 'brl', icone: 'pagamentos', destaque: true, nota: pagosMes.length + (pagosMes.length === 1 ? ' pagamento' : ' pagamentos') },
      { rotulo: 'Em aberto', valor: soma(abertos), formato: 'brl', icone: 'recibo', nota: abertos.length ? abertos.length + ' cobrança(s), ' + vencidos.length + ' vencida(s)' : 'nada em aberto', alerta: vencidos.length ? 'atencao' : null },
      { rotulo: 'Precisam de revisão', valor: problemas.length, icone: 'alerta', nota: problemas.length ? 'veja a lista abaixo' : 'nenhum problema', alerta: problemas.length ? 'perigo' : null },
      { rotulo: 'Estornado (total)', valor: soma(pagamentos.filter((p) => p.status === 'reembolsado')), formato: 'brl', icone: 'cancelado' }
    ].map(kpiHtml).join('');
    animarNumeros(document.getElementById('resumo-pagamentos'));
  }

  // ---------------- problemas (revisão) ----------------
  function problemasAbertos() {
    // um item por pagamento do Mercado Pago + resultado (avisos repetidos contam uma vez)
    const vistos = new Set();
    return eventos.filter((e) => PROBLEMAS_PAGAMENTO.includes(e.resultado) && !e.revisado_em).filter((e) => {
      const chave = (e.mp_payment_id || e.id) + ':' + e.resultado;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
  }

  function renderProblemas() {
    const lista = problemasAbertos();
    const secao = document.getElementById('secao-problemas');
    secao.hidden = !lista.length;
    if (!lista.length) return;
    const porId = Object.fromEntries(pagamentos.map((p) => [p.id, p]));
    const ul = document.getElementById('lista-problemas');
    ul.innerHTML = lista.map((e) => {
      const p = porId[e.pagamento_id] || {};
      const c = p.cliente || {};
      return `<li data-tom="perigo">
        <span><strong>${esc(ROTULO_RESULTADO_MP[e.resultado] || e.resultado)} · ${e.valor_mp != null ? brl(e.valor_mp) : '-'}</strong>
          <small>${esc(p.descricao || 'Cobrança removida')}${c.nome ? ' · ' + esc(c.nome) : ''} · Mercado Pago nº ${esc(e.mp_payment_id || '-')} · ${fmtDataHora(e.created_at)}</small>
          <small>${esc(orientacao(e.resultado))}</small></span>
        <span class="acoes">${linkDestino(p)}
          <button type="button" data-resolver="${esc(e.id)}">${icone('aprovar')} Marcar como resolvido</button></span>
      </li>`;
    }).join('');
    ul.querySelectorAll('[data-resolver]').forEach((b) => b.addEventListener('click', () => resolver(b)));
  }

  function orientacao(resultado) {
    switch (resultado) {
      case 'valor_divergente': return 'O valor pago não é o da cobrança. Estorne no Mercado Pago ou ajuste com o cliente.';
      case 'pago_em_duplicidade': return 'A cobrança já estava paga. Estorne o pagamento repetido no Mercado Pago.';
      case 'solicitacao_nao_liberada': return 'Pagaram antes da aprovação da CMK. Analise e aprove a solicitação ou estorne.';
      default: return 'A cobrança não estava mais em aberto. Estorne no Mercado Pago ou gere uma nova cobrança com o cliente.';
    }
  }

  async function resolver(btn) {
    const nota = window.prompt('O que foi feito? (ex.: estornado no Mercado Pago em 24/11)', '');
    if (nota === null) return;
    ocupado(btn, true, 'Salvando...');
    const { error } = await db.rpc('admin_resolver_problema_pagamento', { p_evento_id: Number(btn.dataset.resolver), p_nota: nota });
    if (error) {
      ocupado(btn, false);
      mostrarErro(/admin_resolver_problema_pagamento/.test(error.message) ? 'Falta atualizar o banco: rode o sql/34_admin_revisao_pagamentos.sql.' : 'Não foi possível salvar: ' + error.message);
      return;
    }
    toast('Marcado como resolvido.');
    await carregar();
  }

  // ---------------- tabela de cobranças ----------------
  function render() {
    const q = normalizar(busca.value.trim());
    const limite = periodo ? Date.now() - periodo * 86400000 : 0;
    const visiveis = pagamentos.filter((p) => (status === 'todas' || p.status === status)
      && (!q || p.texto.includes(q))
      && (!limite || new Date(p.pago_em || p.created_at).getTime() >= limite));
    contagem.textContent = pagamentos.length ? `${visiveis.length} de ${pagamentos.length} cobranças` : '';
    if (!visiveis.length) {
      tabela.innerHTML = `<tr><td colspan="6"><p class="widget-vazio">${pagamentos.length ? 'Nenhuma cobrança com esse filtro.' : 'Nenhuma cobrança ainda.'}</p></td></tr>`;
      return;
    }
    tabela.innerHTML = visiveis.map((p) => {
      const c = p.cliente || {};
      const data = p.status === 'pago' ? 'Pago em ' + fmtData(p.pago_em) : p.status === 'pendente' && p.vencimento ? 'Vence em ' + fmtData(p.vencimento) : fmtData(p.created_at);
      const extra = [
        p.status === 'pendente' && vencida(p) ? '<span data-etiqueta="atencao">Vencida</span>' : '',
        p.status === 'pendente' && p.solicitacao && p.solicitacao.status !== 'aguardando_pagamento' ? '<span data-etiqueta="neutro">Aguardando aprovação</span>' : '',
        p.status === 'pendente' && !p.link_pagamento ? '<small>Cliente ainda não abriu o pagamento</small>' : '',
        p.status === 'pendente' && p.mp_ultimo_status ? `<small>Última tentativa: ${esc(rotulo('mp', p.mp_ultimo_status))}</small>` : '',
        p.metodo ? `<small>${esc(rotulo('metodo', p.metodo))}</small>` : ''
      ].join('');
      return `<tr>
        <td data-rotulo="Cobrança" class="celula-cobranca"><span class="codigo">${esc(origem(p))}</span><strong>${esc(semCodigo(p))}</strong></td>
        <td data-rotulo="Cliente" class="celula-cliente">${esc(c.nome || '-')}<small>${esc(c.email || '')}</small></td>
        <td data-rotulo="Valor" class="num">${brl(p.valor)}</td>
        <td data-rotulo="Status">${etiquetaStatus('pagamento', p.status)}${extra}</td>
        <td data-rotulo="Data">${data}</td>
        <td data-rotulo="Ações" class="acoes">${linkDestino(p)}${p.status === 'pendente' || p.status === 'pago'
          ? `<button type="button" class="botao-icone" data-verificar="${esc(p.id)}" aria-label="Consultar no Mercado Pago" title="Consultar no Mercado Pago">${icone('recarregar')}</button>` : ''}</td>
      </tr>`;
    }).join('');
    tabela.querySelectorAll('[data-verificar]').forEach((b) => b.addEventListener('click', () => verificar(b)));
  }

  function vencida(p) {
    return p.status === 'pendente' && p.vencimento && p.vencimento < new Date().toISOString().slice(0, 10);
  }

  // a descrição já começa com o código da solicitação ("PLN-2026-0005 — Landing Page"): não repete
  function semCodigo(p) {
    const cod = p.solicitacao && p.solicitacao.codigo;
    const d = String(p.descricao || '');
    return cod && d.startsWith(cod) ? d.slice(cod.length).replace(/^\s*[—-]\s*/, '') || d : d;
  }

  function origem(p) {
    if (p.solicitacao) return p.solicitacao.codigo;
    if (p.projeto_funcionalidade_id) return 'Funcionalidade' + (p.projeto && p.projeto.codigo ? ' · ' + p.projeto.codigo : '');
    if (p.assinatura_id) return 'Renovação' + (p.projeto && p.projeto.codigo ? ' · ' + p.projeto.codigo : '');
    return (p.projeto && p.projeto.codigo) || 'Cobrança';
  }

  function linkDestino(p) {
    if (p.solicitacao) return `<a class="botao-link" data-secundario href="admin-solicitacao.html?id=${encodeURIComponent(p.solicitacao.id)}">Solicitação</a>`;
    const projeto = p.projeto ? p.projeto.id : p.projeto_id;
    if (projeto) return `<a class="botao-link" data-secundario href="projeto.html?id=${encodeURIComponent(projeto)}">Projeto</a>`;
    return '';
  }

  async function verificar(btn) {
    ocupado(btn, true, '');
    try {
      const r = await api('verificar-pagamento', { pagamento_id: btn.dataset.verificar });
      toast(r.resultado === 'nenhum_pagamento_encontrado'
        ? 'Nenhum pagamento no Mercado Pago para esta cobrança.'
        : 'Mercado Pago: ' + rotulo('mp', r.mp_status) + ' · ' + (ROTULO_RESULTADO_MP[r.resultado] || r.resultado));
      await carregar();
    } catch (e) {
      ocupado(btn, false);
      mostrarErro(e.message);
    }
  }

  // ---------------- avisos do Mercado Pago ----------------
  function renderEventos() {
    const corpo = document.getElementById('tabela-eventos');
    const ultimos = eventos.slice(0, 40);
    corpo.innerHTML = ultimos.length ? ultimos.map((e) => `<tr>
        <td data-rotulo="Quando">${fmtDataHora(e.created_at)}</td>
        <td data-rotulo="Origem">${esc(ROTULO_ORIGEM_MP[e.origem] || e.origem)}</td>
        <td data-rotulo="Mercado Pago">${esc(rotulo('mp', e.status_mp))}${e.mp_payment_id ? ` <small>nº ${esc(e.mp_payment_id)}</small>` : ''}</td>
        <td data-rotulo="Valor" class="num">${e.valor_mp != null ? brl(e.valor_mp) : '-'}</td>
        <td data-rotulo="Resultado">${PROBLEMAS_PAGAMENTO.includes(e.resultado)
          ? `<span data-etiqueta="${e.revisado_em ? 'neutro' : 'perigo'}">${esc(ROTULO_RESULTADO_MP[e.resultado] || e.resultado)}${e.revisado_em ? ' (resolvido)' : ''}</span>`
          : esc(ROTULO_RESULTADO_MP[e.resultado] || e.resultado || '-')}</td>
      </tr>`).join('') : '<tr><td colspan="5">Nenhum aviso ainda.</td></tr>';
  }

  function ligarPilulas(id, campo, aoMudar, inicial) {
    const grupo = document.getElementById(id);
    const botoes = [...grupo.querySelectorAll('[data-' + campo + ']')];
    const marcar = (v) => botoes.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[campo] === v)));
    marcar(String(inicial));
    botoes.forEach((b) => b.addEventListener('click', () => { marcar(b.dataset[campo]); aoMudar(b.dataset[campo]); }));
  }
})();

function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
