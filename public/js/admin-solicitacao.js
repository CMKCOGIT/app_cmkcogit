// =====================================================================
// admin-solicitacao.js — projeto de uma solicitação (só admin)
// Cliente, formato, modelo, personalização (cores, textos, imagens, prévia),
// versões, histórico e ações: iniciar análise, aprovar (libera o pagamento),
// solicitar ajustes e enviar observação. Cada ação fica registrada com o admin e a data
// (api/admin-solicitacao.js -> solicitacao_eventos).
// =====================================================================
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;

  const id = new URLSearchParams(location.search).get('id') || '';
  const principal = document.getElementById('sol-principal');
  const acoes = document.getElementById('sol-acoes');
  const historico = document.getElementById('sol-historico');
  let s = null;
  let versoes = [];
  let dadosAtuais = null;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    principal.innerHTML = '<p data-vazio>Solicitação não informada. <a href="admin.html">Voltar para Solicitações</a>.</p>';
    principal.removeAttribute('aria-busy');
    return;
  }

  async function carregar() {
    mostrarErro('');
    const [sol, ev, ve] = await Promise.all([
      db.from('solicitacoes').select('*, cliente:profiles!solicitacoes_cliente_id_fkey(nome, email, telefone, documento), pagamentos(id, status, valor, metodo, pago_em)').eq('id', id).maybeSingle(),
      db.from('solicitacao_eventos').select('*').eq('solicitacao_id', id).order('created_at', { ascending: false }),
      db.from('solicitacao_versoes').select('*').eq('solicitacao_id', id).order('numero', { ascending: false })
    ]);
    principal.removeAttribute('aria-busy');
    if (sol.error || !sol.data) {
      principal.innerHTML = '<p data-vazio>Solicitação não encontrada.</p>';
      mostrarErro(sol.error ? 'Não foi possível carregar: ' + sol.error.message : '');
      return;
    }
    s = sol.data;
    versoes = ve.error ? [] : (ve.data || []);
    if (ev.error || ve.error) mostrarErro('Histórico e versões indisponíveis: rode o sql/32_analise_aprovacao.sql no Supabase.');
    const sel = s.selecao || {};
    const versaoAtual = Number(s.versao_atual) || 1;
    const atual = versoes.find((v) => v.numero === versaoAtual);
    const personalizada = atual ? atual.personalizada : sel.personalizacao === true;
    dadosAtuais = personalizada ? await baixarPersonalizacao(s.id, versaoAtual) : null;
    render(ev.error ? [] : (ev.data || []), personalizada);
  }

  function render(eventos, personalizada) {
    const c = s.cliente || {};
    const sel = s.selecao || {};
    const r = s.resumo || {};
    const itens = [...(r.itens || []), ...(r.mensais || []), ...(r.complementos || [])];
    const modelo = (r.itens || []).find((i) => i.variante);
    const formato = (r.itens || []).map((i) => (i.modelo === 'sob-medida' ? 'Sob medida' : i.modelo === 'modelos-prontos' ? 'Modelo pronto' : '')).find(Boolean) || '—';
    document.getElementById('titulo-sol').textContent = 'Projeto ' + s.codigo;
    document.getElementById('sub-sol').innerHTML = `${etiquetaStatus('solicitacao', s.status)} · enviada em ${fmtDataHora(s.created_at)} · versão ${Number(s.versao_atual) || 1}`;
    const fone = String(c.telefone || '').replace(/\D/g, '');

    principal.innerHTML = `
      <section class="cartao" aria-labelledby="t-cliente">
        <h2 id="t-cliente">Cliente</h2>
        <dl class="dados-grade">
          <div><dt>Nome</dt><dd>${esc(c.nome || '-')}</dd></div>
          <div><dt>E-mail</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '-'}</dd></div>
          <div><dt>Telefone</dt><dd>${c.telefone ? esc(formatarTelefone(c.telefone)) + (fone ? ` · <a href="https://wa.me/55${esc(fone)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : '') : '-'}</dd></div>
          <div><dt>CPF/CNPJ</dt><dd>${esc(mascararDocumento(c.documento) || '-')}</dd></div>
        </dl>
      </section>
      <section class="cartao" aria-labelledby="t-pedido">
        <h2 id="t-pedido">Solicitação</h2>
        <dl class="dados-grade">
          <div><dt>Formato</dt><dd>${esc(formato)}</dd></div>
          <div><dt>Modelo</dt><dd>${modelo ? esc(modelo.variante_nome || modelo.variante) : '—'}</dd></div>
          <div><dt>Data</dt><dd>${fmtDataHora(s.created_at)}</dd></div>
          <div><dt>Status</dt><dd>${etiquetaStatus('solicitacao', s.status)}</dd></div>
          <div><dt>Valor de referência</dt><dd>${brl(s.valor_calculado)}</dd></div>
          <div><dt>Valor aprovado</dt><dd>${s.valor_final != null ? brl(s.valor_final) : '—'}</dd></div>
        </dl>
        <p><strong>Itens:</strong> ${itens.map((i) => esc(i.nome + (i.variante_nome ? ' (' + i.variante_nome + ')' : ''))).join(', ') || '—'}</p>
        ${s.notas ? `<details><summary>Contexto informado pelo cliente</summary><p class="texto-livre">${esc(s.notas)}</p></details>` : ''}
      </section>
      <section class="cartao" aria-labelledby="t-pers">
        <div class="cartao-topo">
          <h2 id="t-pers">Personalização do site</h2>
          ${personalizada && dadosAtuais ? '<button type="button" id="btn-visualizar">' + icone('externo') + ' Visualizar projeto</button>' : ''}
        </div>
        ${'personalizacao' in sel || modelo ? (personalizada
          ? personalizacaoHtml(dadosAtuais)
          : '<p class="aviso-destaque"><strong>Enviada sem personalização.</strong> O cliente escolheu o modelo e não personalizou o site. Os textos e as imagens precisam ser combinados com ele.</p>')
          : '<p data-vazio>Esta solicitação não usa modelo pronto com editor.</p>'}
      </section>
      ${versoes.length ? `
      <section class="cartao" aria-labelledby="t-versoes">
        <h2 id="t-versoes">Versões enviadas</h2>
        <ul class="lista-simples">${versoes.map((v) => `<li><strong>Versão ${v.numero}</strong> · ${fmtDataHora(v.created_at)} · ${v.personalizada ? 'com personalização' : 'sem personalização'}${v.numero === Number(s.versao_aprovada) ? ' · <span data-etiqueta="ok">aprovada</span>' : ''}
          ${v.personalizada ? ` <button type="button" class="botao-texto" data-baixar-versao="${v.numero}">Baixar (.json)</button>` : ''}</li>`).join('')}</ul>
      </section>` : ''}`;

    const vis = document.getElementById('btn-visualizar');
    if (vis) vis.addEventListener('click', () => abrirNoEditor({ pasta: pastaDoModelo(dadosAtuais), dados: dadosAtuais, modo: 'preview', aoErro: mostrarErro }));
    principal.querySelectorAll('[data-baixar-versao]').forEach((b) => b.addEventListener('click', () => baixarVersao(Number(b.dataset.baixarVersao))));

    historico.innerHTML = eventos.length ? eventos.map((e) => `
      <li>
        <p><strong>${esc(TIPOS[e.tipo] || e.tipo)}</strong>${e.status_para && e.status_para !== e.status_de ? ' → ' + esc(rotulo('solicitacao', e.status_para)) : ''}</p>
        ${e.mensagem ? `<p class="texto-livre">${esc(e.mensagem)}</p>` : ''}
        <small>${fmtDataHora(e.created_at)} · ${esc(e.autor_papel === 'admin' ? (e.autor_nome || 'Equipe CMK') : e.autor_papel === 'cliente' ? 'Cliente' : 'Sistema')}${e.versao ? ' · versão ' + e.versao : ''}${e.visivel_cliente ? '' : ' · interno'}</small>
      </li>`).join('') : '<li><small>Sem registros ainda.</small></li>';

    renderAcoes();
  }

  const TIPOS = {
    criada: 'Solicitação enviada', analise_iniciada: 'Análise iniciada', ajustes_solicitados: 'Ajustes solicitados',
    observacao: 'Observação da equipe', reenviada: 'Cliente reenviou com alterações', aprovada: 'Projeto aprovado',
    aguardando_cliente: 'Proposta enviada ao cliente', cliente_aprovou: 'Cliente aprovou a proposta',
    cliente_pediu_revisao: 'Cliente pediu revisão', cancelada: 'Cancelada', pagamento_confirmado: 'Pagamento confirmado',
    item_removido: 'Item retirado'
  };

  function renderAcoes() {
    const aberta = solicitacaoEditavel(s);
    if (!aberta) {
      acoes.innerHTML = s.status === 'paga'
        ? `<p>Pagamento confirmado. ${s.projeto_id ? `Acompanhe a preparação e a entrega em <a href="projeto.html?id=${encodeURIComponent(s.projeto_id)}">Projeto</a>.` : ''}</p>`
        : '<p>Solicitação cancelada.</p>';
      return;
    }
    const podeAnalisar = ['em_validacao', 'ajustes_solicitados', 'aguardando_cliente'].includes(s.status);
    const valorSugerido = s.valor_final != null ? Number(s.valor_final) : Number(s.valor_calculado) || '';
    acoes.innerHTML = `
      ${podeAnalisar ? '<p><button type="button" id="ac-analisar">' + icone('em-validacao') + ' Iniciar análise</button></p>' : ''}
      <form id="ac-aprovar" class="form-acao" novalidate>
        <h3>Aprovar projeto</h3>
        <p class="campo"><label for="ap-valor">Valor final (R$)</label><input id="ap-valor" type="number" min="1" step="0.01" inputmode="decimal" value="${esc(valorSugerido)}" required></p>
        <p class="campo"><label for="ap-msg">Mensagem ao cliente (opcional)</label><textarea id="ap-msg" rows="2" maxlength="1000"></textarea></p>
        <p><button type="submit">${icone('aprovar')} Aprovar e liberar pagamento</button></p>
        <p><small>Para mudar itens antes de aprovar, use <a href="admin.html?filtro=todas&busca=${encodeURIComponent(s.codigo)}">Itens e valor</a>. Se a equipe mudar itens, o cliente confirma a proposta antes de pagar.</small></p>
      </form>
      <form id="ac-ajustes" class="form-acao" novalidate>
        <h3>Solicitar ajustes</h3>
        <p class="campo"><label for="aj-msg">O que o cliente precisa corrigir</label><textarea id="aj-msg" rows="3" maxlength="2000" required></textarea></p>
        <p><button type="submit">${icone('editar')} Solicitar ajustes</button></p>
      </form>
      <form id="ac-obs" class="form-acao" novalidate>
        <h3>Enviar observação</h3>
        <p class="campo"><label for="ob-msg">Mensagem ao cliente</label><textarea id="ob-msg" rows="2" maxlength="2000" required></textarea></p>
        <p><button type="submit">${icone('mensagem')} Enviar observação</button></p>
      </form>`;

    const an = document.getElementById('ac-analisar');
    if (an) an.addEventListener('click', () => executar(an, { acao: 'analisar' }, 'Análise iniciada. O cliente foi avisado.'));
    document.getElementById('ac-aprovar').addEventListener('submit', (e) => {
      e.preventDefault();
      const valor = Number(document.getElementById('ap-valor').value);
      if (!(valor > 0)) { mostrarErro('Informe o valor final.'); return; }
      const sel = s.selecao || {};
      executar(e.submitter, {
        acao: 'aprovar', updated_at: s.updated_at, valor_final: valor, mensagem: document.getElementById('ap-msg').value,
        itens: {
          servicos: (sel.servicos || []).map((x) => ({ id: x.id, modelo: x.modelo || null, plano: x.plano || null, ...(x.variante ? { variante: x.variante } : {}) })),
          complementos: (sel.complementos || []).map((x) => ({ id: x.id, qtd: Number(x.qtd) || 1 })),
          personalizados: (sel.personalizados || []).map((x) => ({ id: x.id, nome: x.nome, descricao: x.descricao || '', valor: Number(x.valor) }))
        }
      }, (r) => (r.solicitacao && r.solicitacao.status === 'aguardando_cliente'
        ? 'Proposta enviada: o cliente confirma as alterações e depois paga.'
        : 'Projeto aprovado. Pagamento liberado para o cliente.'));
    });
    document.getElementById('ac-ajustes').addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = document.getElementById('aj-msg').value.trim();
      if (!msg) { mostrarErro('Explique o que o cliente precisa ajustar.'); return; }
      executar(e.submitter, { acao: 'ajustes', mensagem: msg }, 'Ajustes solicitados. O cliente foi avisado e pode editar e reenviar.', (r) => {
        if (r.whatsapp_url) window.open(r.whatsapp_url, '_blank', 'noopener');
      });
    });
    document.getElementById('ac-obs').addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = document.getElementById('ob-msg').value.trim();
      if (!msg) { mostrarErro('Escreva a mensagem.'); return; }
      executar(e.submitter, { acao: 'observacao', mensagem: msg }, 'Observação enviada ao cliente.');
    });
  }

  async function executar(botao, corpo, sucesso, depois) {
    mostrarErro('');
    ocupado(botao, true, 'Salvando...');
    try {
      const r = await api('admin-solicitacao', { ...corpo, solicitacao_id: s.id });
      avisar(typeof sucesso === 'function' ? sucesso(r) : sucesso);
      if (depois) depois(r);
      await carregar();
    } catch (e) {
      mostrarErro(e.message);
    } finally {
      ocupado(botao, false);
    }
  }

  async function baixarVersao(numero) {
    const caminho = PERS_PASTA(s.id, numero);
    const { data, error } = await db.storage.from('arquivos').createSignedUrl(caminho, 600, { download: s.codigo + '-v' + numero + '-personalizacao.json' });
    if (error || !data) { mostrarErro('Arquivo desta versão não encontrado no Storage.'); return; }
    window.location.href = data.signedUrl;
  }

  await carregar();
})();
