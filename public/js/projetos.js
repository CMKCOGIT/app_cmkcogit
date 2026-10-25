// projetos.js — sites/soluções que o cliente adquiriu, com o progresso de cada um
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;
  const lista = document.getElementById('lista-projetos');

  const { data, error } = await db
    .from('projetos')
    .select('*, projeto_etapas(ordem, nome, status)')
    .order('created_at', { ascending: false });
  if (error) {
    mostrarErro('Não foi possível carregar os projetos: ' + error.message);
    lista.innerHTML = '';
    return;
  }
  if (!data.length) {
    lista.innerHTML = '<p>Nenhum projeto ainda. Ele aparece aqui assim que o pagamento de uma solicitação é confirmado. <a href="continuar.html">Ver minhas solicitações</a></p>';
    return;
  }
  lista.innerHTML = data.map((p) => {
    const etapas = (p.projeto_etapas || []).sort((a, b) => a.ordem - b.ordem);
    const atual = etapas.find((e) => e.ordem === p.etapa_atual);
    return `
    <article>
      <h2><a href="projeto.html?id=${encodeURIComponent(p.id)}">${esc(p.nome)}</a></h2>
      <p>${esc(p.codigo || '')} · ${esc(rotulo('tipo', p.tipo))}${p.dominio ? ' · ' + linkDominio(p.dominio) : ''}</p>
      <p>Progresso: ${barraProgresso(progressoProjeto(p))}
         — ${p.status_projeto === 'concluido' ? 'Concluído' : 'Etapa ' + Number(p.etapa_atual) + ' de 8' + (atual ? ': ' + esc(atual.nome) : '')}</p>
      <p>Status: ${esc(rotulo('projeto', p.status_projeto))} · Pagamento: ${esc(rotulo('status_pagamento', p.status_pagamento))}
         ${p.previsao_entrega && p.status_projeto !== 'concluido' ? ' · Previsão de entrega: <strong>' + fmtData(p.previsao_entrega) + '</strong>' : ''}</p>
      <p><a href="projeto.html?id=${encodeURIComponent(p.id)}">Ver tudo sobre este projeto</a> ·
         <a href="funcionalidades.html?projeto=${encodeURIComponent(p.id)}">Adquirir nova funcionalidade</a></p>
    </article>
    <hr>`;
  }).join('');
})();
