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
    db.from('pagamentos').select('id, status, valor, descricao, created_at').eq('cliente_id', perfil.id),
    db.from('projetos').select('*, projeto_etapas(ordem, nome, status)')
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

  const pendentes = pag.data.filter((x) => x.status === 'pendente');
  const resumo = document.getElementById('resumo');
  resumo.innerHTML = [
    { rotulo: 'Aguardando pagamento', valor: aPagar, icone: 'pagamentos', href: 'continuar.html?filtro=aguardando_pagamento', nota: aPagar ? 'soluções prontas para pagar' : 'nada para pagar agora', destaque: true },
    { rotulo: 'Em validação pela equipe', valor: emValidacao, icone: 'em-validacao', href: 'continuar.html?filtro=em_validacao', nota: 'a equipe confirma o valor' },
    { rotulo: 'Cobranças pendentes', valor: pendentes.length, icone: 'recibo', href: 'pagamentos.html?filtro=pendente', nota: pendentes.length ? brl(pendentes.reduce((t, x) => t + Number(x.valor || 0), 0)) + ' no total' : 'tudo em dia' },
    { rotulo: 'Projetos em andamento', valor: ativos, icone: 'projetos', href: 'projetos.html', nota: proj.data.length ? proj.data.length + ' no total' : 'nenhum ainda' },
    { rotulo: 'Aguardando sua decisão', valor: pend.data.length, icone: 'alerta', href: pend.data.length ? 'projeto.html?id=' + encodeURIComponent(pend.data[0].projeto_id) : 'projetos.html', nota: pend.data.length ? 'a equipe precisa de você' : 'nenhuma pendência', alerta: pend.data.length ? 'atencao' : '' }
  ].map(kpiHtml).join('');
  resumo.removeAttribute('aria-busy');

  // ---------------- próximo passo (topo da coluna principal) ----------------
  const passo = (ic, titulo, texto, acoes) => `<div class="passo"><span class="passo-icone" aria-hidden="true">${icone(ic)}</span>
    <div><h3>${titulo}</h3><p>${texto}</p><div class="pagina-acoes">${acoes}</div></div></div>`;
  const alvo = document.getElementById('proximo-passo');
  if (aPagar) alvo.innerHTML = passo('pagamentos', 'Sua solução está pronta para pagar', 'A equipe liberou o pagamento. Pague por Pix, cartão ou boleto e o projeto começa.', '<a href="continuar.html?filtro=aguardando_pagamento">Ir para o pagamento</a>');
  else if (emValidacao) alvo.innerHTML = passo('em-validacao', 'A equipe está validando sua solução', 'Confirmamos o escopo e o valor. Quando o pagamento for liberado, ele aparece em Minhas solicitações.', '<a href="continuar.html?filtro=em_validacao">Ver solicitação</a>');
  else if (pend.data.length) alvo.innerHTML = passo('alerta', 'A equipe precisa de uma decisão sua', esc(pend.data[0].titulo) + (pend.data[0].prazo ? ' · até ' + fmtData(pend.data[0].prazo) : ''), '<a href="projeto.html?id=' + encodeURIComponent(pend.data[0].projeto_id) + '">Ver o que falta</a>');
  else if (ativos) alvo.innerHTML = passo('projetos', 'Tudo certo, seu projeto está com a equipe', 'Acompanhe as etapas e envie documentos pelo repositório do projeto.', '<a href="projetos.html">Acompanhar projetos</a>');
  else alvo.innerHTML = passo('adicionar', 'Comece montando sua solução', 'Escolha o que sua empresa precisa no site; o valor aparece na hora.', `<a href="${esc(urlSite('monte-sua-solucao.html'))}">Montar solução</a><a href="${esc(urlSite('index.html'))}">Fazer o diagnóstico</a>`);

  // ---------------- painel lateral: projetos, decisões, pagamentos ----------------
  const listaProj = document.getElementById('projetos-andamento');
  listaProj.innerHTML = emAndamento.length ? emAndamento.map((p) => {
    const etapa = (p.projeto_etapas || []).find((e) => e.ordem === p.etapa_atual);
    const pct = progressoProjeto(p);
    return `<li><a class="widget-item" href="projeto.html?id=${encodeURIComponent(p.id)}">${anelHtml(pct, `${p.nome}: ${pct}% concluído`)}
      <span><strong>${esc(p.nome)}</strong><small>Etapa ${Number(p.etapa_atual)} de 8${etapa ? ' · ' + esc(etapa.nome) : ''}</small>
      ${p.previsao_entrega ? `<small>Entrega prevista ${fmtData(p.previsao_entrega)}</small>` : ''}</span></a></li>`;
  }).join('') : '<li><p class="widget-vazio">Nenhum projeto em andamento.</p></li>';

  if (pend.data.length) {
    document.getElementById('secao-decisoes').hidden = false;
    document.getElementById('lista-decisoes').innerHTML = pend.data.map((x) => `<li><a class="widget-item" href="projeto.html?id=${encodeURIComponent(x.projeto_id)}">${icone('alerta')}
      <span><strong>${esc(x.titulo)}</strong>${x.prazo ? `<small>Até ${fmtData(x.prazo)}</small>` : ''}</span></a></li>`).join('');
  }

  document.getElementById('pagamentos-proximos').innerHTML = pendentes.length ? pendentes.slice(0, 4).map((x) => `
    <li><a class="widget-item" href="pagamentos.html?filtro=pendente">${icone('recibo')}
      <span><strong>${esc(x.descricao || 'Cobrança')}</strong><small>Criada em ${fmtData(x.created_at)}</small></span>
      <span class="widget-valor">${brl(x.valor)}</span></a></li>`).join('')
    : '<li><p class="widget-vazio">Nenhuma cobrança pendente.</p></li>';

  if (proj.data.length === 1) document.getElementById('link-repositorio').href = 'projeto.html?id=' + encodeURIComponent(proj.data[0].id) + '#repositorio';

  animarNumeros();
  await Promise.all([carregarNotificacoes(), carregarDicas(proj.data.filter((p) => p.status_projeto !== 'cancelado'))]);
  animarNumeros();
  revelar();

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
      ul.innerHTML = '<li><p class="widget-vazio">Nenhuma atualização ainda. Quando seu projeto avançar de etapa, ganhar um arquivo novo ou precisar de você, avisamos aqui.</p></li>';
      botao.hidden = true;
      return;
    }
    ul.innerHTML = linhaDoTempoHtml(data);
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
      <button type="button" id="fechar-oferta" aria-label="Fechar dica">${icone('fechar')}</button>
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

// linkInterno(), tempoRelativo() e linhaDoTempoHtml() ficam em app.js (usados também pelo sino e pelo perfil)
