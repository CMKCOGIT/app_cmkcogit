// =====================================================================
// construir.js — app.cmkcogit.com.br/projeto/{id} (vercel.json -> construir.html).
// Chega aqui pelo botão "Construir com a CMK Cogit" do mvp. O {id} é o projeto (jornada) salvo no
// banco: o servidor confere que é da pessoa logada e monta a solicitação a partir do orçamento
// SALVO (nada de escopo ou valor vem pela URL). Repetir o clique devolve a mesma solicitação.
// =====================================================================
(async function () {
  const id = (window.location.pathname.match(/^\/projeto\/([0-9a-f-]{36})\/?$/i) || [])[1];
  const estado = document.getElementById('construir-estado');
  // sem login: guarda o destino para voltar aqui depois de entrar (proximaPagina em app.js)
  if (id) { try { localStorage.setItem(CHAVE_CONSTRUIR, id); } catch (_) {} }
  const perfil = await protegerPagina();
  if (!perfil) return;
  if (!id) { estado.innerHTML = '<p data-vazio>Link inválido. Volte ao seu projeto no mvp e clique de novo em "Construir com a CMK Cogit".</p>'; return; }

  estado.innerHTML = carregandoCogit('Montando seu pedido...');
  try {
    const r = await api('mvp', { acao: 'construir', projeto_id: id });
    try { localStorage.removeItem(CHAVE_CONSTRUIR); } catch (_) {}
    estado.innerHTML = `<article class="card">
      <h2>Pedido ${esc(r.solicitacao.codigo || '')} ${r.nova ? 'criado' : 'já existia'}</h2>
      <p>O escopo do seu orçamento já está no pedido. A equipe vai validar e definir o valor final; você recebe um aviso no sino.
      Se você comprou o orçamento detalhado, o valor pago vira crédito quando contratar dentro do prazo.</p>
      <p class="pagina-acoes"><a class="botao" href="continuar.html">${icone('solicitacoes')} Ver minhas solicitações</a></p>
    </article>`;
  } catch (e) {
    estado.innerHTML = '';
    mostrarErro(e.message);
  }
})();
