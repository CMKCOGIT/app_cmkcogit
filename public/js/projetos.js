// projetos.js — sites/soluções que o cliente adquiriu, com o progresso de cada um
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;
  const lista = document.getElementById('lista-projetos');

  const { data, error } = await db
    .from('projetos')
    .select('*, projeto_etapas(ordem, nome, status), arquivos(id)')
    .order('created_at', { ascending: false });
  lista.removeAttribute('aria-busy');
  if (error) {
    mostrarErro('Não foi possível carregar os projetos: ' + error.message);
    lista.innerHTML = '';
    return;
  }
  const visao = document.getElementById('visao-geral');
  if (!data.length) {
    lista.innerHTML = '<p data-vazio>Nenhum projeto ainda. Ele aparece aqui assim que o pagamento de uma solicitação é confirmado.<br><a href="continuar.html">Ver minhas solicitações</a></p>';
    visao.innerHTML = '<p class="widget-vazio">Sem projetos por enquanto.</p>';
    return;
  }
  lista.innerHTML = data.map((p) => {
    const etapas = (p.projeto_etapas || []).sort((a, b) => a.ordem - b.ordem);
    const atual = etapas.find((e) => e.ordem === p.etapa_atual);
    const pct = progressoProjeto(p);
    const arquivos = (p.arquivos || []).length;
    const link = 'projeto.html?id=' + encodeURIComponent(p.id);
    return `
    <article class="projeto-card">
      <header>
        <span class="codigo">${esc(p.codigo || '')}</span>
        <span data-etiqueta="${(TOM_STATUS.projeto || {})[p.status_projeto] || 'neutro'}">${esc(rotulo('projeto', p.status_projeto))}</span>
      </header>
      <div class="projeto-card-corpo">
        ${anelHtml(pct, `${p.nome}: ${pct}% concluído`)}
        <div>
          <h2><a href="${link}">${esc(p.nome)}</a></h2>
          <p>${esc(rotulo('tipo', p.tipo))}${p.dominio ? ' · ' + linkDominio(p.dominio) : ''}</p>
        </div>
      </div>
      <ul class="projeto-fatos" data-livre>
        <li>${icone('avancar')}<span>${p.status_projeto === 'concluido' ? 'Concluído' : 'Etapa ' + Number(p.etapa_atual) + ' de 8' + (atual ? ': ' + esc(atual.nome) : '')}</span></li>
        <li>${icone('prazo')}<span>${p.status_projeto === 'concluido' ? 'Entregue' + (p.concluido_em ? ' em ' + fmtData(p.concluido_em) : '') : p.previsao_entrega ? 'Entrega prevista ' + fmtData(p.previsao_entrega) : 'Prazo a definir'}</span></li>
        <li>${icone('historico')}<span>Atualizado ${esc(tempoRelativo(p.updated_at || p.created_at))}</span></li>
        <li>${icone('comprovante')}<span>${arquivos} ${arquivos === 1 ? 'arquivo' : 'arquivos'} no repositório</span></li>
      </ul>
      <footer class="pagina-acoes">
        <a class="botao-link" href="${link}">Ver detalhes ${icone('avancar')}</a>
        <a class="acao-icone" href="${link}#repositorio" aria-label="Repositório de ${esc(p.nome)}" title="Repositório">${icone('enviado')}</a>
        <a class="acao-icone" href="funcionalidades.html?projeto=${encodeURIComponent(p.id)}" aria-label="Adquirir funcionalidade para ${esc(p.nome)}" title="Adquirir funcionalidade">${icone('adquirir')}</a>
      </footer>
    </article>`;
  }).join('');

  const ativos = data.filter((p) => p.status_projeto !== 'cancelado');
  const media = ativos.length ? Math.round(ativos.reduce((t, p) => t + progressoProjeto(p), 0) / ativos.length) : 0;
  const conta = (st) => data.filter((p) => p.status_projeto === st).length;
  visao.innerHTML = `
    ${anelHtml(media, `Progresso médio dos projetos: ${media}%`, true)}
    <dl class="numeros-mini">
      <div><dt>Em andamento</dt><dd>${conta('em_andamento') + conta('aguardando_cliente')}</dd></div>
      <div><dt>Concluídos</dt><dd>${conta('concluido')}</dd></div>
      <div><dt>Total</dt><dd>${data.length}</dd></div>
    </dl>
    <p class="nota">Progresso médio dos projetos ativos.</p>`;
  animarNumeros();
  revelar('.grade-cards > article');
})();
