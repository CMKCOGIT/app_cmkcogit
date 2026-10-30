// =====================================================================
// admin-clientes.js — aba "Clientes" do admin: todos os clientes (cards ou
// tabela), busca em tempo real por projeto/código/cliente, filtros rápidos e
// o detalhe de cada cliente/projeto, onde o admin atualiza % e status
// (admin_atualizar_andamento, sql/13). Pagamento aqui é só visualização.
// =====================================================================
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;

  const lista = document.getElementById('lista-clientes');
  const busca = document.getElementById('busca');
  const contagem = document.getElementById('contagem');
  const dialogo = document.getElementById('detalhe-cliente');
  const CHAVE_VISAO = 'cogit_clientes_visao_v1';

  const params = new URLSearchParams(window.location.search);
  const filtros = { pagamento: null, andamento: null, prazo: null };
  const FILTRO_GRUPO = { pago: 'pagamento', pendente: 'pagamento', andamento: 'andamento', concluido: 'andamento', atrasado: 'prazo', prazo7: 'prazo' };
  (params.get('filtro') || '').split(',').forEach((f) => { if (FILTRO_GRUPO[f]) filtros[FILTRO_GRUPO[f]] = f; });
  busca.value = params.get('busca') || '';
  let visao = params.get('visao') || lerLocal(CHAVE_VISAO) || 'cards';
  let clientes = [];
  let abertoId = null;

  const [perfis, projs, pags, sols, funcs] = await Promise.all([
    db.from('profiles').select('id, nome, email, telefone, role, created_at').order('nome'),
    db.from('projetos').select('*, projeto_etapas(status), solicitacao:solicitacoes!projetos_solicitacao_fk(codigo, resumo)')
      .order('created_at', { ascending: false }),
    db.from('pagamentos').select('id, cliente_id, projeto_id, valor, status, descricao, pago_em, created_at'),
    db.from('solicitacoes').select('cliente_id, status'),
    db.from('projeto_funcionalidades').select('projeto_id, valor, status, funcionalidades(nome)')
  ]);
  lista.removeAttribute('aria-busy');
  const falha = [perfis, projs, pags, sols, funcs].find((r) => r.error);
  if (falha) {
    mostrarErro('Não foi possível carregar: ' + falha.error.message);
    lista.innerHTML = '';
    return;
  }

  clientes = montarClientes();
  resumoGeral();
  ligarControles();
  render();

  // ---------------- dados ----------------
  function montarClientes() {
    const soma = (arr) => arr.reduce((t, p) => t + Number(p.valor || 0), 0);
    return perfis.data.filter((c) => c.role !== 'admin').map((c) => {
      const pagamentos = pags.data.filter((p) => p.cliente_id === c.id);
      const projetos = projs.data.filter((p) => p.cliente_id === c.id).map((p) => enriquecer(p, pagamentos));
      return {
        ...c,
        projetos,
        pago: soma(pagamentos.filter((p) => p.status === 'pago')),
        aberto: soma(pagamentos.filter((p) => p.status === 'pendente')),
        solicitacoesAbertas: sols.data.filter((s) => s.cliente_id === c.id && (s.status === 'em_validacao' || s.status === 'aguardando_pagamento')).length,
        texto: normalizar([c.nome, c.email, c.telefone].join(' '))
      };
    });
  }

  function enriquecer(p, pagamentosCliente) {
    const pagamentos = pagamentosCliente.filter((x) => x.projeto_id === p.id);
    const itens = (p.solicitacao && p.solicitacao.resumo && p.solicitacao.resumo.itens) || [];
    const solucao = itens.length ? itens.map((i) => i.nome).join(' + ') : rotulo('tipo', p.tipo);
    return {
      ...p,
      pagamentos,
      extras: funcs.data.filter((f) => f.projeto_id === p.id),
      pagoProjeto: pagamentos.filter((x) => x.status === 'pago').reduce((t, x) => t + Number(x.valor), 0),
      solucao,
      texto: normalizar([p.nome, p.codigo, solucao, p.dominio].join(' '))
    };
  }

  function resumoGeral() {
    const todos = clientes.flatMap((c) => c.projetos);
    const ativos = todos.filter(ativo).length;
    const atrasados = todos.filter((p) => prazoDe(p).estado === 'atrasado').length;
    const recebido = clientes.reduce((t, c) => t + c.pago, 0);
    const aReceber = clientes.reduce((t, c) => t + c.aberto, 0);
    const ul = document.getElementById('resumo-admin');
    ul.innerHTML = [
      { rotulo: 'Clientes', valor: clientes.length, icone: 'clientes', destaque: true, nota: 'com cadastro concluído' },
      { rotulo: 'Projetos em andamento', valor: ativos, icone: 'projetos', nota: todos.length + ' no total' },
      { rotulo: 'Atrasados', valor: atrasados, icone: 'alerta', nota: 'prazo de entrega vencido', alerta: atrasados ? 'perigo' : '' },
      { rotulo: 'Recebido', valor: recebido, formato: 'brl', icone: 'aprovar', nota: 'pagamentos confirmados' },
      { rotulo: 'A receber', valor: aReceber, formato: 'brl', icone: 'recibo', nota: 'cobranças em aberto' }
    ].map(kpiHtml).join('');
    animarNumeros(ul);
  }

  // ---------------- filtros e busca ----------------
  function ligarControles() {
    busca.addEventListener('input', () => { render(); salvarUrl(); });
    document.getElementById('barra-clientes').addEventListener('submit', (e) => e.preventDefault());
    document.querySelectorAll('[data-filtro]').forEach((b) => b.addEventListener('click', () => {
      const g = b.dataset.grupo;
      filtros[g] = filtros[g] === b.dataset.filtro ? null : b.dataset.filtro;
      render();
      salvarUrl();
    }));
    document.querySelectorAll('[data-visao]').forEach((b) => b.addEventListener('click', () => {
      visao = b.dataset.visao;
      try { localStorage.setItem(CHAVE_VISAO, visao); } catch (_) {}
      render();
    }));

    lista.addEventListener('click', (e) => {
      const alvo = e.target.closest('[data-abrir-cliente], [data-abrir-projeto]');
      if (!alvo) return;
      abrirCliente(alvo.dataset.cliente, alvo.dataset.abrirProjeto || null);
    });
    document.getElementById('fechar-detalhe').addEventListener('click', () => dialogo.close());
    dialogo.addEventListener('click', (e) => { if (e.target === dialogo) dialogo.close(); }); // clique fora
    dialogo.addEventListener('close', () => { abertoId = null; });
  }

  function salvarUrl() {
    const q = new URLSearchParams();
    if (busca.value.trim()) q.set('busca', busca.value.trim());
    const f = Object.values(filtros).filter(Boolean);
    if (f.length) q.set('filtro', f.join(','));
    history.replaceState(null, '', window.location.pathname + (q.toString() ? '?' + q : ''));
  }

  function projetoPassa(p) {
    if (filtros.pagamento === 'pago' && p.status_pagamento !== 'pago') return false;
    if (filtros.pagamento === 'pendente' && !['pendente', 'parcial', 'atrasado'].includes(p.status_pagamento)) return false;
    if (filtros.andamento === 'andamento' && !ativo(p)) return false;
    if (filtros.andamento === 'concluido' && p.status_projeto !== 'concluido') return false;
    if (filtros.prazo === 'atrasado' && prazoDe(p).estado !== 'atrasado') return false;
    if (filtros.prazo === 'prazo7' && !['hoje', 'proximo'].includes(prazoDe(p).estado)) return false;
    return true;
  }

  function visiveis() {
    const termo = normalizar(busca.value.trim());
    const temFiltro = Object.values(filtros).some(Boolean);
    return clientes.map((c) => {
      const clienteBate = !termo || c.texto.includes(termo);
      const projetos = c.projetos.filter((p) => projetoPassa(p) && (clienteBate || p.texto.includes(termo)));
      const mostrar = projetos.length > 0 || (!temFiltro && clienteBate);
      return mostrar ? { cliente: c, projetos } : null;
    }).filter(Boolean);
  }

  // ---------------- lista ----------------
  function render() {
    document.querySelectorAll('[data-filtro]').forEach((b) => b.setAttribute('aria-pressed', String(filtros[b.dataset.grupo] === b.dataset.filtro)));
    document.querySelectorAll('[data-visao]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.visao === visao)));
    lista.dataset.visao = visao;

    const itens = visiveis();
    const nProjetos = itens.reduce((t, i) => t + i.projetos.length, 0);
    contagem.textContent = `${itens.length} ${itens.length === 1 ? 'cliente' : 'clientes'} · ${nProjetos} ${nProjetos === 1 ? 'projeto' : 'projetos'}`;

    if (!itens.length) {
      const temBusca = busca.value.trim() || Object.values(filtros).some(Boolean);
      lista.innerHTML = temBusca
        ? `<p data-vazio><strong>Nenhum projeto encontrado.</strong><br>Tente outro nome, código ou cliente, ou limpe os filtros.
             <br><button type="button" id="limpar-filtros">Limpar busca e filtros</button></p>`
        : '<p data-vazio>Nenhum cliente cadastrado ainda.</p>';
      const limpar = document.getElementById('limpar-filtros');
      if (limpar) limpar.addEventListener('click', () => {
        busca.value = '';
        Object.keys(filtros).forEach((k) => { filtros[k] = null; });
        render();
        salvarUrl();
        busca.focus();
      });
      return;
    }
    lista.innerHTML = visao === 'tabela' ? tabelaHtml(itens) : itens.map(cardHtml).join('');
  }

  function cardHtml({ cliente: c, projetos }) {
    const ocultos = c.projetos.length - projetos.length;
    return `<article data-cliente-card="${esc(c.id)}">
        <header>
          <span data-avatar aria-hidden="true">${esc(iniciais(c.nome || c.email))}</span>
          <div>
            <h2><button type="button" data-abrir-cliente data-cliente="${esc(c.id)}">${esc(c.nome || '(sem nome)')}</button></h2>
            <p>${esc(c.email || '')}${c.telefone ? ' · ' + whatsapp(c) : ''}</p>
          </div>
        </header>
        <ul data-numeros>
          <li><span>Projetos</span><strong>${c.projetos.length}</strong></li>
          <li><span>Total pago</span><strong>${brl(c.pago)}</strong></li>
          <li><span>Em aberto</span><strong>${brl(c.aberto)}</strong></li>
        </ul>
        ${projetos.length ? `<ul data-projetos>${projetos.map((p) => `
          <li><button type="button" data-abrir-projeto="${esc(p.id)}" data-cliente="${esc(c.id)}">
            <span data-nome>${esc(p.nome)} ${p.codigo ? `<small>${esc(p.codigo)}</small>` : ''}</span>
            <span data-progresso>${barraProgresso(progressoProjeto(p))}</span>
            <span data-etiquetas>${etiquetas(p)}</span>
          </button></li>`).join('')}</ul>` : '<p><small>Sem projetos ainda.</small></p>'}
        ${ocultos > 0 ? `<p><small>+ ${ocultos} ${ocultos === 1 ? 'projeto fora' : 'projetos fora'} da busca/filtro</small></p>` : ''}
        ${c.solicitacoesAbertas ? `<p><small><a href="admin.html">${c.solicitacoesAbertas} ${c.solicitacoesAbertas === 1 ? 'solicitação aberta' : 'solicitações abertas'}</a></small></p>` : ''}
      </article>`;
  }

  function tabelaHtml(itens) {
    return `<table id="tabela-clientes">
        <thead><tr><th scope="col">Cliente</th><th scope="col">E-mail</th><th scope="col">WhatsApp</th><th scope="col">Projetos</th>
          <th scope="col">Total pago</th><th scope="col">Em aberto</th><th scope="col"><span class="so-leitor">Ações</span></th></tr></thead>
        <tbody>${itens.map(({ cliente: c, projetos }) => `<tr>
          <td><strong>${esc(c.nome || '(sem nome)')}</strong>${projetos.length ? `<br><small>${projetos.map((p) => esc(p.codigo || p.nome)).join(', ')}</small>` : ''}</td>
          <td>${esc(c.email || '-')}</td>
          <td>${c.telefone ? whatsapp(c) : '-'}</td>
          <td>${projetos.length === c.projetos.length ? c.projetos.length : projetos.length + ' de ' + c.projetos.length}</td>
          <td>${brl(c.pago)}</td>
          <td>${brl(c.aberto)}</td>
          <td><button type="button" data-abrir-cliente data-cliente="${esc(c.id)}">Abrir</button></td>
        </tr>`).join('')}</tbody>
      </table>`;
  }

  // ---------------- detalhe do cliente / projeto ----------------
  async function abrirCliente(clienteId, projetoId) {
    const c = clientes.find((x) => x.id === clienteId);
    if (!c) return;
    abertoId = c.id;
    document.getElementById('detalhe-titulo').textContent = c.nome || c.email || 'Cliente';
    renderDetalhe(c);
    if (!dialogo.open) dialogo.showModal();
    if (projetoId) {
      const alvo = document.getElementById('projeto-' + projetoId);
      if (alvo) { alvo.scrollIntoView({ block: 'start' }); alvo.setAttribute('aria-current', 'true'); }
    }
    const atualizacoes = await carregarAtualizacoes(c);
    if (abertoId === c.id) preencherAtualizacoes(c, atualizacoes);
  }

  function renderDetalhe(c) {
    const conteudo = document.getElementById('detalhe-conteudo');
    conteudo.innerHTML = `
      <section id="detalhe-contato" aria-label="Contato e valores">
        <p>${esc(c.email || '')}${c.telefone ? ' · ' + esc(formatarTelefone(c.telefone)) + ' · ' + whatsapp(c) : ''} · cliente desde ${fmtData(c.created_at)}</p>
        <ul data-numeros>
          <li><span>Projetos</span><strong>${c.projetos.length}</strong></li>
          <li><span>Total pago</span><strong>${brl(c.pago)}</strong></li>
          <li><span>Em aberto</span><strong>${brl(c.aberto)}</strong></li>
        </ul>
        ${c.solicitacoesAbertas ? `<p><a href="admin.html">${c.solicitacoesAbertas} ${c.solicitacoesAbertas === 1 ? 'solicitação aberta' : 'solicitações abertas'} em Solicitações</a></p>` : ''}
      </section>
      ${c.projetos.length ? c.projetos.map(projetoHtml).join('') : '<p data-vazio>Este cliente ainda não tem projetos.</p>'}`;
    conteudo.querySelectorAll('form[data-andamento]').forEach(ligarFormAndamento);
  }

  function projetoHtml(p) {
    const pz = prazoDe(p);
    const pct = progressoProjeto(p);
    const extras = p.extras.length
      ? '<br><small>Extras: ' + p.extras.map((f) => esc(f.funcionalidades ? f.funcionalidades.nome : 'Funcionalidade') + ' (' + esc(rotulo('funcionalidade', f.status)) + ')').join(', ') + '</small>' : '';
    const fechado = p.status_projeto === 'cancelado';
    return `<article id="projeto-${esc(p.id)}" data-projeto>
        <header>
          <h3>${esc(p.nome)}</h3>
          ${p.codigo ? `<span data-codigo>${esc(p.codigo)}</span>` : ''}
          <span data-etiquetas>${etiquetas(p)}</span>
        </header>
        <dl>
          <dt>Solução contratada</dt><dd>${esc(p.solucao)}${p.solicitacao ? ` <small>(${esc(p.solicitacao.codigo)})</small>` : ''}${extras}</dd>
          <dt>Pagamento</dt><dd>${etiquetaPagamento(p.status_pagamento)} <small>${brl(p.pagoProjeto)} pago de ${brl(p.valor_total)}</small></dd>
          <dt>Valor</dt><dd>${brl(p.valor_total)}</dd>
          <dt>Prazo</dt><dd>${p.previsao_entrega ? fmtData(p.previsao_entrega) + ' · ' : ''}<span data-prazo="${pz.estado}">${esc(pz.texto)}</span></dd>
          <dt>Progresso</dt><dd>${barraProgresso(pct)}</dd>
          <dt>Status</dt><dd>${esc(rotulo('projeto', p.status_projeto))} · etapa ${Number(p.etapa_atual)} de 8</dd>
          <dt>Início</dt><dd>${fmtData(p.created_at)}</dd>
        </dl>
        <form data-andamento="${esc(p.id)}">
          <h4>Atualizar andamento</h4>
          <p>
            <label for="pct-${esc(p.id)}">Progresso: <output id="saida-${esc(p.id)}" for="pct-${esc(p.id)}">${pct}%</output></label>
            <input type="range" id="pct-${esc(p.id)}" name="progresso" min="0" max="100" step="5" value="${pct}"${fechado ? ' disabled' : ''}>
          </p>
          <p>
            <label for="st-${esc(p.id)}">Status</label>
            <select id="st-${esc(p.id)}" name="status">
              ${['em_andamento', 'aguardando_cliente', 'pausado', 'concluido', 'cancelado'].map((s) =>
                `<option value="${s}"${s === p.status_projeto ? ' selected' : ''}>${esc(rotulo('projeto', s))}</option>`).join('')}
            </select>
          </p>
          <p data-acoes>
            <button type="submit">Salvar andamento</button>
            ${p.status_projeto !== 'concluido' && !fechado ? '<button type="button" data-concluir>Concluir projeto (100%)</button>' : ''}
          </p>
          <p data-dica><small>100% conclui o projeto e registra a data de conclusão.</small></p>
        </form>
        <h4>Últimas atualizações</h4>
        <ul data-atualizacoes="${esc(p.id)}"><li data-esqueleto-linha></li><li data-esqueleto-linha></li></ul>
        <p><a href="projeto.html?id=${encodeURIComponent(p.id)}">Abrir página completa do projeto</a> <small>(etapas, repositório e pendências)</small></p>
      </article>`;
  }

  function ligarFormAndamento(form) {
    const id = form.dataset.andamento;
    const faixa = form.elements.progresso;
    const status = form.elements.status;
    const saida = form.querySelector('output');
    faixa.addEventListener('input', () => {
      saida.textContent = faixa.value + '%';
      if (faixa.value === '100') status.value = 'concluido';
      else if (status.value === 'concluido') status.value = 'em_andamento';
    });
    status.addEventListener('change', () => {
      if (status.value === 'concluido') { faixa.value = '100'; saida.textContent = '100%'; }
    });
    const concluir = form.querySelector('[data-concluir]');
    if (concluir) concluir.addEventListener('click', () => {
      faixa.value = '100';
      status.value = 'concluido';
      saida.textContent = '100%';
      form.requestSubmit();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pct = Number(faixa.value);
      const st = status.value;
      if (st === 'concluido' && !window.confirm('Concluir este projeto? O cliente será avisado e a data de conclusão fica registrada.')) return;
      const botoes = [...form.querySelectorAll('button')];
      botoes.forEach((b) => { b.disabled = true; });
      mostrarErro('');
      const { data, error } = await db.rpc('admin_atualizar_andamento', {
        p_id: id, p_progresso: faixa.disabled ? null : pct, p_status: st
      });
      botoes.forEach((b) => { b.disabled = false; });
      if (error) {
        const msg = /admin_atualizar_andamento|function/i.test(error.message)
          ? 'Rode o sql/13_painel_admin.sql no Supabase para atualizar o andamento.' : error.message;
        mostrarAvisoDialogo('Não foi possível salvar: ' + msg, true);
        return;
      }
      aplicarAtualizacao(id, data);
      mostrarAvisoDialogo(data.status_projeto === 'concluido' ? 'Projeto concluído.' : 'Andamento salvo.');
    });
  }

  function aplicarAtualizacao(id, novo) {
    const c = clientes.find((x) => x.projetos.some((p) => p.id === id));
    if (!c) return;
    const p = c.projetos.find((x) => x.id === id);
    Object.assign(p, novo);
    p.projeto_etapas = null; // as etapas mudaram no banco; o % vem do campo progresso
    resumoGeral();
    render();
    const rolagem = dialogo.querySelector('#detalhe-conteudo').scrollTop;
    renderDetalhe(c);
    dialogo.querySelector('#detalhe-conteudo').scrollTop = rolagem;
    carregarAtualizacoes(c).then((a) => { if (abertoId === c.id) preencherAtualizacoes(c, a); });
    const alvo = document.getElementById('projeto-' + id);
    if (alvo) alvo.setAttribute('aria-current', 'true');
  }

  function mostrarAvisoDialogo(texto, erro) {
    let el = document.getElementById('aviso-detalhe');
    if (!el) {
      el = document.createElement('p');
      el.id = 'aviso-detalhe';
      dialogo.querySelector('header').after(el);
    }
    el.setAttribute('role', erro ? 'alert' : 'status');
    el.dataset.tipo = erro ? 'erro' : 'ok';
    el.textContent = texto;
  }

  // Arquivos, pendências, pagamentos e marcos do projeto, do mais novo ao mais antigo
  async function carregarAtualizacoes(c) {
    const ids = c.projetos.map((p) => p.id);
    if (!ids.length) return { arquivos: [], pendencias: [] };
    const [arqs, pend] = await Promise.all([
      db.from('arquivos').select('projeto_id, nome, origem, created_at').in('projeto_id', ids).order('created_at', { ascending: false }).limit(60),
      db.from('pendencias').select('projeto_id, titulo, resolvida, created_at').in('projeto_id', ids).order('created_at', { ascending: false }).limit(60)
    ]);
    return { arquivos: arqs.error ? [] : arqs.data, pendencias: pend.error ? [] : pend.data, erro: arqs.error || pend.error };
  }

  function preencherAtualizacoes(c, { arquivos, pendencias, erro }) {
    c.projetos.forEach((p) => {
      const ul = dialogo.querySelector(`[data-atualizacoes="${CSS.escape(p.id)}"]`);
      if (!ul) return;
      const eventos = [
        ...arquivos.filter((a) => a.projeto_id === p.id).map((a) => ({
          quando: a.created_at, tipo: 'arquivo', texto: (a.origem === 'cliente' ? 'Cliente enviou: ' : 'Equipe enviou: ') + a.nome })),
        ...pendencias.filter((x) => x.projeto_id === p.id).map((x) => ({
          quando: x.created_at, tipo: 'pendencia', texto: 'Pendência ' + (x.resolvida ? 'resolvida: ' : 'aberta: ') + x.titulo })),
        ...p.pagamentos.filter((x) => x.status === 'pago' && x.pago_em).map((x) => ({
          quando: x.pago_em, tipo: 'pagamento', texto: 'Pagamento confirmado: ' + brl(x.valor) })),
        ...(p.concluido_em ? [{ quando: p.concluido_em, tipo: 'concluido', texto: 'Projeto concluído' }] : []),
        { quando: p.created_at, tipo: 'projeto', texto: 'Projeto iniciado' }
      ].sort((a, b) => new Date(b.quando) - new Date(a.quando)).slice(0, 6);
      ul.innerHTML = eventos.map((ev) => `<li data-tipo="${ev.tipo}">${esc(ev.texto)} <small>${esc(tempoRelativo(ev.quando))}</small></li>`).join('')
        + (erro ? '<li><small>Parte do histórico não carregou.</small></li>' : '');
    });
  }

  // ---------------- apresentação ----------------
  function etiquetas(p) {
    const pz = prazoDe(p);
    return etiquetaPagamento(p.status_pagamento)
      + `<span data-etiqueta="${p.status_projeto === 'concluido' ? 'ok' : ativo(p) ? 'info' : 'neutro'}">${esc(rotulo('projeto', p.status_projeto))}</span>`
      + (pz.estado === 'atrasado' || pz.estado === 'proximo' || pz.estado === 'hoje'
        ? `<span data-etiqueta="${pz.estado === 'atrasado' ? 'perigo' : 'atencao'}">${esc(pz.curto)}</span>` : '');
  }

  function etiquetaPagamento(st) {
    const tipo = st === 'pago' ? 'ok' : st === 'pendente' || st === 'parcial' ? 'atencao' : st === 'atrasado' ? 'perigo' : 'neutro';
    return `<span data-etiqueta="${tipo}">Pagamento ${esc(rotulo('status_pagamento', st).toLowerCase())}</span>`;
  }

  function whatsapp(c) {
    const fone = String(c.telefone || '').replace(/\D/g, '');
    if (!fone) return '';
    return `<a href="https://wa.me/55${esc(fone)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`;
  }

  function lerLocal(chave) { try { return localStorage.getItem(chave); } catch (_) { return null; } }
})();

function ativo(p) {
  return p.status_projeto !== 'concluido' && p.status_projeto !== 'cancelado';
}

// Prazo de entrega: dias restantes e estado visual
function prazoDe(p) {
  if (p.status_projeto === 'concluido') {
    return { estado: 'concluido', texto: p.concluido_em ? 'Concluído em ' + fmtData(p.concluido_em) : 'Concluído', curto: 'Concluído' };
  }
  if (p.status_projeto === 'cancelado') return { estado: 'cancelado', texto: 'Cancelado', curto: 'Cancelado' };
  if (!p.previsao_entrega) return { estado: 'sem', texto: 'Previsão a definir', curto: 'Sem prazo' };
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dias = Math.round((new Date(p.previsao_entrega + 'T00:00:00') - hoje) / 86400000);
  if (dias < 0) {
    const n = -dias;
    return { estado: 'atrasado', texto: `Atrasado há ${n} ${n === 1 ? 'dia' : 'dias'}`, curto: `Atrasado ${n}d` };
  }
  if (dias === 0) return { estado: 'hoje', texto: 'Entrega hoje', curto: 'Entrega hoje' };
  return {
    estado: dias <= 7 ? 'proximo' : 'ok',
    texto: `Faltam ${dias} ${dias === 1 ? 'dia' : 'dias'}`,
    curto: `${dias} ${dias === 1 ? 'dia' : 'dias'}`
  };
}

function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function iniciais(nome) {
  const partes = String(nome || '?').trim().split(/[\s@.]+/).filter(Boolean);
  return ((partes[0] || '?')[0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}
