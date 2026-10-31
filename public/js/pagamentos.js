// =====================================================================
// pagamentos.js — cobranças do cliente
// "Pagar" abre o Mercado Pago. Na volta (ou pelo botão "Já paguei"), o
// servidor consulta o pagamento direto no Mercado Pago e confirma.
// =====================================================================
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const tabela = document.getElementById('tabela-pagamentos');
  const resumo = document.getElementById('resumo-pagamentos');
  let lista = [];

  document.getElementById('falar-conosco').href = linkWhatsApp(
    `Olá! Sou ${perfil.nome || 'cliente'} (${perfil.email || ''}) e preciso de ajuda com um pagamento na plataforma COGIT.`
  );

  // ---- volta do Mercado Pago: ?mp=sucesso|pendente|falha&payment_id=...&external_reference=... ----
  const q = new URLSearchParams(window.location.search);
  const retorno = q.get('mp');
  const ref = q.get('external_reference');
  const paymentId = q.get('payment_id') || q.get('collection_id');
  if (retorno) history.replaceState(null, '', window.location.pathname);

  let filtroStatus = ['pendente', 'pago'].includes(q.get('filtro')) ? q.get('filtro') : 'todas';
  let periodo = 0;
  const ligarPilulas = (id, attr, definir) => document.querySelectorAll(`#${id} > button`).forEach((b) => b.addEventListener('click', () => {
    definir(b.dataset[attr]);
    document.querySelectorAll(`#${id} > button`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderTabela();
  }));
  ligarPilulas('filtro-status', 'status', (v) => { filtroStatus = v; });
  ligarPilulas('filtro-periodo-pag', 'periodo', (v) => { periodo = Number(v); });
  document.querySelectorAll('#filtro-status > button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.status === filtroStatus)));

  await carregar();
  carregarPlanos();

  if (ref && UUID.test(ref)) {
    avisar('Confirmando seu pagamento com o Mercado Pago...');
    await verificar(ref, /^\d+$/.test(paymentId || '') ? paymentId : null, true);
  } else if (retorno === 'falha') {
    avisar('O pagamento não foi concluído. Você pode tentar de novo pelo botão "Pagar".');
  }

  async function carregar() {
    const { data, error } = await db
      .from('pagamentos')
      .select('*, projetos(nome), solicitacoes(codigo, comprovante_token)')
      .order('created_at', { ascending: false });
    if (error) {
      mostrarErro('Não foi possível carregar os pagamentos: ' + error.message);
      return;
    }
    lista = data || [];
    renderResumo();
    renderTabela();
  }

  // Planos mensal/anual (sql/19). Sem a tabela no banco, a seção só não aparece.
  async function carregarPlanos() {
    const secao = document.getElementById('secao-planos');
    const ul = document.getElementById('lista-planos');
    const { data, error } = await db.from('assinaturas')
      .select('id, nome, plano, valor, status, proximo_vencimento, renovacao_automatica')
      .order('created_at', { ascending: false });
    if (error || !data || !data.length) { secao.hidden = true; return; }
    const situacao = { ativa: 'Ativo', atrasada: 'Renovação em atraso', cancelada: 'Cancelado' };
    ul.innerHTML = data.map((a) => {
      const periodo = a.plano === 'anual' ? '/ano' : '/mês';
      const quando = a.status === 'cancelada'
        ? 'No ar até ' + fmtData(a.proximo_vencimento)
        : (a.renovacao_automatica ? 'Renova automaticamente no cartão em ' : 'Próximo vencimento: ') + fmtData(a.proximo_vencimento);
      return `<li data-status-plano="${esc(a.status)}">
        <span><strong>${esc(a.nome)}</strong><small>${esc(situacao[a.status] || a.status)} · ${esc(quando)}</small></span>
        <span class="num">${brl(a.valor)}<small>${periodo}</small></span>
        ${a.status === 'cancelada' ? '' : `<button type="button" data-cancelar-plano="${esc(a.id)}" data-cancelar>Cancelar renovação</button>`}
      </li>`;
    }).join('');
    secao.hidden = false;
    ul.querySelectorAll('[data-cancelar-plano]').forEach((btn) => btn.addEventListener('click', async () => {
      const a = data.find((x) => x.id === btn.dataset.cancelarPlano);
      if (!window.confirm(`Cancelar a renovação de "${a.nome}"?\n\nO site continua no ar até ${fmtData(a.proximo_vencimento)} e a cobrança de renovação em aberto é cancelada.`)) return;
      ocupado(btn, true, 'Cancelando...');
      const { error: e } = await db.rpc('cancelar_assinatura', { p_assinatura_id: a.id });
      ocupado(btn, false);
      if (e) return mostrarErro('Não foi possível cancelar: ' + e.message);
      toast('Renovação cancelada. O site fica no ar até ' + fmtData(a.proximo_vencimento) + '.');
      await carregar();
      carregarPlanos();
    }));
  }

  function renderResumo() {
    const soma = (st) => lista.filter((p) => p.status === st).reduce((t, p) => t + Number(p.valor), 0);
    const abertas = lista.filter((p) => p.status === 'pendente').length;
    resumo.innerHTML = [
      { rotulo: 'Em aberto', valor: soma('pendente'), formato: 'brl', icone: 'recibo', destaque: true, nota: abertas ? `${abertas} ${abertas === 1 ? 'cobrança pendente' : 'cobranças pendentes'}` : 'nada em aberto' },
      { rotulo: 'Total pago', valor: soma('pago'), formato: 'brl', icone: 'aprovar', nota: 'confirmado pelo Mercado Pago' },
      { rotulo: 'Cobranças', valor: lista.length, icone: 'pagamentos', nota: 'desde o início' }
    ].map(kpiHtml).join('');
    resumo.removeAttribute('aria-busy');
    animarNumeros(resumo);
  }

  function renderTabela() {
    if (!lista.length) {
      tabela.innerHTML = '<tr><td colspan="5"><p class="widget-vazio">Nenhuma cobrança ainda. Elas aparecem quando você clica em "Pagar" em Minhas solicitações.</p></td></tr>';
      return;
    }
    const limite = periodo ? Date.now() - periodo * 86400000 : 0;
    const visiveis = lista.filter((p) => (filtroStatus === 'todas' || p.status === filtroStatus)
      && (!limite || new Date(p.pago_em || p.created_at).getTime() >= limite));
    if (!visiveis.length) {
      tabela.innerHTML = '<tr><td colspan="5"><p class="widget-vazio">Nenhuma cobrança nesse filtro.</p></td></tr>';
      return;
    }
    tabela.innerHTML = visiveis.map((p) => {
      const tentativa = p.status === 'pendente' && p.mp_ultimo_status
        ? `<small>Última tentativa: ${esc(rotulo('mp', p.mp_ultimo_status))}</small>` : '';
      const data = p.status === 'pago' ? fmtData(p.pago_em) : p.vencimento ? 'Vence em ' + fmtData(p.vencimento) : fmtData(p.created_at);
      const comprovante = p.solicitacoes && p.solicitacoes.comprovante_token
        ? `<a class="acao-icone" href="comprovante.html?t=${encodeURIComponent(p.solicitacoes.comprovante_token)}" target="_blank" rel="noopener" aria-label="Ver comprovante" title="Ver comprovante">${icone('comprovante')}</a>` : '';
      const acao = p.status === 'pendente'
        ? `<button type="button" data-pagar="${esc(p.id)}">${icone('pagamentos')} Pagar</button>
           <button type="button" class="botao-icone" data-verificar="${esc(p.id)}" aria-label="Já paguei: verificar no Mercado Pago" title="Já paguei: verificar no Mercado Pago">${icone('recarregar')}</button>`
        : p.status === 'pago' && p.projeto_id ? `<a class="acao-icone" href="projetos.html" aria-label="Ver projeto" title="Ver projeto">${icone('projetos')}</a>` : '';
      return `<tr>
        <td data-rotulo="Cobrança">${p.solicitacoes ? `<span class="codigo">${esc(p.solicitacoes.codigo)}</span>` : ''}<strong>${esc(p.descricao)}</strong>${p.projetos ? '<small>' + esc(p.projetos.nome) + '</small>' : ''}</td>
        <td data-rotulo="Valor" class="num">${brl(p.valor)}</td>
        <td data-rotulo="Status">${etiquetaStatus('pagamento', p.status)}${tentativa}${p.metodo ? `<small>${esc(rotulo('metodo', p.metodo))}</small>` : ''}</td>
        <td data-rotulo="Data">${data}</td>
        <td data-rotulo="Ações" class="acoes">${acao}${comprovante}</td>
      </tr>`;
    }).join('');

    tabela.querySelectorAll('[data-pagar]').forEach((btn) => btn.addEventListener('click', async () => {
      ocupado(btn, true, 'Abrindo...');
      mostrarErro('');
      try {
        await irParaCheckout({ pagamento_id: btn.dataset.pagar });
      } catch (e) {
        mostrarErro(e.message);
        ocupado(btn, false);
      }
    }));
    tabela.querySelectorAll('[data-verificar]').forEach((btn) => btn.addEventListener('click', async () => {
      ocupado(btn, true, 'Verificando...');
      avisar('Consultando o Mercado Pago...');
      await verificar(btn.dataset.verificar, null, false);
      ocupado(btn, false);
    }));
  }

  // Pede ao servidor para consultar o Mercado Pago. Se ainda estiver em análise
  // logo depois do checkout (ex.: Pix), tenta mais algumas vezes.
  async function verificar(pagamentoId, mpId, insistir) {
    mostrarErro('');
    for (let tentativa = 0; tentativa < (insistir ? 6 : 1); tentativa++) {
      if (tentativa > 0) await new Promise((r) => setTimeout(r, 5000));
      let r;
      try {
        r = await api('verificar-pagamento', { pagamento_id: pagamentoId, payment_id: mpId });
      } catch (e) {
        avisar('');
        mostrarErro(e.message);
        return;
      }
      await carregar();
      if (r.status === 'pago') {
        avisar('Pagamento confirmado! Seu projeto já está em "Meus projetos". Obrigado!');
        return;
      }
      if (r.resultado === 'valor_divergente') {
        avisar('');
        mostrarErro('O valor pago não confere com a cobrança atual. Nossa equipe vai verificar — fale conosco se precisar.');
        return;
      }
      if (r.mp_status === 'rejected' || r.mp_status === 'cancelled') {
        avisar('O Mercado Pago recusou a última tentativa. Você pode tentar de novo pelo botão "Pagar" (outro cartão ou Pix).');
        return;
      }
      if (!r.mp_status) {
        avisar('Ainda não encontramos pagamento para esta cobrança no Mercado Pago. Se você acabou de pagar, aguarde alguns instantes e verifique de novo.');
        if (!insistir) return;
        continue;
      }
      avisar('Pagamento ' + rotulo('mp', r.mp_status) + '. Pix costuma confirmar em instantes; boleto em até 3 dias úteis. Esta página atualiza ao verificar de novo.');
    }
  }
})();
