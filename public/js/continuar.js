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

  await registrarPendente();
  await carregar();

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

  async function carregar() {
    const { data, error } = await db.from('solicitacoes').select('*').order('created_at', { ascending: false });
    if (error) {
      mostrarErro('Não foi possível carregar as solicitações: ' + error.message);
      lista.innerHTML = '';
      return;
    }
    render(data || []);
  }

  function acoes(s) {
    const falar = `<a href="${esc(linkWhatsApp('Olá! Sobre a solicitação ' + s.codigo + ' na plataforma COGIT.'))}" target="_blank" rel="noopener noreferrer">Falar conosco</a>`;
    const cancelar = `<button type="button" data-cancelar="${esc(s.id)}">Cancelar solicitação</button>`;
    switch (s.status) {
      case 'aguardando_pagamento':
        return `<p><button type="button" data-pagar="${esc(s.id)}">Pagar com Mercado Pago</button> ${cancelar} ${falar}</p>
                <p><small>Pix, cartão ou boleto. A confirmação é automática e seu projeto é criado assim que o pagamento for aprovado.</small></p>`;
      case 'em_validacao':
        return `<p><strong>Nossa equipe está validando sua solução.</strong> Quando o valor for confirmado, o botão de pagamento aparece aqui.</p>
                <p>${cancelar} ${falar}</p>`;
      case 'paga':
        return `<p>Pagamento confirmado! <a href="projetos.html">Ver meu projeto</a></p>`;
      default:
        return `<p>${falar}</p>`;
    }
  }

  function render(solicitacoes) {
    if (!solicitacoes.length) {
      lista.innerHTML = `<p>Você ainda não tem solicitações. <a href="${esc(urlSite('monte-sua-solucao.html'))}">Monte sua solução no site</a>.</p>`;
      return;
    }
    lista.innerHTML = solicitacoes.map((s) => `
      <article id="sol-${esc(s.id)}"${s.id === destaque ? ' aria-current="true"' : ''}>
        <h2>${esc(s.codigo)}${s.id === destaque ? ' <small>(nova)</small>' : ''}</h2>
        <p>Status: <strong>${esc(rotulo('solicitacao', s.status))}</strong> ·
           ${s.estruturado ? 'Preço fechado' : 'Sob medida / sob validação'} ·
           ${s.origem === 'diagnostico' ? 'Diagnóstico da página inicial' : 'Monte sua solução'} ·
           ${fmtData(s.created_at)}</p>
        ${itensEditaveisHtml(s)}
        <p>Investimento inicial: <strong>${esc(valorSolicitacao(s))}</strong></p>
        ${s.notas ? `<p><small>Seu contexto: ${esc(s.notas)}</small></p>` : ''}
        ${s.observacao_admin ? `<p>Mensagem da equipe: ${esc(s.observacao_admin)}</p>` : ''}
        ${acoes(s)}
      </article>
      <hr>`).join('');

    lista.querySelectorAll('[data-pagar]').forEach((btn) => btn.addEventListener('click', async () => {
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Abrindo o Mercado Pago...';
      mostrarErro('');
      try {
        await irParaCheckout({ solicitacao_id: btn.dataset.pagar });
      } catch (e) {
        mostrarErro(e.message);
        btn.disabled = false;
        btn.textContent = original;
      }
    }));

    lista.querySelectorAll('[data-cancelar]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!window.confirm('Cancelar esta solicitação? Você pode montar outra no site quando quiser.')) return;
      btn.disabled = true;
      const { error } = await db.rpc('cliente_cancelar_solicitacao', { p_id: btn.dataset.cancelar });
      if (error) {
        mostrarErro('Não foi possível cancelar: ' + error.message);
        btn.disabled = false;
        return;
      }
      avisar('Solicitação cancelada.');
      await carregar();
    }));

    ligarRemoverItens(lista, async (r) => {
      await carregar();
      document.getElementById('sol-' + r.solicitacao.id)?.scrollIntoView({ block: 'start' });
    });

    if (destaque) document.getElementById('sol-' + destaque)?.scrollIntoView({ block: 'start' });
  }
})();
