// =====================================================================
// admin.js — Solicitações (admin). Cada card abre o modal de validação:
//   editar    -> itens com checkbox (remover selecionados), adicionar do
//                catálogo ou item personalizado, valor final e mensagem
//   adicionar -> busca no catálogo de serviços / item personalizado
//   resumo    -> conferência + prévia do comprovante antes de aprovar
//   concluido -> link do comprovante e WhatsApp do cliente
//   cancelar  -> motivo + mensagem (opcional: avisar pelo WhatsApp)
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
  const modal = document.getElementById('modal-solicitacao');
  const corpo = document.getElementById('modal-sol-corpo');
  const rodape = document.getElementById('modal-sol-rodape');
  const titulo = document.getElementById('modal-sol-titulo');
  const subtitulo = document.getElementById('modal-sol-sub');

  const LIMITE_LISTA = 100;
  let solicitacoes = [];
  let catalogo = null;
  let M = null; // estado do modal aberto
  let ultimoGatilho = null;

  const marcarPilulas = () => pilulas.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === filtro.value)));
  marcarPilulas();
  pilulas.forEach((b) => b.addEventListener('click', () => { filtro.value = b.dataset.status; marcarPilulas(); carregar(); }));
  busca.addEventListener('input', render);
  periodo.addEventListener('change', render);
  document.getElementById('barra-admin').addEventListener('submit', (e) => e.preventDefault());
  document.getElementById('btn-recarregar').addEventListener('click', () => { carregar(); carregarEventos(); contarPorStatus(); });
  lista.addEventListener('click', aoClicarNaLista);
  ligarModal();
  await Promise.all([carregar(), carregarEventos(), contarPorStatus()]);

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
    const status = ['em_validacao', 'aguardando_pagamento', 'paga', 'cancelada'];
    const NOMES = { em_validacao: 'Em validação', aguardando_pagamento: 'Pagamento liberado', paga: 'Pagas', cancelada: 'Canceladas' };
    const icones = { em_validacao: 'em-validacao', aguardando_pagamento: 'pagamentos', paga: 'aprovar', cancelada: 'cancelado' };
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
    const acao = s.status === 'em_validacao' ? 'Validar' : editavel ? 'Abrir e editar' : 'Ver detalhes';
    return `
      <article data-solicitacao="${esc(s.id)}">
        <header>
          <h2>${esc(s.codigo)}</h2>
          ${etiquetaStatus(s)}
          <span data-etiqueta="neutro">${s.estruturado ? 'Preço fechado' : 'Sob medida'}</span>
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
          <button type="button" data-abrir="${esc(s.id)}">${acao}</button>
          ${s.comprovante_token ? `<button type="button" data-reenviar="${esc(s.id)}">${icone('whatsapp')} Reenviar comprovante</button>
            <a href="comprovante.html?t=${encodeURIComponent(s.comprovante_token)}" target="_blank" rel="noopener">${icone('comprovante')} Ver comprovante</a>` : ''}
          ${s.aprovado_em ? `<small>Aprovada em ${fmtDataHora(s.aprovado_em)}${s.comprovante && s.comprovante.aprovado_por ? ' por ' + esc(s.comprovante.aprovado_por) : ''}</small>` : ''}
        </p>
      </article>`;
  }

  function etiquetaStatus(s) {
    if (s.status === 'aguardando_pagamento') {
      return s.aprovado_em ? '<span data-etiqueta="ok">Aprovada · pagamento liberado</span>'
        : '<span data-etiqueta="info">Aguardando pagamento (preço fechado)</span>';
    }
    const tipo = { em_validacao: 'atencao', paga: 'ok', cancelada: 'neutro' }[s.status] || 'neutro';
    return `<span data-etiqueta="${tipo}">${esc(rotulo('solicitacao', s.status))}</span>`;
  }

  function aoClicarNaLista(e) {
    const reenviarBtn = e.target.closest('[data-reenviar]');
    if (reenviarBtn) return reenviar(reenviarBtn.dataset.reenviar, reenviarBtn);
    const abrirBtn = e.target.closest('[data-abrir]');
    if (abrirBtn) return abrir(abrirBtn.dataset.abrir, abrirBtn);
    if (e.target.closest('a, button, input, select, textarea, summary')) return;
    const card = e.target.closest('article[data-solicitacao]');
    if (card) abrir(card.dataset.solicitacao, card.querySelector('[data-abrir]'));
  }

  // =================================================================
  // Modal: estado
  // =================================================================
  async function abrir(id, gatilho) {
    const s = solicitacoes.find((x) => x.id === id);
    if (!s) return;
    ultimoGatilho = gatilho || null;
    if (!catalogo) {
      const { data, error } = await db.from('catalogo_precos').select('*').eq('ativo', true).order('nome');
      catalogo = error ? [] : data;
    }
    const sel = s.selecao || {};
    const valorInicial = s.valor_final != null ? String(Number(s.valor_final)) : (Number(s.valor_calculado) > 0 ? String(Number(s.valor_calculado)) : '');
    M = {
      s,
      etapa: 'editar',
      editavel: solicitacaoEditavel(s),
      itens: {
        servicos: (sel.servicos || []).map((x) => ({ id: x.id, modelo: x.modelo || null, plano: x.plano || null })),
        complementos: (sel.complementos || []).map((x) => ({ id: x.id, qtd: Number(x.qtd) || 1 })),
        personalizados: (sel.personalizados || []).map((x) => ({ id: x.id, nome: x.nome, descricao: x.descricao || '', valor: Number(x.valor) }))
      },
      resumo: s.resumo || {},
      valorSugerido: Number(s.valor_calculado) || 0,
      tipoPreco: s.tipo_preco,
      valorFinal: valorInicial,
      valorEditado: s.valor_final != null && Number(s.valor_final) !== Number(s.valor_calculado),
      mensagem: s.observacao_admin || '',
      selecionados: new Set(),
      categoria: 'todos',
      busca: '',
      simulando: false,
      enviando: false,
      mudou: false,
      resultado: null
    };
    M.inicial = { itens: JSON.stringify(M.itens), valor: M.valorFinal, mensagem: M.mensagem };
    renderModal();
    modal.showModal();
    titulo.focus();
  }

  function sujo() {
    return Boolean(M) && (JSON.stringify(M.itens) !== M.inicial.itens || M.valorFinal !== M.inicial.valor || M.mensagem !== M.inicial.mensagem);
  }

  function tentarFechar() {
    if (!M) return modal.close();
    if (M.enviando) return;
    if (M.etapa !== 'concluido' && M.editavel && sujo()
      && !window.confirm('Há alterações não salvas nesta solicitação. Fechar mesmo assim e descartar?')) return;
    modal.close();
  }

  function ligarModal() {
    document.getElementById('modal-sol-fechar').addEventListener('click', tentarFechar);
    modal.addEventListener('cancel', (e) => { e.preventDefault(); tentarFechar(); }); // ESC
    modal.addEventListener('click', (e) => { if (e.target === modal) tentarFechar(); }); // clique fora
    modal.addEventListener('close', async () => {
      const mudou = M && M.mudou;
      const gatilho = ultimoGatilho;
      M = null;
      if (mudou) await carregar(); // a lista atrás reflete o novo estado (sem recarregar a página)
      if (gatilho && document.contains(gatilho)) gatilho.focus();
    });
    modal.addEventListener('click', aoClicarNoModal);
    modal.addEventListener('input', aoDigitarNoModal);
    modal.addEventListener('change', aoMudarNoModal);
    modal.addEventListener('submit', aoEnviarNoModal);
  }

  // =================================================================
  // Modal: telas
  // =================================================================
  function renderModal() {
    const s = M.s;
    titulo.textContent = s.codigo;
    subtitulo.innerHTML = `${etiquetaStatus(s)} <span data-etiqueta="neutro">${s.estruturado ? 'Preço fechado' : 'Sob medida'}</span>`;
    ({ editar: telaEditar, adicionar: telaAdicionar, resumo: telaResumo, concluido: telaConcluido, cancelar: telaCancelar })[M.etapa]();
  }

  function infoClienteHtml() {
    const s = M.s;
    const c = s.cliente || {};
    const fone = String(c.telefone || '').replace(/\D/g, '');
    return `
      <section data-modal-info aria-label="Cliente e pedido">
        <dl>
          <div><dt>Cliente</dt><dd>${esc(c.nome || '-')}</dd></div>
          <div><dt>E-mail</dt><dd>${esc(c.email || '-')}</dd></div>
          <div><dt>Telefone</dt><dd>${c.telefone ? esc(formatarTelefone(c.telefone)) + (fone ? ` · <a href="https://wa.me/55${esc(fone)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : '') : '<span>sem telefone</span>'}</dd></div>
          <div><dt>Pedido em</dt><dd>${fmtDataHora(s.created_at)}</dd></div>
          <div><dt>Origem</dt><dd>${s.origem === 'diagnostico' ? 'Diagnóstico da home' : 'Monte sua solução'}</dd></div>
          ${s.aprovado_em ? `<div><dt>Aprovada em</dt><dd>${fmtDataHora(s.aprovado_em)}${s.comprovante && s.comprovante.aprovado_por ? ' · ' + esc(s.comprovante.aprovado_por) : ''}</dd></div>` : ''}
        </dl>
        ${s.notas ? `<details><summary>Contexto informado pelo cliente</summary><p>${esc(s.notas)}</p></details>` : ''}
        ${s.status === 'cancelada' && s.motivo_cancelamento ? `<p data-motivo><small>Motivo do cancelamento:</small> ${esc(s.motivo_cancelamento)}</p>` : ''}
      </section>`;
  }

  // Linhas de itens a partir do resumo calculado (chave tipo:id)
  function linhasItens() {
    const r = M.resumo || {};
    const formato = (m) => (m === 'sob-medida' ? 'sob medida' : m === 'modelos-prontos' ? 'modelo pronto' : '');
    const preco = (p, t) => (p == null ? 'sob análise' : (t === 'from' ? 'a partir de ' : '') + brl(p));
    return [
      ...(r.itens || []).map((i) => ({
        chave: (i.personalizado ? 'personalizado:' : 'servico:') + i.id, nome: i.nome,
        detalhe: i.personalizado ? i.descricao || 'item personalizado' : formato(i.modelo), preco: preco(i.preco, i.tipo_preco),
        equipe: i.adicionado === 'equipe', personalizado: Boolean(i.personalizado)
      })),
      ...(r.mensais || []).map((m) => ({ chave: 'servico:' + m.id, nome: m.nome, detalhe: 'mensalidade após 3 meses grátis', preco: m.preco != null ? brl(m.preco) + '/mês' : 'mensal', equipe: m.adicionado === 'equipe' })),
      ...(r.complementos || []).map((c) => ({ chave: 'complemento:' + c.id, nome: c.nome, detalhe: 'complemento' + (c.quantidade > 1 ? ' × ' + c.quantidade : ''), preco: preco(c.preco, c.tipo_preco), equipe: c.adicionado === 'equipe', complemento: true }))
    ];
  }

  function telaEditar() {
    const linhas = linhasItens();
    const editavel = M.editavel;
    const n = M.selecionados.size;
    const todos = linhas.length > 0 && linhas.every((l) => M.selecionados.has(l.chave));
    const removidos = ((M.s.resumo || {}).removidos || []).slice(-6);
    corpo.innerHTML = `
      ${infoClienteHtml()}
      <section data-modal-itens aria-labelledby="titulo-itens-modal">
        <div data-itens-topo>
          <h3 id="titulo-itens-modal">Itens <small>(${linhas.length})</small></h3>
          ${editavel ? `<label data-sel-todos><input type="checkbox" id="sel-todos"${todos ? ' checked' : ''}${linhas.length ? '' : ' disabled'}> Selecionar todos</label>
            <button type="button" data-ir="adicionar">${icone('adicionar')} Adicionar funcionalidade</button>` : ''}
        </div>
        ${editavel ? `<div data-barra-selecao${n ? '' : ' hidden'} role="region" aria-label="Ações dos itens selecionados">
            <span>${n} ${n === 1 ? 'item selecionado' : 'itens selecionados'}</span>
            <button type="button" data-remover-selecionados>${icone('remover')} <span>Remover selecionados (${n})</span></button>
            <button type="button" data-limpar-selecao>Limpar seleção</button>
          </div>` : ''}
        <ul data-itens-modal${M.simulando ? ' aria-busy="true"' : ''}>
          ${linhas.length ? linhas.map((l) => `<li${M.selecionados.has(l.chave) ? ' data-marcado' : ''}>
              ${editavel ? `<input type="checkbox" id="it-${esc(l.chave)}" data-item-chave="${esc(l.chave)}"${M.selecionados.has(l.chave) ? ' checked' : ''}>` : ''}
              <label${editavel ? ` for="it-${esc(l.chave)}"` : ''}>
                <span data-item-nome>${l.complemento ? '+ ' : ''}${esc(l.nome)}</span>
                ${l.detalhe ? `<small>${esc(l.detalhe)}</small>` : ''}
                ${l.equipe ? '<small data-tag-equipe>adicionado pela equipe</small>' : ''}
              </label>
              <span data-item-preco>${esc(l.preco)}</span>
            </li>`).join('') : '<li data-vazio>Nenhum item. Adicione uma funcionalidade para poder aprovar.</li>'}
        </ul>
        ${removidos.length ? `<details data-removidos><summary>Itens retirados (${removidos.length})</summary><ul>${removidos.map((x) =>
          `<li>${esc(x.nome)} <small>— pel${x.por === 'equipe' ? 'a equipe' : 'o cliente'} em ${fmtData(x.em)}</small></li>`).join('')}</ul></details>` : ''}
      </section>
      <section data-modal-valores aria-label="Valor e mensagem">
        <p data-sugerido>Valor sugerido <small>(catálogo)</small>
          <strong id="valor-sugerido">${M.simulando ? 'recalculando...' : (M.tipoPreco === 'from' ? 'a partir de ' : '') + brl(M.valorSugerido)}</strong>
          ${editavel ? '<button type="button" data-usar-sugerido>Usar sugerido</button>' : ''}</p>
        <p>
          <label for="valor-final">Valor final (R$)${editavel ? ' <abbr title="obrigatório para aprovar">*</abbr>' : ''}</label>
          <input type="number" id="valor-final" min="0.01" max="1000000" step="0.01" inputmode="decimal" value="${esc(M.valorFinal)}"${editavel ? '' : ' disabled'} aria-describedby="ajuda-valor">
          <small id="ajuda-valor">${M.valorEditado ? 'Valor definido por você (não acompanha mais o sugerido).' : 'Acompanha o valor sugerido até você editar.'}</small>
        </p>
        <p>
          <label for="mensagem-cliente">Mensagem ao cliente (opcional)</label>
          <textarea id="mensagem-cliente" rows="3" maxlength="1000"${editavel ? '' : ' disabled'} aria-describedby="ajuda-msg">${esc(M.mensagem)}</textarea>
          <small id="ajuda-msg">Aparece em destaque no comprovante e no WhatsApp.</small>
        </p>
      </section>`;
    rodape.innerHTML = editavel ? `
        <button type="button" data-ir="cancelar" data-perigo>${icone('fechar')} Cancelar solicitação</button>
        <span data-espaco></span>
        <button type="button" data-salvar${sujoItens() ? '' : ' disabled'}>Salvar itens</button>
        <button type="button" data-ir="resumo" data-primario>${icone('aprovar')} Aprovar e liberar</button>`
      : `${M.s.comprovante_token ? `<button type="button" data-reenviar-modal>${icone('whatsapp')} Reenviar comprovante</button>
          <a href="comprovante.html?t=${encodeURIComponent(M.s.comprovante_token)}" target="_blank" rel="noopener">${icone('comprovante')} Ver comprovante</a>` : ''}
        <span data-espaco></span><button type="button" data-fechar>Fechar</button>`;
  }

  function sujoItens() {
    return JSON.stringify(M.itens) !== M.inicial.itens;
  }

  // ---------------- adicionar funcionalidade ----------------
  function opcoesCatalogo() {
    const out = [];
    for (const c of catalogo || []) {
      if (c.tipo === 'servico') {
        if (c.presenca_digital) {
          out.push({ tipo: 'servico', id: c.id, modelo: 'modelos-prontos', nome: c.nome, detalhe: 'Modelo pronto', preco: c.preco, tp: 'fixed' });
          out.push({ tipo: 'servico', id: c.id, modelo: 'sob-medida', nome: c.nome, detalhe: 'Sob medida', preco: c.preco_sob_medida, tp: 'from' });
        } else {
          out.push({ tipo: 'servico', id: c.id, modelo: null, nome: c.nome, detalhe: c.mensal ? 'Plano mensal' : 'Solução', preco: c.preco, tp: c.mensal ? 'mensal' : c.tipo_preco, mensal: c.mensal });
        }
      } else {
        out.push({ tipo: 'complemento', id: c.id, nome: c.nome, detalhe: 'Complemento', preco: c.preco, tp: c.tipo_preco });
      }
    }
    return out;
  }

  function permitidos(servicos) {
    const p = new Set(servicos.flatMap((s) => {
      const c = (catalogo || []).find((x) => x.id === s.id && x.tipo === 'servico');
      return c ? c.complementos_permitidos || [] : [];
    }));
    if (servicos.some((s) => s.id === 'automacao')) p.delete('automacao-extra');
    return p;
  }

  function bloqueio(op) {
    if (op.tipo === 'servico') {
      if (M.itens.servicos.some((x) => x.id === op.id)) return 'Já incluído';
      const mensalIncluido = M.itens.servicos.some((x) => (catalogo || []).find((c) => c.id === x.id && c.tipo === 'servico' && c.mensal));
      if (op.mensal && mensalIncluido) return 'Só um plano mensal por pedido';
      return null;
    }
    if (M.itens.complementos.some((x) => x.id === op.id)) return 'Já incluído';
    if (!permitidos(M.itens.servicos).has(op.id)) {
      const quem = (catalogo || []).filter((c) => c.tipo === 'servico' && (c.complementos_permitidos || []).includes(op.id)).map((c) => c.nome);
      return quem.length ? 'Requer: ' + quem.slice(0, 2).join(' ou ') + (quem.length > 2 ? '…' : '') : 'Indisponível para estes itens';
    }
    return null;
  }

  function telaAdicionar() {
    const cats = [['todos', 'Todos'], ['servico', 'Soluções'], ['complemento', 'Complementos'], ['personalizado', 'Personalizado']];
    corpo.innerHTML = `
      <section data-adicionar aria-labelledby="titulo-adicionar">
        <h3 id="titulo-adicionar" tabindex="-1">Adicionar funcionalidade</h3>
        <div role="group" aria-label="Tipo de item" data-categorias>
          ${cats.map(([v, t]) => `<button type="button" data-categoria="${v}" aria-pressed="${M.categoria === v}">${t}</button>`).join('')}
        </div>
        ${M.categoria === 'personalizado' ? `
          <form id="form-personalizado" novalidate>
            <p><label for="pers-nome">Nome do item</label><input type="text" id="pers-nome" maxlength="120" required placeholder="Ex.: Página extra de serviços"></p>
            <p><label for="pers-desc">Descrição curta (opcional)</label><input type="text" id="pers-desc" maxlength="300" placeholder="Ex.: layout igual à home, até 6 blocos"></p>
            <p><label for="pers-valor">Valor (R$)</label><input type="number" id="pers-valor" min="0.01" max="1000000" step="0.01" inputmode="decimal" required></p>
            <p><button type="submit">Adicionar item personalizado</button></p>
          </form>` : `
          <p><label for="busca-catalogo">Buscar no catálogo</label>
            <input type="search" id="busca-catalogo" value="${esc(M.busca)}" placeholder="Ex.: landing, loja, integração" autocomplete="off"></p>
          <ul data-catalogo aria-live="polite">${catalogoHtml()}</ul>`}
      </section>`;
    rodape.innerHTML = '<button type="button" data-ir="editar">← Voltar aos itens</button>';
  }

  function catalogoHtml() {
    const termo = normalizar(M.busca);
    const ops = opcoesCatalogo().filter((o) => (M.categoria === 'todos' || o.tipo === M.categoria)
      && (!termo || normalizar(o.nome + ' ' + o.detalhe).includes(termo)));
    if (!ops.length) return '<li data-vazio>Nada encontrado no catálogo. Use "Personalizado" para criar um item.</li>';
    const preco = (o) => (o.preco == null ? 'sob análise' : o.tp === 'mensal' ? brl(o.preco) + '/mês' : (o.tp === 'from' ? 'a partir de ' : '') + brl(o.preco));
    return ops.map((o, i) => {
      const motivo = bloqueio(o);
      return `<li>
          <span data-item-nome>${esc(o.nome)}</span>
          <small>${esc(o.detalhe)} · ${esc(preco(o))}</small>
          ${motivo ? `<span data-motivo-bloqueio>${esc(motivo)}</span>` : `<button type="button" data-adicionar-op="${i}" data-op='${esc(JSON.stringify({ tipo: o.tipo, id: o.id, modelo: o.modelo || null }))}' aria-label="Adicionar ${esc(o.nome)} (${esc(o.detalhe)})">Adicionar</button>`}
        </li>`;
    }).join('');
  }

  // ---------------- resumo (aprovar) ----------------
  function telaResumo() {
    const s = M.s;
    const linhas = linhasItens();
    const valor = valorNumero();
    const previa = Comprovante.previa({
      codigo: s.codigo, criadoEm: s.created_at, cliente: s.cliente || {}, resumo: M.resumo,
      valorFinal: valor, mensagem: M.mensagem.trim(), aprovadoPor: perfil.nome || perfil.email
    });
    const temFone = /\d{10,}/.test(String((s.cliente || {}).telefone || '').replace(/\D/g, ''));
    corpo.innerHTML = `
      <section data-resumo-aprovar aria-labelledby="titulo-resumo">
        <h3 id="titulo-resumo" tabindex="-1">Confira antes de liberar o pagamento</h3>
        <dl data-resumo-numeros>
          <div><dt>Itens</dt><dd>${linhas.length}</dd></div>
          <div><dt>Valor final</dt><dd><strong>${brl(valor)}</strong></dd></div>
          <div><dt>Mensagem ao cliente</dt><dd>${M.mensagem.trim() ? esc(M.mensagem.trim()) : '<small>sem mensagem (a seção não aparece no comprovante)</small>'}</dd></div>
        </dl>
        <h4>Prévia do comprovante</h4>
        <div data-previa>${Comprovante.html(previa, { codigo: 'liberado', texto: 'Aprovado · pagamento liberado' })}</div>
        <p data-opcao-whats>
          <input type="checkbox" id="abrir-whats" checked>
          <label for="abrir-whats">Abrir o WhatsApp do cliente com o link do comprovante ao confirmar</label>
        </p>
        ${temFone ? '' : '<p data-aviso-fone><small>O cliente não tem WhatsApp cadastrado: o WhatsApp abre para você escolher o contato.</small></p>'}
      </section>`;
    rodape.innerHTML = `
      <button type="button" data-ir="editar">← Voltar e editar</button>
      <span data-espaco></span>
      <button type="button" data-confirmar-aprovacao data-primario>${icone('aprovar')} Confirmar e liberar pagamento</button>`;
  }

  function telaConcluido() {
    const r = M.resultado;
    corpo.innerHTML = `
      <section data-concluido aria-labelledby="titulo-concluido">
        <p data-sucesso><span>${icone('aprovar', 'i-xl')}</span></p>
        <h3 id="titulo-concluido" tabindex="-1">Pedido ${esc(M.s.codigo)} aprovado</h3>
        <p>Pagamento de <strong>${brl(r.solicitacao.valor_final)}</strong> liberado para o cliente. O comprovante foi gerado${r.janelaAberta ? ' e o WhatsApp foi aberto em outra aba' : ''}.</p>
        <p data-link-comprovante>
          <label for="link-comprovante">Link do comprovante</label>
          <input type="text" id="link-comprovante" readonly value="${esc(r.comprovante_url)}">
          <button type="button" data-copiar-link>${icone('copiar')} <span>Copiar link</span></button>
        </p>
        <p data-acoes-concluido>
          <a href="${esc(r.whatsapp_url)}" target="_blank" rel="noopener noreferrer" data-whats>${icone('whatsapp')} ${r.janelaAberta ? 'Abrir WhatsApp de novo' : 'Enviar pelo WhatsApp'}</a>
          <a href="${esc(r.comprovante_url)}" target="_blank" rel="noopener">${icone('comprovante')} Ver comprovante</a>
        </p>
        ${r.cliente_sem_telefone ? '<p><small>O cliente não tem WhatsApp cadastrado: escolha o contato no WhatsApp.</small></p>' : ''}
      </section>`;
    rodape.innerHTML = '<span data-espaco></span><button type="button" data-fechar data-primario>Fechar</button>';
  }

  function telaCancelar() {
    corpo.innerHTML = `
      <section data-cancelar-etapa aria-labelledby="titulo-cancelar">
        <h3 id="titulo-cancelar" tabindex="-1">Cancelar ${esc(M.s.codigo)}?</h3>
        <p>O cliente não poderá mais pagar esta solicitação e qualquer cobrança pendente é cancelada. Ele é avisado na plataforma.</p>
        <p><label for="motivo-cancelamento">Motivo (opcional, fica só para a equipe)</label>
          <textarea id="motivo-cancelamento" rows="2" maxlength="500" placeholder="Ex.: cliente desistiu; escopo fora do que atendemos"></textarea></p>
        <p><label for="mensagem-cancelamento">Mensagem ao cliente (opcional)</label>
          <textarea id="mensagem-cancelamento" rows="3" maxlength="1000">${esc(M.mensagem)}</textarea></p>
        <p data-opcao-whats id="linha-whats-cancelar"${M.mensagem.trim() ? '' : ' hidden'}>
          <input type="checkbox" id="whats-cancelar" checked>
          <label for="whats-cancelar">Avisar o cliente pelo WhatsApp com esta mensagem</label>
        </p>
      </section>`;
    rodape.innerHTML = `
      <button type="button" data-ir="editar">← Voltar</button>
      <span data-espaco></span>
      <button type="button" data-confirmar-cancelamento data-perigo>Confirmar cancelamento</button>`;
  }

  function irPara(etapa) {
    if (etapa === 'resumo') {
      const linhas = linhasItens();
      if (M.simulando) return toast('Aguarde o recálculo terminar.', 'erro');
      if (!linhas.length) return toast('Adicione pelo menos um item antes de aprovar.', 'erro');
      if (!(valorNumero() > 0)) {
        toast('Informe um valor final maior que zero.', 'erro');
        document.getElementById('valor-final').focus();
        return;
      }
    }
    M.etapa = etapa;
    renderModal();
    const foco = corpo.querySelector('h3[tabindex]') || titulo;
    foco.focus();
  }

  // =================================================================
  // Modal: eventos (delegados)
  // =================================================================
  function aoClicarNoModal(e) {
    if (!M) return;
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.ir) return irPara(b.dataset.ir);
    if (b.hasAttribute('data-fechar')) return tentarFechar();
    if (b.hasAttribute('data-limpar-selecao')) { M.selecionados.clear(); return renderModal(); }
    if (b.hasAttribute('data-remover-selecionados')) return removerSelecionados();
    if (b.hasAttribute('data-usar-sugerido')) {
      M.valorFinal = M.valorSugerido > 0 ? String(M.valorSugerido) : '';
      M.valorEditado = false;
      return renderModal();
    }
    if (b.hasAttribute('data-salvar')) return salvarItens(b);
    if (b.dataset.categoria) { M.categoria = b.dataset.categoria; return renderModal(); }
    if (b.dataset.adicionarOp) return adicionarDoCatalogo(JSON.parse(b.dataset.op));
    if (b.hasAttribute('data-confirmar-aprovacao')) return aprovar(b);
    if (b.hasAttribute('data-confirmar-cancelamento')) return cancelar(b);
    if (b.hasAttribute('data-reenviar-modal')) return reenviar(M.s.id, b);
    if (b.hasAttribute('data-copiar-link')) return copiarLink(b);
  }

  function aoDigitarNoModal(e) {
    if (!M) return;
    const t = e.target;
    if (t.id === 'valor-final') {
      M.valorFinal = t.value;
      M.valorEditado = true;
      document.getElementById('ajuda-valor').textContent = 'Valor definido por você (não acompanha mais o sugerido).';
    } else if (t.id === 'mensagem-cliente') {
      M.mensagem = t.value;
    } else if (t.id === 'mensagem-cancelamento') {
      document.getElementById('linha-whats-cancelar').hidden = !t.value.trim();
    } else if (t.id === 'busca-catalogo') {
      M.busca = t.value;
      corpo.querySelector('[data-catalogo]').innerHTML = catalogoHtml();
    }
  }

  function aoMudarNoModal(e) {
    if (!M) return;
    const t = e.target;
    if (t.dataset.itemChave) {
      if (t.checked) M.selecionados.add(t.dataset.itemChave); else M.selecionados.delete(t.dataset.itemChave);
      atualizarSelecao();
    } else if (t.id === 'sel-todos') {
      M.selecionados = new Set(t.checked ? linhasItens().map((l) => l.chave) : []);
      corpo.querySelectorAll('[data-item-chave]').forEach((c) => { c.checked = t.checked; });
      atualizarSelecao();
    }
  }

  // Atualiza só a barra de seleção (sem redesenhar a lista e perder o foco)
  function atualizarSelecao() {
    const n = M.selecionados.size;
    const barra = corpo.querySelector('[data-barra-selecao]');
    barra.hidden = !n;
    barra.querySelector('span').textContent = `${n} ${n === 1 ? 'item selecionado' : 'itens selecionados'}`;
    barra.querySelector('[data-remover-selecionados] span').textContent = `Remover selecionados (${n})`;
    corpo.querySelectorAll('[data-item-chave]').forEach((c) => c.closest('li').toggleAttribute('data-marcado', c.checked));
    const todos = corpo.querySelector('#sel-todos');
    const total = linhasItens().length;
    todos.checked = n > 0 && n === total;
    todos.indeterminate = n > 0 && n < total;
  }

  function aoEnviarNoModal(e) {
    if (!M || e.target.id !== 'form-personalizado') return;
    e.preventDefault();
    const nome = document.getElementById('pers-nome').value.trim();
    const descricao = document.getElementById('pers-desc').value.trim();
    const valor = Number(String(document.getElementById('pers-valor').value).replace(',', '.'));
    if (nome.length < 2) { toast('Dê um nome ao item.', 'erro'); return document.getElementById('pers-nome').focus(); }
    if (!(valor > 0)) { toast('Informe um valor maior que zero.', 'erro'); return document.getElementById('pers-valor').focus(); }
    const novo = clonar(M.itens);
    novo.personalizados.push({ id: 'custom-' + Math.random().toString(36).slice(2, 12).padEnd(8, '0'), nome, descricao, valor: Math.round(valor * 100) / 100 });
    aplicarItens(novo, `"${nome}" adicionado.`, true);
  }

  // =================================================================
  // Modal: ações
  // =================================================================
  async function removerSelecionados() {
    const chaves = [...M.selecionados];
    if (!chaves.length) return;
    const nomes = linhasItens().filter((l) => M.selecionados.has(l.chave)).map((l) => l.nome);
    const novo = clonar(M.itens);
    for (const chave of chaves) {
      const [tipo, id] = chave.split(':');
      if (tipo === 'servico') novo.servicos = novo.servicos.filter((x) => x.id !== id);
      if (tipo === 'complemento') novo.complementos = novo.complementos.filter((x) => x.id !== id);
      if (tipo === 'personalizado') novo.personalizados = novo.personalizados.filter((x) => x.id !== id);
    }
    if (!novo.servicos.length && !novo.personalizados.length) {
      return toast('Mantenha pelo menos uma solução. Para desistir de tudo, use "Cancelar solicitação".', 'erro');
    }
    if (!window.confirm(`Remover ${chaves.length === 1 ? '"' + nomes[0] + '"' : chaves.length + ' itens'} desta solicitação?\n\nO valor sugerido é recalculado. Nada é salvo até você aprovar ou clicar em "Salvar itens".`)) return;
    // complementos que dependiam do que saiu saem junto
    const ok = permitidos(novo.servicos);
    const junto = novo.complementos.filter((c) => !ok.has(c.id)).map((c) => ((catalogo || []).find((x) => x.id === c.id && x.tipo === 'complemento') || { nome: c.id }).nome);
    novo.complementos = novo.complementos.filter((c) => ok.has(c.id));
    M.selecionados.clear();
    await aplicarItens(novo, `${chaves.length === 1 ? 'Item removido' : chaves.length + ' itens removidos'}.${junto.length ? ' Também saiu: ' + junto.join(', ') + '.' : ''}`);
  }

  function adicionarDoCatalogo(op) {
    const novo = clonar(M.itens);
    if (op.tipo === 'servico') novo.servicos.push({ id: op.id, modelo: op.modelo || null });
    else novo.complementos.push({ id: op.id, qtd: 1 });
    const nome = ((catalogo || []).find((c) => c.id === op.id && c.tipo === op.tipo) || { nome: op.id }).nome;
    aplicarItens(novo, `"${nome}" adicionado.`, true);
  }

  // Recalcula no servidor (sem gravar) e atualiza lista + valor sugerido
  async function aplicarItens(novo, mensagemOk, voltarParaItens) {
    const anterior = M.itens;
    M.itens = novo;
    M.simulando = true;
    if (voltarParaItens) M.etapa = 'editar';
    renderModal();
    try {
      const r = await api('admin-solicitacao', { acao: 'simular', solicitacao_id: M.s.id, itens: novo });
      if (!M) return;
      M.resumo = r.resumo;
      M.valorSugerido = Number(r.valor) || 0;
      M.tipoPreco = r.tipo_preco;
      if (!M.valorEditado) M.valorFinal = M.valorSugerido > 0 ? String(M.valorSugerido) : '';
      toast(mensagemOk);
    } catch (e) {
      if (!M) return;
      M.itens = anterior;
      toast(e.message, 'erro');
    }
    M.simulando = false;
    renderModal();
    if (voltarParaItens) (corpo.querySelector('[data-ir="adicionar"]') || titulo).focus();
  }

  async function salvarItens(btn) {
    if (M.enviando) return;
    M.enviando = true;
    ocupado(btn, true, 'Salvando...');
    try {
      const r = await api('admin-solicitacao', { acao: 'salvar', solicitacao_id: M.s.id, updated_at: M.s.updated_at, itens: M.itens });
      M.s = { ...M.s, ...r.solicitacao };
      M.resumo = M.s.resumo;
      M.inicial.itens = JSON.stringify(M.itens);
      M.mudou = true;
      M.enviando = false;
      toast(r.solicitacao.status === 'em_validacao' ? 'Itens salvos. A solicitação está em validação.' : 'Itens salvos. Novo valor já liberado ao cliente.');
      renderModal();
    } catch (e) {
      M.enviando = false;
      ocupado(btn, false);
      toast(e.message, 'erro');
    }
  }

  async function aprovar(btn) {
    if (M.enviando) return;
    M.enviando = true;
    ocupado(btn, true, 'Liberando...');
    // a aba do WhatsApp é aberta no clique (senão o navegador bloqueia o pop-up)
    const querWhats = document.getElementById('abrir-whats').checked;
    const janela = querWhats ? window.open('about:blank', '_blank') : null;
    try {
      const r = await api('admin-solicitacao', {
        acao: 'aprovar', solicitacao_id: M.s.id, updated_at: M.s.updated_at, itens: M.itens,
        valor_final: valorNumero(), mensagem: M.mensagem.trim()
      });
      if (janela) { janela.opener = null; janela.location.href = r.whatsapp_url; }
      M.s = { ...M.s, ...r.solicitacao };
      M.resultado = { ...r, janelaAberta: Boolean(janela) };
      M.mudou = true;
      M.enviando = false;
      M.etapa = 'concluido';
      M.inicial = { itens: JSON.stringify(M.itens), valor: M.valorFinal, mensagem: M.mensagem };
      renderModal();
      document.getElementById('titulo-concluido').focus();
      toast('Pagamento liberado e comprovante gerado.');
    } catch (e) {
      if (janela) janela.close();
      M.enviando = false;
      ocupado(btn, false);
      toast(e.message, 'erro');
    }
  }

  async function cancelar(btn) {
    if (M.enviando) return;
    const mensagem = document.getElementById('mensagem-cancelamento').value.trim();
    const motivo = document.getElementById('motivo-cancelamento').value.trim();
    const querWhats = Boolean(mensagem) && document.getElementById('whats-cancelar').checked;
    M.enviando = true;
    ocupado(btn, true, 'Cancelando...');
    const janela = querWhats ? window.open('about:blank', '_blank') : null;
    try {
      const r = await api('admin-solicitacao', { acao: 'cancelar', solicitacao_id: M.s.id, updated_at: M.s.updated_at, motivo, mensagem });
      if (janela && r.whatsapp_url) { janela.opener = null; janela.location.href = r.whatsapp_url; } else if (janela) janela.close();
      M.mudou = true;
      M.enviando = false;
      M.inicial = { itens: JSON.stringify(M.itens), valor: M.valorFinal, mensagem: M.mensagem };
      modal.close();
      toast(`Solicitação cancelada.${querWhats ? ' O WhatsApp foi aberto para avisar o cliente.' : ''}`);
    } catch (e) {
      if (janela) janela.close();
      M.enviando = false;
      ocupado(btn, false);
      toast(e.message, 'erro');
    }
  }

  async function reenviar(id, btn) {
    ocupado(btn, true, 'Abrindo...');
    const janela = window.open('about:blank', '_blank');
    try {
      const r = await api('admin-solicitacao', { acao: 'reenviar', solicitacao_id: id });
      if (janela) { janela.opener = null; janela.location.href = r.whatsapp_url; } else window.open(r.whatsapp_url, '_blank', 'noopener');
      toast('WhatsApp aberto com o link do comprovante.');
    } catch (e) {
      if (janela) janela.close();
      toast(e.message, 'erro');
    }
    ocupado(btn, false);
  }

  async function copiarLink(btn) {
    const campo = document.getElementById('link-comprovante');
    try {
      await navigator.clipboard.writeText(campo.value);
    } catch (_) {
      campo.select();
      document.execCommand('copy');
    }
    const rotulo = btn.querySelector('span');
    rotulo.textContent = 'Copiado!';
    setTimeout(() => { rotulo.textContent = 'Copiar link'; }, 2000);
  }

  function valorNumero() {
    const v = Number(String(M.valorFinal || '').replace(',', '.'));
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }

  // =================================================================
  // Avisos do Mercado Pago
  // =================================================================
  async function carregarEventos() {
    const corpoTabela = document.getElementById('tabela-eventos');
    const { data, error } = await db.from('pagamento_eventos').select('*').order('created_at', { ascending: false }).limit(30);
    if (error) {
      corpoTabela.innerHTML = `<tr><td colspan="6">Erro: ${esc(error.message)}</td></tr>`;
      return;
    }
    corpoTabela.innerHTML = data.length ? data.map((e) => `<tr>
        <td>${fmtDataHora(e.created_at)}</td><td>${esc(e.origem)}</td><td>${esc(e.mp_payment_id || '-')}</td>
        <td>${esc(e.status_mp || '-')}${e.status_detalhe ? ' <small>(' + esc(e.status_detalhe) + ')</small>' : ''}</td>
        <td>${e.valor_mp != null ? brl(e.valor_mp) : '-'}</td><td><strong>${esc(e.resultado || '-')}</strong></td>
      </tr>`).join('') : '<tr><td colspan="6">Nenhum aviso ainda.</td></tr>';
  }
})();

function clonar(o) {
  return JSON.parse(JSON.stringify(o));
}
function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
