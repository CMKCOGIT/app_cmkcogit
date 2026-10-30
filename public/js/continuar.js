// =====================================================================
// continuar.js — "Minhas solicitações"
// 1) Recebe a solução montada no site (link #cfg=...), guarda e exige login.
// 2) Depois do login, grava a solução na conta (servidor recalcula o preço).
// 3) Lista as solicitações: pagar (preço fechado) ou aguardar validação.
// =====================================================================
(async function () {
  capturarCfgDaUrl(); // ANTES do login: assim a solução não se perde
  const perfil = await protegerPagina();
  if (!perfil) return;

  const lista = document.getElementById('lista-solicitacoes');
  const tentar = document.getElementById('tentar-de-novo');
  let destaque = null;

  document.getElementById('falar-conosco').href = linkWhatsApp(
    `Olá! Sou ${perfil.nome || 'cliente'} (${perfil.email || ''}) e tenho uma dúvida sobre minha solicitação na plataforma COGIT.`
  );
  document.getElementById('btn-tentar').addEventListener('click', async () => {
    await registrarPendente();
    await carregar();
  });

  async function registrarPendente() {
    const cfg = lerPendente();
    if (!cfg) return;
    mostrarErro('');
    avisar('Salvando sua solução na sua conta...');
    try {
      const r = await api('solicitacoes', { cfg });
      limparPendente();
      tentar.hidden = true;
      destaque = r.solicitacao.id;
      avisar(r.solicitacao.estruturado
        ? 'Solução salva! O preço já está fechado: é só clicar em "Pagar com Mercado Pago".'
        : 'Solução salva! Nossa equipe vai validar o escopo e liberar o pagamento aqui. Avisaremos pelo seu contato.');
    } catch (e) {
      avisar('');
      if (e.status === 400) {
        limparPendente(); // configuração inválida: não adianta tentar de novo
        mostrarErro(e.message + ' Monte a solução novamente no site, se precisar.');
      } else if (e.status === 401) {
        window.location.replace('login.html');
      } else {
        mostrarErro(e.message + ' Sua solução continua guardada neste navegador.');
        tentar.hidden = false;
      }
    }
  }

  let todas = [];
  const params = new URLSearchParams(window.location.search);
  let filtro = ['em_validacao', 'aguardando_pagamento', 'paga', 'cancelada'].includes(params.get('filtro')) ? params.get('filtro') : 'todas';
  const campoBusca = document.getElementById('busca');
  campoBusca.value = params.get('busca') || '';
  document.getElementById('btn-nova-solucao').href = urlSite('monte-sua-solucao.html');
  document.getElementById('barra-solicitacoes').addEventListener('submit', (e) => e.preventDefault());
  campoBusca.addEventListener('input', () => renderLista());
  document.querySelectorAll('#filtro-status > button').forEach((b) => b.addEventListener('click', () => {
    filtro = b.dataset.status;
    renderLista();
  }));

  async function carregar() {
    const { data, error } = await db.from('solicitacoes').select('*').order('created_at', { ascending: false });
    lista.removeAttribute('aria-busy');
    if (error) {
      mostrarErro('Não foi possível carregar as solicitações: ' + error.message);
      lista.innerHTML = '';
      return;
    }
    todas = data || [];
    renderLista();
    const aberta = painel.open && painel.dataset.sol && todas.find((x) => x.id === painel.dataset.sol);
    if (aberta) abrirPainel(aberta, false);
  }

  const nomesItens = (s) => {
    const r = s.resumo || {};
    return [...(r.itens || []), ...(r.mensais || []), ...(r.complementos || [])].map((i) => i.nome);
  };
  const normal = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function renderLista() {
    document.querySelectorAll('#filtro-status > button').forEach((b) => {
      const n = b.dataset.status === 'todas' ? todas.length : todas.filter((x) => x.status === b.dataset.status).length;
      b.setAttribute('aria-pressed', String(b.dataset.status === filtro));
      b.innerHTML = esc(b.textContent.replace(/\s*\d+$/, '')) + ` <span class="menu-contador" aria-label="${n}">${n}</span>`;
    });
    const q = normal(campoBusca.value.trim());
    const visiveis = todas.filter((s) => (filtro === 'todas' || s.status === filtro)
      && (!q || normal(s.codigo).includes(q) || nomesItens(s).some((n) => normal(n).includes(q))));
    document.getElementById('contagem').textContent = todas.length
      ? `${visiveis.length} de ${todas.length} ${todas.length === 1 ? 'solicitação' : 'solicitações'}` : '';

    if (!todas.length) {
      lista.innerHTML = `<p data-vazio>Você ainda não tem solicitações.<br><a href="${esc(urlSite('monte-sua-solucao.html'))}">Monte sua solução no site</a> e ela aparece aqui.</p>`;
      return;
    }
    if (!visiveis.length) {
      lista.innerHTML = '<p data-vazio>Nenhuma solicitação com esse filtro.</p>';
      return;
    }
    lista.innerHTML = visiveis.map((s) => {
      const nomes = nomesItens(s);
      return `
      <article class="sol-card" id="sol-${esc(s.id)}" data-status="${esc(s.status)}"${s.id === destaque ? ' aria-current="true"' : ''}>
        <header>
          <h2>${esc(s.codigo)}${s.id === destaque ? ' <small>nova</small>' : ''}</h2>
          ${etiquetaStatus('solicitacao', s.status)}
        </header>
        <p class="sol-meta">${icone('prazo')} ${fmtData(s.created_at)} · ${s.estruturado ? 'Preço fechado' : 'Sob medida'} · ${nomes.length} ${nomes.length === 1 ? 'item' : 'itens'}</p>
        <p class="sol-itens">${esc(nomes.slice(0, 3).join(', '))}${nomes.length > 3 ? ` <small>+${nomes.length - 3}</small>` : ''}</p>
        <footer>
          <p class="sol-valor"><small>Investimento</small><strong>${esc(valorSolicitacao(s))}</strong></p>
          <p class="pagina-acoes">
            ${s.status === 'aguardando_pagamento' ? `<button type="button" data-pagar="${esc(s.id)}">${icone('pagamentos')} Pagar</button>` : ''}
            <button type="button" data-abrir="${esc(s.id)}" aria-haspopup="dialog">Ver detalhes ${icone('avancar')}</button>
          </p>
        </footer>
      </article>`;
    }).join('');

    lista.querySelectorAll('[data-pagar]').forEach(ligarPagar);
    lista.querySelectorAll('[data-abrir]').forEach((b) => b.addEventListener('click', () => {
      abrirPainel(todas.find((x) => x.id === b.dataset.abrir), true, b);
    }));
    if (destaque) {
      document.getElementById('sol-' + destaque)?.scrollIntoView({ block: 'start' });
      destaque = null;
    }
  }

  function ligarPagar(btn) {
    btn.addEventListener('click', async () => {
      ocupado(btn, true, 'Abrindo o Mercado Pago...');
      mostrarErro('');
      try {
        await irParaCheckout({ solicitacao_id: btn.dataset.pagar });
      } catch (e) {
        mostrarErro(e.message);
        toast(e.message, 'erro');
        ocupado(btn, false);
      }
    });
  }

  // ---------------- painel lateral de detalhes ----------------
  const painel = document.getElementById('painel-solicitacao');
  let quemAbriu = null;
  painel.querySelector('[data-fechar]').addEventListener('click', () => painel.close());
  painel.addEventListener('click', (e) => { if (e.target === painel) painel.close(); });
  painel.addEventListener('close', () => { quemAbriu?.focus(); });

  const ETAPAS = ['Enviada', 'Em validação', 'Aguardando pagamento', 'Paga', 'Em desenvolvimento'];
  function etapaAtual(s) {
    if (s.status === 'em_validacao') return 1;
    if (s.status === 'aguardando_pagamento') return 2;
    if (s.status === 'paga') return 3;
    return -1;
  }

  function itensSelecionaveis(s) {
    const r = s.resumo || {};
    const editavel = solicitacaoEditavel(s);
    const formato = (m) => (m === 'sob-medida' ? 'sob medida' : m === 'modelos-prontos' ? 'modelo pronto' : '');
    const preco = (p, t) => (p == null ? 'sob análise' : (t === 'from' ? 'a partir de ' : '') + brl(p));
    const linha = (tipo, item, detalhe, valor) => `<li data-item-tipo="${tipo}">
        ${editavel ? `<input type="checkbox" id="sel-${tipo}-${esc(item.id)}" data-tipo="${tipo}" data-id="${esc(item.id)}" data-nome="${esc(item.nome)}">` : ''}
        <label${editavel ? ` for="sel-${tipo}-${esc(item.id)}"` : ''}><span data-item-nome>${esc(item.nome)}</span>
          <small>${esc(detalhe || (tipo === 'complemento' ? 'complemento' : 'solução'))}${item.adicionado === 'equipe' ? ' · adicionado pela equipe' : ''}</small></label>
        <span data-item-preco>${esc(valor)}</span></li>`;
    const itens = [
      ...(r.itens || []).map((i) => linha('servico', i, i.personalizado ? i.descricao || 'personalizado' : formato(i.modelo) || 'solução', preco(i.preco, i.tipo_preco))),
      ...(r.mensais || []).map((m) => linha('servico', m, 'mensalidade após 3 meses grátis', m.preco != null ? brl(m.preco) + '/mês' : 'mensal')),
      ...(r.complementos || []).map((c) => linha('complemento', c, (c.quantidade > 1 ? '× ' + Number(c.quantidade) + ' · ' : '') + 'complemento', preco(c.preco, c.tipo_preco)))
    ].join('');
    const removidos = (r.removidos || []).slice(-5).map((x) =>
      `<li>${esc(x.nome)} <small>tirado pel${x.por === 'equipe' ? 'a equipe' : 'o cliente'} em ${fmtData(x.em)}${x.motivo ? ' (' + esc(x.motivo) + ')' : ''}</small></li>`).join('');
    return `<ul class="itens-sel" data-livre>${itens}</ul>
      ${editavel ? `<div class="barra-selecao" id="barra-selecao" hidden>
        <span id="selecao-texto" aria-live="polite"></span>
        <button type="button" id="btn-remover-selecionados" data-cancelar>${icone('remover')} Remover selecionados</button></div>` : ''}
      ${removidos ? `<details data-removidos><summary>Itens retirados (${(r.removidos || []).length})</summary><ul>${removidos}</ul></details>` : ''}`;
  }

  function abrirPainel(s, abrir = true, origem = null) {
    if (!s) return;
    if (origem) quemAbriu = origem;
    painel.dataset.sol = s.id;
    document.getElementById('painel-sol-titulo').textContent = s.codigo;
    const atual = etapaAtual(s);
    const linhaStatus = s.status === 'cancelada'
      ? `<p class="status-cancelado">${icone('cancelado')} Solicitação cancelada${s.motivo_cancelamento ? ': ' + esc(s.motivo_cancelamento) : '.'}</p>`
      : `<ol class="linha-status" aria-label="Andamento da solicitação">${ETAPAS.map((n, i) => {
          const estado = i < atual || (i === atual && i === 0) ? 'feito' : i === atual ? 'atual' : 'futuro';
          return `<li data-estado="${estado}"${i === atual ? ' aria-current="step"' : ''}><span aria-hidden="true">${estado === 'feito' ? icone('concluido') : i + 1}</span>${esc(n)}</li>`;
        }).join('')}</ol>`;
    document.getElementById('painel-sol-corpo').innerHTML = `
      <p class="sol-meta">${etiquetaStatus('solicitacao', s.status)} ${fmtData(s.created_at)} · ${s.estruturado ? 'Preço fechado' : 'Sob medida'} · ${s.origem === 'diagnostico' ? 'Diagnóstico da página inicial' : 'Monte sua solução'}</p>
      ${linhaStatus}
      <section aria-labelledby="painel-itens-titulo">
        <h3 id="painel-itens-titulo">Itens</h3>
        ${solicitacaoEditavel(s) ? '<p class="nota">Marque o que quer tirar. O valor é recalculado; se for sob medida, a solicitação volta para a validação.</p>' : ''}
        ${itensSelecionaveis(s)}
      </section>
      <section class="resumo-investimento" aria-label="Investimento">
        <p><small>Investimento</small><strong>${esc(valorSolicitacao(s))}</strong></p>
      </section>
      ${s.observacao_admin ? `<section class="mensagem-equipe" aria-labelledby="painel-msg-titulo"><h3 id="painel-msg-titulo">${icone('mensagem')} Mensagem da equipe</h3><p>${esc(s.observacao_admin)}</p></section>` : ''}
      ${s.notas ? `<p class="nota">Seu contexto: ${esc(s.notas)}</p>` : ''}
      ${s.comprovante_token ? `<p><a href="comprovante.html?t=${encodeURIComponent(s.comprovante_token)}" target="_blank" rel="noopener">${icone('comprovante')} Ver comprovante do pedido</a></p>` : ''}`;

    const falar = `<a class="botao-link" data-secundario href="${esc(linkWhatsApp('Olá! Sobre a solicitação ' + s.codigo + ' na plataforma COGIT.'))}" target="_blank" rel="noopener noreferrer">${icone('whatsapp')} Falar conosco</a>`;
    const cancelar = solicitacaoEditavel(s) ? `<button type="button" data-cancelar="${esc(s.id)}">Cancelar solicitação</button>` : '';
    const pagar = s.status === 'aguardando_pagamento' ? `<button type="button" data-pagar="${esc(s.id)}">${icone('pagamentos')} Pagar com Mercado Pago</button>` : '';
    const projeto = s.status === 'paga' ? '<a class="botao-link" href="projetos.html">Ver meu projeto</a>' : '';
    document.getElementById('painel-sol-rodape').innerHTML = `${cancelar}<span data-espaco></span>${falar}${pagar}${projeto}`;

    painel.querySelectorAll('[data-pagar]').forEach(ligarPagar);
    const btnCancelar = painel.querySelector('#painel-sol-rodape [data-cancelar]');
    if (btnCancelar) btnCancelar.addEventListener('click', () => cancelarSolicitacao(btnCancelar));
    ligarSelecao(s);
    if (abrir && !painel.open) painel.showModal();
  }

  function ligarSelecao(s) {
    const barra = document.getElementById('barra-selecao');
    if (!barra) return;
    const caixas = [...painel.querySelectorAll('.itens-sel input[type=checkbox]')];
    const solucoes = caixas.filter((c) => c.dataset.tipo === 'servico');
    const botao = document.getElementById('btn-remover-selecionados');
    const atualizar = () => {
      const marcadas = caixas.filter((c) => c.checked);
      const todasSolucoes = solucoes.length && solucoes.every((c) => c.checked);
      barra.hidden = !marcadas.length;
      document.getElementById('selecao-texto').textContent = todasSolucoes
        ? 'Para tirar todas as soluções, cancele a solicitação.'
        : `${marcadas.length} ${marcadas.length === 1 ? 'item selecionado' : 'itens selecionados'}`;
      botao.disabled = Boolean(todasSolucoes);
      caixas.forEach((c) => c.closest('li').toggleAttribute('data-marcado', c.checked));
    };
    caixas.forEach((c) => c.addEventListener('change', atualizar));
    botao.addEventListener('click', async () => {
      const marcadas = caixas.filter((c) => c.checked);
      const nomes = marcadas.map((c) => c.dataset.nome);
      if (!window.confirm(`Tirar ${nomes.length === 1 ? '"' + nomes[0] + '"' : nomes.length + ' itens'} desta solicitação?\n\nO valor é recalculado. Se a solicitação for sob medida, ela volta para a validação da equipe.`)) return;
      ocupado(botao, true, 'Removendo...');
      mostrarErro('');
      // complementos primeiro: alguns dependem de uma solução e sairiam junto
      const ordem = [...marcadas.filter((c) => c.dataset.tipo === 'complemento'), ...marcadas.filter((c) => c.dataset.tipo !== 'complemento')];
      let ultima = null;
      const saidos = [];
      try {
        for (const c of ordem) {
          if (saidos.includes(c.dataset.nome)) continue;
          ultima = await api('solicitacao-itens', { solicitacao_id: s.id, tipo: c.dataset.tipo, id: c.dataset.id });
          saidos.push(c.dataset.nome, ...(ultima.removidos_junto || []));
        }
        toast(`${saidos.length === 1 ? '"' + saidos[0] + '" foi retirado' : saidos.length + ' itens foram retirados'}. ` + (ultima.solicitacao.valor_final != null
          ? 'Novo valor: ' + brl(ultima.solicitacao.valor_final) + '.' : 'A solicitação voltou para a validação da equipe.'));
      } catch (e) {
        mostrarErro(e.message);
        toast(e.message, 'erro');
      }
      ocupado(botao, false);
      await carregar();
    });
  }

  async function cancelarSolicitacao(btn) {
    if (!window.confirm('Cancelar esta solicitação? Você pode montar outra no site quando quiser.')) return;
    ocupado(btn, true, 'Cancelando...');
    const { error } = await db.rpc('cliente_cancelar_solicitacao', { p_id: btn.dataset.cancelar });
    ocupado(btn, false);
    if (error) {
      toast('Não foi possível cancelar: ' + error.message, 'erro');
      return;
    }
    toast('Solicitação cancelada.');
    await carregar();
  }

  await registrarPendente();
  await carregar();
})();
