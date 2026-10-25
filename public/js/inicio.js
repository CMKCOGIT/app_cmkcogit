// inicio.js — painel inicial do cliente
(async function () {
  // se chegou com uma solução pendente (ex.: confirmou o e-mail agora), vai salvá-la
  if (lerPendente()) { window.location.replace('continuar.html'); return; }

  const perfil = await protegerPagina();
  if (!perfil) return;

  document.getElementById('saudacao').textContent = 'Olá, ' + (perfil.nome || 'cliente') + '!';
  document.getElementById('falar-conosco').href = linkWhatsApp(
    `Olá! Sou ${perfil.nome || 'cliente'} (${perfil.email || ''}) e preciso de ajuda na plataforma COGIT.`
  );

  const [sol, pag, proj, pend] = await Promise.all([
    db.from('solicitacoes').select('id, status').eq('cliente_id', perfil.id),
    db.from('pagamentos').select('id, status, valor').eq('cliente_id', perfil.id),
    db.from('projetos').select('id, nome, status_projeto, etapa_atual, previsao_entrega, projeto_etapas(status)').eq('cliente_id', perfil.id),
    db.from('pendencias').select('id, titulo, prazo, projeto_id, projetos!inner(cliente_id)').eq('resolvida', false).eq('projetos.cliente_id', perfil.id)
  ]);
  const erro = sol.error || pag.error || proj.error || pend.error;
  if (erro) {
    mostrarErro('Não foi possível carregar o resumo: ' + erro.message);
    return;
  }

  const conta = (lista, st) => lista.filter((x) => x.status === st).length;
  const aPagar = conta(sol.data, 'aguardando_pagamento');
  const emValidacao = conta(sol.data, 'em_validacao');
  const emAndamento = proj.data.filter((p) => p.status_projeto !== 'concluido' && p.status_projeto !== 'cancelado');
  const ativos = emAndamento.length;

  document.getElementById('resumo').innerHTML = `
    <li><a href="continuar.html">Solicitações aguardando pagamento: <strong>${aPagar}</strong></a></li>
    <li><a href="continuar.html">Em validação pela equipe: <strong>${emValidacao}</strong></a></li>
    <li><a href="pagamentos.html">Cobranças pendentes: <strong>${conta(pag.data, 'pendente')}</strong></a></li>
    <li><a href="projetos.html">Projetos em andamento: <strong>${ativos}</strong></a></li>
    <li>Aguardando sua decisão: <strong>${pend.data.length}</strong></li>`;

  const passo = document.getElementById('proximo-passo');
  const projetosHtml = emAndamento.map((p) => `<li><a href="projeto.html?id=${encodeURIComponent(p.id)}">${esc(p.nome)}</a>: ${barraProgresso(progressoProjeto(p))}${p.previsao_entrega ? ' · entrega prevista ' + fmtData(p.previsao_entrega) : ''}</li>`).join('');
  const pendHtml = pend.data.map((x) => `<li><a href="projeto.html?id=${encodeURIComponent(x.projeto_id)}">${esc(x.titulo)}</a>${x.prazo ? ' <small>(até ' + fmtData(x.prazo) + ')</small>' : ''}</li>`).join('');
  if (pendHtml) passo.insertAdjacentHTML('beforebegin', '<h3>Aguardando sua decisão</h3><ul>' + pendHtml + '</ul>');
  if (projetosHtml) passo.insertAdjacentHTML('beforebegin', '<h3>Seus projetos</h3><ul>' + projetosHtml + '</ul>');
  if (aPagar) passo.innerHTML = '<p>Você tem uma solução pronta para pagar.</p><p><a href="continuar.html">Ir para o pagamento</a></p>';
  else if (emValidacao) passo.innerHTML = '<p>Nossa equipe está validando sua solução. O pagamento será liberado em "Minhas solicitações".</p>';
  else if (ativos) passo.innerHTML = '<p><a href="projetos.html">Acompanhe seus projetos</a>.</p>';
  else passo.innerHTML = `<p>Comece montando sua solução no site.</p><p><a href="${esc(urlSite('monte-sua-solucao.html'))}">Monte sua solução</a> ou faça o <a href="${esc(urlSite('index.html'))}">diagnóstico rápido</a>.</p>`;
})();
