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

  await carregar();

  if (ref && UUID.test(ref)) {
    avisar('Confirmando seu pagamento com o Mercado Pago...');
    await verificar(ref, /^\d+$/.test(paymentId || '') ? paymentId : null, true);
  } else if (retorno === 'falha') {
    avisar('O pagamento não foi concluído. Você pode tentar de novo pelo botão "Pagar".');
  }

  async function carregar() {
    const { data, error } = await db
      .from('pagamentos')
      .select('*, projetos(nome), solicitacoes(codigo)')
      .order('created_at', { ascending: false });
    if (error) {
      mostrarErro('Não foi possível carregar os pagamentos: ' + error.message);
      return;
    }
    lista = data || [];
    renderResumo();
    renderTabela();
  }

  function renderResumo() {
    const soma = (st) => lista.filter((p) => p.status === st).reduce((t, p) => t + Number(p.valor), 0);
    resumo.innerHTML = `<p>Total pago: <strong>${brl(soma('pago'))}</strong> · Em aberto: <strong>${brl(soma('pendente'))}</strong></p>`;
  }

  function renderTabela() {
    if (!lista.length) {
      tabela.innerHTML = '<tr><td colspan="6">Nenhuma cobrança ainda. As cobranças aparecem quando você clica em "Pagar" em Minhas solicitações.</td></tr>';
      return;
    }
    tabela.innerHTML = lista.map((p) => {
      const tentativa = p.status === 'pendente' && p.mp_ultimo_status
        ? `<br><small>Última tentativa no Mercado Pago: ${esc(rotulo('mp', p.mp_ultimo_status))}</small>` : '';
      const data = p.status === 'pago' ? 'Pago em ' + fmtData(p.pago_em) : p.vencimento ? 'Vence em ' + fmtData(p.vencimento) : fmtData(p.created_at);
      const acao = p.status === 'pendente'
        ? `<button type="button" data-pagar="${esc(p.id)}">Pagar</button>
           <button type="button" data-verificar="${esc(p.id)}">Já paguei — verificar</button>`
        : p.status === 'pago' && p.projeto_id ? '<a href="projetos.html">Ver projeto</a>' : '';
      return `<tr>
        <td>${esc(p.descricao)}${p.projetos ? '<br><small>' + esc(p.projetos.nome) + '</small>' : ''}</td>
        <td>${brl(p.valor)}</td>
        <td>${esc(rotulo('pagamento', p.status))}${tentativa}</td>
        <td>${esc(p.metodo ? rotulo('metodo', p.metodo) : '-')}</td>
        <td>${data}</td>
        <td>${acao}</td>
      </tr>`;
    }).join('');

    tabela.querySelectorAll('[data-pagar]').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Abrindo...';
      mostrarErro('');
      try {
        await irParaCheckout({ pagamento_id: btn.dataset.pagar });
      } catch (e) {
        mostrarErro(e.message);
        btn.disabled = false;
        btn.textContent = 'Pagar';
      }
    }));
    tabela.querySelectorAll('[data-verificar]').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      avisar('Consultando o Mercado Pago...');
      await verificar(btn.dataset.verificar, null, false);
      btn.disabled = false;
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
