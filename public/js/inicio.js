// inicio.js — painel inicial do cliente: resumo, atualizações dos projetos,
// próximo passo, dicas de funcionalidades (com a oferta no topo) e suporte
(async function () {
  // se chegou com uma solução pendente (ex.: confirmou o e-mail agora), vai salvá-la
  if (lerPendente()) { window.location.replace('continuar.html'); return; }

  const perfil = await protegerPagina();
  if (!perfil) return;

  document.getElementById('saudacao').textContent = 'Olá, ' + (perfil.nome || 'cliente') + '!';
  document.getElementById('btn-nova-solucao').href = urlSite('monte-sua-solucao.html');
  document.getElementById('falar-conosco').href = linkWhatsApp(
    `Olá! Sou ${perfil.nome || 'cliente'} (${perfil.email || ''}) e preciso de ajuda na plataforma COGIT.`
  );

  const [sol, pag, proj, pend] = await Promise.all([
    db.from('solicitacoes').select('id, status').eq('cliente_id', perfil.id),
    db.from('pagamentos').select('id, status, valor').eq('cliente_id', perfil.id),
    db.from('projetos').select('id, nome, codigo, status_projeto, etapa_atual, previsao_entrega, created_at, projeto_etapas(ordem, nome, status)')
      .eq('cliente_id', perfil.id).order('created_at', { ascending: false }),
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
    <li><a href="continuar.html">Solicitações aguardando pagamento <strong>${aPagar}</strong></a></li>
    <li><a href="continuar.html">Em validação pela equipe <strong>${emValidacao}</strong></a></li>
    <li><a href="pagamentos.html">Cobranças pendentes <strong>${conta(pag.data, 'pendente')}</strong></a></li>
    <li><a href="projetos.html">Projetos em andamento <strong>${ativos}</strong></a></li>
    <li>Aguardando sua decisão <strong>${pend.data.length}</strong></li>`;

  // ---------------- próximo passo + status de cada projeto ----------------
  const passo = document.getElementById('proximo-passo');
  const projetosHtml = emAndamento.map((p) => {
    const etapa = (p.projeto_etapas || []).find((e) => e.ordem === p.etapa_atual);
    return `<li><a href="projeto.html?id=${encodeURIComponent(p.id)}">${esc(p.nome)}${p.codigo ? ' (' + esc(p.codigo) + ')' : ''}</a>
      ${barraProgresso(progressoProjeto(p))}
      <small>${esc(rotulo('projeto', p.status_projeto))} · etapa ${Number(p.etapa_atual)} de 8${etapa ? ': ' + esc(etapa.nome) : ''}${p.previsao_entrega ? ' · entrega prevista ' + fmtData(p.previsao_entrega) : ''}</small></li>`;
  }).join('');
  const pendHtml = pend.data.map((x) => `<li><a href="projeto.html?id=${encodeURIComponent(x.projeto_id)}">${esc(x.titulo)}</a>${x.prazo ? ' <small>(até ' + fmtData(x.prazo) + ')</small>' : ''}</li>`).join('');
  if (pendHtml) passo.insertAdjacentHTML('beforebegin', '<h3>Aguardando sua decisão</h3><ul>' + pendHtml + '</ul>');
  if (projetosHtml) passo.insertAdjacentHTML('beforebegin', '<h3>Seus projetos</h3><ul id="projetos-andamento">' + projetosHtml + '</ul>');
  if (aPagar) passo.innerHTML = '<p>Você tem uma solução pronta para pagar.</p><p><a href="continuar.html">Ir para o pagamento</a></p>';
  else if (emValidacao) passo.innerHTML = '<p>Nossa equipe está validando sua solução. O pagamento será liberado em "Minhas solicitações".</p>';
  else if (pend.data.length) passo.innerHTML = '<p>A equipe precisa de uma decisão sua para continuar.</p><p><a href="projeto.html?id=' + encodeURIComponent(pend.data[0].projeto_id) + '">Ver o que falta</a></p>';
  else if (ativos) passo.innerHTML = '<p>Tudo certo! Seu projeto está com a nossa equipe.</p><p><a href="projetos.html">Acompanhe seus projetos</a></p>';
  else passo.innerHTML = `<p>Comece montando sua solução no site.</p><p><a href="${esc(urlSite('monte-sua-solucao.html'))}">Monte sua solução</a> ou faça o <a href="${esc(urlSite('index.html'))}">diagnóstico rápido</a>.</p>`;

  if (proj.data.length === 1) document.getElementById('link-repositorio').href = 'projeto.html?id=' + encodeURIComponent(proj.data[0].id) + '#repositorio';

  await Promise.all([carregarNotificacoes(), carregarDicas(proj.data.filter((p) => p.status_projeto !== 'cancelado'))]);

  // ---------------- notificações ----------------
  async function carregarNotificacoes() {
    const secao = document.getElementById('secao-notificacoes');
    const { data, error } = await db.from('notificacoes').select('*')
      .eq('usuario_id', perfil.id).order('created_at', { ascending: false }).limit(8);
    if (error) { console.warn('Notificações indisponíveis:', error.message); return; } // sql/11 ainda não rodado
    secao.hidden = false;
    const ul = document.getElementById('lista-notificacoes');
    const botao = document.getElementById('marcar-lidas');
    if (!data.length) {
      ul.innerHTML = '<li>Nenhuma atualização ainda. Quando seu projeto avançar de etapa, ganhar um arquivo novo ou precisar de você, avisamos aqui.</li>';
      botao.hidden = true;
      return;
    }
    ul.innerHTML = data.map((n) => `
      <li data-notificacao="${esc(n.id)}"${n.lida ? '' : ' data-nova'}>
        ${linkInterno(n.link) ? `<a href="${esc(n.link)}">${esc(n.titulo)}</a>` : `<strong>${esc(n.titulo)}</strong>`}
        ${n.mensagem ? '<br>' + esc(n.mensagem) : ''}
        <small>${tempoRelativo(n.created_at)}</small>
      </li>`).join('');
    botao.hidden = !data.some((n) => !n.lida);

    ul.querySelectorAll('li[data-nova] a').forEach((a) => a.addEventListener('click', async (e) => {
      e.preventDefault();
      await db.from('notificacoes').update({ lida: true }).eq('id', a.closest('li').dataset.notificacao);
      window.location.href = a.getAttribute('href');
    }));
  }

  document.getElementById('marcar-lidas').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const { error } = await db.from('notificacoes').update({ lida: true }).eq('usuario_id', perfil.id).eq('lida', false);
    e.target.disabled = false;
    if (error) return mostrarErro('Não foi possível marcar como lidas: ' + error.message);
    await carregarNotificacoes();
    mostrarNaoLidas(perfil.id);
  });

  // ---------------- dicas (funcionalidades que o projeto ainda não tem) ----------------
  async function carregarDicas(projetos) {
    const secao = document.getElementById('secao-dicas');
    const lista = document.getElementById('lista-dicas');
    if (!projetos.length) return;
    const alvo = projetos[0];
    const [cat, contratadas] = await Promise.all([
      db.from('funcionalidades').select('id, slug, nome, descricao, preco').eq('ativo', true).order('preco'),
      db.from('projeto_funcionalidades').select('funcionalidade_id, status').eq('projeto_id', alvo.id)
    ]);
    if (cat.error || contratadas.error) return;
    const jaTem = new Set(contratadas.data.filter((c) => c.status !== 'cancelada').map((c) => c.funcionalidade_id));
    const sugestoes = cat.data.filter((f) => !jaTem.has(f.id)).slice(0, 3);
    if (!sugestoes.length) return;

    const link = (f) => `funcionalidades.html?projeto=${encodeURIComponent(alvo.id)}&f=${encodeURIComponent(f.id)}`;
    secao.hidden = false;
    document.getElementById('dicas-intro').textContent =
      `Recursos que combinam com ${alvo.nome}. Contrate quando quiser — a gente implementa no seu site.`;
    lista.innerHTML = sugestoes.map((f) => `
      <article>
        <h3>${esc(f.nome)}</h3>
        <p>${esc(DICAS[f.slug] || f.descricao || '')}</p>
        <p><strong>${brl(f.preco)}</strong></p>
        <p><a href="${link(f)}">Quero adquirir</a></p>
      </article>`).join('');

    mostrarOferta(sugestoes[0], link(sugestoes[0]));
  }

  // Faixa no topo com a principal dica; some por 7 dias ao fechar
  function mostrarOferta(f, href) {
    const chave = 'cogit_oferta_fechada_' + f.id;
    try { if (Number(localStorage.getItem(chave)) > Date.now()) return; } catch (_) {}
    const box = document.getElementById('oferta');
    box.innerHTML = `
      <button type="button" id="fechar-oferta" aria-label="Fechar dica">×</button>
      <small>Dica para o seu site</small>
      <h2 id="oferta-titulo">${esc(f.nome)}</h2>
      <p>${esc(DICAS[f.slug] || f.descricao || '')}</p>
      <p>Por <strong>${brl(f.preco)}</strong></p>
      <p><a href="${href}">Clique aqui para adquirir</a></p>`;
    box.hidden = false;
    document.getElementById('fechar-oferta').addEventListener('click', () => {
      box.hidden = true;
      try { localStorage.setItem(chave, String(Date.now() + 7 * 24 * 60 * 60 * 1000)); } catch (_) {}
    });
  }
})();

// Texto de venda por funcionalidade (slug do catálogo); sem dica usa a descrição do banco
const DICAS = {
  'portal-clientes': 'Uma área exclusiva para seus clientes acessarem documentos e aprovações passa confiança e reduz mensagens repetidas.',
  'whatsapp-crm': 'Leve cada contato do site direto para o WhatsApp e para o CRM: nenhum interessado fica sem resposta.',
  'dashboard': 'Veja vendas, acessos e resultados num só painel e tome decisões com números, não com achismo.',
  'pagamentos-online': 'Receba por Pix e cartão no próprio site, sem mandar link manual para cada cliente.',
  'blog-seo': 'Conteúdo com SEO faz seu site aparecer no Google sem pagar por anúncio.'
};

// Só links da própria plataforma (as notificações são geradas pelo banco)
function linkInterno(link) {
  return /^[a-z-]+\.html([?#][\w=&%#.-]*)?$/i.test(link || '');
}

function tempoRelativo(data) {
  const min = Math.round((Date.now() - new Date(data).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return 'há ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return 'há ' + h + ' h';
  const d = Math.round(h / 24);
  return d < 7 ? 'há ' + d + (d === 1 ? ' dia' : ' dias') : fmtData(data);
}
