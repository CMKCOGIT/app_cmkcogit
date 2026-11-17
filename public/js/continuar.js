// =====================================================================
// continuar.js — "Minhas solicitações"
// 1) Recebe a solução montada no site (link #cfg=...), guarda e exige login.
// 2) Depois do login, grava a solução na conta (servidor recalcula o preço).
// 3) Lista as solicitações: pagar (preço fechado) ou aguardar validação.
// =====================================================================
(async function () {
  capturarCfgDaUrl(); // ANTES do login: assim a solução não se perde
  await receberPersonalizacao(lerPendente()); // site personalizado no editor do modelo (se houver)
  const perfil = await protegerPagina();
  if (!perfil) return;
  enviarPersonalizacoes().catch(() => {}); // envio que ficou pendente de outra visita

  const lista = document.getElementById('lista-solicitacoes');
  const tentar = document.getElementById('tentar-de-novo');
  let destaque = null;

  document.getElementById('falar-conosco').href = linkWhatsApp(
    `Olá! Sou ${perfil.nome || 'cliente'} (${perfil.email || ''}) e tenho uma dúvida sobre minha solicitação na plataforma COGIT.`
  );
  document.getElementById('btn-tentar').addEventListener('click', async () => {
    if (!lerPendente()) {
      // a solicitação já existe: falta só reenviar o site personalizado
      const ok = await enviarPersonalizacoes().catch(() => false);
      tentar.hidden = ok;
      avisar(ok ? 'Recebemos o seu site! Nossa equipe vai revisar e enviar o orçamento aqui.' : '');
      if (!ok) mostrarErro('Ainda não foi possível enviar o site personalizado. Verifique a conexão e tente de novo.');
    }
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
      if (cfg.personalizacao) {
        const enviada = await vincularPersonalizacao(cfg.ref, r.solicitacao.id).catch(() => false);
        avisar(enviada
          ? 'Recebemos o seu site! Nossa equipe vai revisar, fazer os ajustes necessários e enviar o orçamento aqui. Depois do pagamento, entregamos o site publicado.'
          : '');
        if (!enviada) {
          mostrarErro('Solicitação salva, mas o envio do site personalizado não terminou. Clique em "Tentar de novo".');
          tentar.hidden = false;
        }
        return;
      }
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
  // "Em análise" agrupa tudo antes da aprovação da CMK
  const GRUPO = { em_validacao: ['em_validacao', 'em_analise', 'ajustes_solicitados', 'aguardando_cliente'] };
  const noFiltro = (s, f) => f === 'todas' || (GRUPO[f] || [f]).includes(s.status);
  let projetosPorId = {};
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
    // projeto (depois do pagamento): "Em desenvolvimento" ou "Site entregue"
    const idsProjeto = todas.map((x) => x.projeto_id).filter(Boolean);
    if (idsProjeto.length) {
      const pr = await db.from('projetos').select('id,status_projeto').in('id', idsProjeto);
      projetosPorId = Object.fromEntries((pr.data || []).map((x) => [x.id, x]));
    }
    renderLista();
    const aberta = painel.open && painel.dataset.sol && todas.find((x) => x.id === painel.dataset.sol);
    if (aberta) abrirPainel(aberta, false);
    // link das notificações: continuar.html?abrir=<id>
    const pedir = params.get('abrir');
    if (pedir && !painel.open) { const alvo = todas.find((x) => x.id === pedir); if (alvo) abrirPainel(alvo, true); params.delete('abrir'); }
  }

  const nomesItens = (s) => {
    const r = s.resumo || {};
    return [...(r.itens || []), ...(r.mensais || []), ...(r.complementos || [])].map((i) => i.nome);
  };
  const normal = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function renderLista() {
    document.querySelectorAll('#filtro-status > button').forEach((b) => {
      const n = todas.filter((x) => noFiltro(x, b.dataset.status)).length;
      b.setAttribute('aria-pressed', String(b.dataset.status === filtro));
      b.innerHTML = esc(b.textContent.replace(/\s*\d+$/, '')) + ` <span class="menu-contador" aria-label="${n}">${n}</span>`;
    });
    const q = normal(campoBusca.value.trim());
    const visiveis = todas.filter((s) => noFiltro(s, filtro)
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

  const ETAPAS = ['Enviada', 'Aguardando análise da CMK', 'Em análise', 'Aprovado pela CMK', 'Pagamento confirmado', 'Em desenvolvimento', 'Site entregue'];
  function etapaAtual(s) {
    if (s.status === 'em_validacao') return 1;
    if (['em_analise', 'ajustes_solicitados', 'aguardando_cliente'].includes(s.status)) return 2;
    if (s.status === 'aguardando_pagamento') return 3;
    if (s.status === 'paga') {
      const p = projetosPorId[s.projeto_id];
      return p && p.status_projeto === 'concluido' ? 6 : 5;
    }
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
      ...(r.mensais || []).map((m) => linha('servico', m, 'suporte: começa após o 1º mês grátis', m.preco == null ? 'suporte' : m.cobranca === 'solicitação' ? 'a partir de ' + brl(m.preco) + ' por solicitação' : brl(m.preco) + '/mês')),
      ...(r.complementos || []).map((c) => linha('complemento', c, (c.quantidade > 1 ? '× ' + Number(c.quantidade) + ' · ' : '') + 'complemento', preco(c.preco, c.tipo_preco)))
    ].join('') + (r.desconto ? `<li data-item-tipo="desconto"><label><span data-item-nome>Desconto da combinação ${esc(r.desconto.nome)}</span><small>${Number(r.desconto.percentual)}% no pacote</small></label><span data-item-preco>− ${esc(brl(r.desconto.valor))}</span></li>` : '');
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
        ${solicitacaoEditavel(s) ? '<p class="nota">Marque o que quer tirar. O valor é recalculado e a solicitação volta para a análise da CMK antes do pagamento.</p>' : ''}
        ${itensSelecionaveis(s)}
      </section>
      <section class="resumo-investimento" aria-label="Investimento">
        <p><small>Investimento</small><strong>${esc(valorSolicitacao(s))}</strong></p>
      </section>
      ${blocoSituacao(s)}
      ${blocoPersonalizacao(s)}
      <section aria-labelledby="painel-hist-titulo" id="painel-historico"><h3 id="painel-hist-titulo">${icone('mensagem')} Mensagens e histórico</h3><p data-esqueleto-linha></p></section>
      ${s.notas ? `<p class="nota">Seu contexto: ${esc(s.notas)}</p>` : ''}
      ${s.comprovante_token ? `<p><a href="comprovante.html?t=${encodeURIComponent(s.comprovante_token)}" target="_blank" rel="noopener">${icone('comprovante')} Ver comprovante do pedido</a></p>` : ''}`;

    const falar = `<a class="botao-link" data-secundario href="${esc(linkWhatsApp('Olá! Sobre a solicitação ' + s.codigo + ' na plataforma COGIT.'))}" target="_blank" rel="noopener noreferrer">${icone('whatsapp')} Falar conosco</a>`;
    const cancelar = solicitacaoEditavel(s) ? `<button type="button" data-cancelar="${esc(s.id)}">Cancelar solicitação</button>` : '';
    const pagar = s.status === 'aguardando_pagamento' ? `<button type="button" data-pagar="${esc(s.id)}">${icone('pagamentos')} Pagar com Mercado Pago</button>` : '';
    const projeto = s.status === 'paga' ? `<a class="botao-link" href="${s.projeto_id ? 'projeto.html?id=' + encodeURIComponent(s.projeto_id) : 'projetos.html'}">Ver meu projeto</a>` : '';
    document.getElementById('painel-sol-rodape').innerHTML = `${cancelar}<span data-espaco></span>${falar}${pagar}${projeto}`;

    painel.querySelectorAll('[data-pagar]').forEach(ligarPagar);
    const btnCancelar = painel.querySelector('#painel-sol-rodape [data-cancelar]');
    if (btnCancelar) btnCancelar.addEventListener('click', () => cancelarSolicitacao(btnCancelar));
    ligarSelecao(s);
    ligarPersonalizacao(s);
    carregarHistorico(s);
    if (abrir && !painel.open) painel.showModal();
  }

  // ---------------------------------------------------------------
  // Situação, proposta da CMK, personalização e histórico
  // ---------------------------------------------------------------
  function blocoSituacao(s) {
    const msg = s.observacao_admin ? `<p class="texto-livre">${esc(s.observacao_admin)}</p>` : '';
    if (s.status === 'em_validacao') return '<p class="aviso-destaque">A equipe da CMK vai analisar o seu projeto. O pagamento é liberado aqui depois da aprovação.</p>';
    if (s.status === 'em_analise') return '<p class="aviso-destaque">A equipe está analisando o seu projeto agora. Avisaremos assim que terminar.</p>';
    if (s.status === 'ajustes_solicitados') return `<section class="mensagem-equipe" aria-labelledby="t-ajustes"><h3 id="t-ajustes">${icone('editar')} A CMK pediu ajustes</h3>${msg}<p>Edite o projeto abaixo e reenvie para uma nova análise.</p></section>`;
    if (s.status === 'aguardando_cliente') return `<section class="mensagem-equipe" aria-labelledby="t-proposta"><h3 id="t-proposta">${icone('aprovar')} Proposta da CMK</h3>
      <p>A equipe ajustou o projeto. Valor proposto: <strong>${esc(brl(s.valor_final))}</strong>.</p>${msg}
      <p class="pagina-acoes"><button type="button" data-aprovar-proposta>${icone('aprovar')} Aprovar e liberar o pagamento</button> <button type="button" data-revisar-proposta data-secundario>Pedir revisão</button></p></section>`;
    if (s.status === 'aguardando_pagamento') return `<section class="mensagem-equipe" aria-labelledby="t-aprov"><h3 id="t-aprov">${icone('aprovar')} Projeto aprovado pela CMK</h3>${msg}<p>O pagamento está liberado. Se precisar mudar algo no projeto, ele passa por uma nova análise antes do pagamento.</p></section>`;
    return msg ? `<section class="mensagem-equipe"><h3>${icone('mensagem')} Mensagem da equipe</h3>${msg}</section>` : '';
  }

  const VARIANTE_NOME = { 'landing-page-basica': 'Landing Page Básica', 'landing-page-profissional': 'Landing Page Profissional', 'landing-page-formal': 'Landing Page Corporativa' };
  function varianteDe(s) {
    const it = ((s.selecao || {}).servicos || []).find((x) => x.variante);
    return it ? it.variante : null;
  }
  function blocoPersonalizacao(s) {
    const variante = varianteDe(s);
    if (!variante) return '';
    const sel = s.selecao || {};
    const pode = ['em_validacao', 'ajustes_solicitados', 'aguardando_cliente', 'aguardando_pagamento'].includes(s.status);
    return `<section aria-labelledby="t-pers" id="painel-pers">
      <h3 id="t-pers">${icone('imagem')} Seu site · ${esc(VARIANTE_NOME[variante] || variante)}</h3>
      <p>${sel.personalizacao ? `Personalizado por você (versão ${Number(s.versao_atual) || 1}).` : 'Enviado sem personalização. Você pode personalizar agora: cores, textos e imagens.'}</p>
      <p class="pagina-acoes">
        ${sel.personalizacao ? '<button type="button" data-ver-pers data-secundario>Ver o que enviei</button>' : ''}
        ${pode ? `<button type="button" data-editar-pers>${icone('editar')} ${sel.personalizacao ? 'Editar e reenviar' : 'Personalizar agora'}</button>` : ''}
        ${s.status === 'em_analise' ? '<small>Em análise: aguarde o retorno da equipe para editar.</small>' : ''}
      </p>
      <div data-pers-detalhe hidden></div>
    </section>`;
  }

  function ligarPersonalizacao(s) {
    const ver = painel.querySelector('[data-ver-pers]');
    const editar = painel.querySelector('[data-editar-pers]');
    const detalhe = painel.querySelector('[data-pers-detalhe]');
    if (ver) ver.addEventListener('click', async () => {
      if (!detalhe.hidden) { detalhe.hidden = true; return; }
      detalhe.hidden = false;
      detalhe.innerHTML = '<p data-esqueleto-linha></p>';
      detalhe.innerHTML = personalizacaoHtml(await baixarPersonalizacao(s.id, Number(s.versao_atual) || 1), { completo: false });
    });
    if (editar) editar.addEventListener('click', async () => {
      mostrarErro('');
      ocupado(editar, true, 'Abrindo o editor...');
      const sel = s.selecao || {};
      const versao = Number(s.versao_atual) || 1;
      const dados = sel.personalizacao ? await baixarPersonalizacao(s.id, versao) : null;
      ocupado(editar, false);
      const pasta = (dados && pastaDoModelo(dados)) || PASTA_POR_VARIANTE[varianteDe(s)];
      abrirNoEditor({
        pasta, dados, modo: 'editar', aoErro: mostrarErro,
        aoSalvar: (novos) => reenviar(s, novos)
      });
      avisar('Edite o site na nova aba e clique em "Salvar e reenviar para análise".');
    });
    const aprovar = painel.querySelector('[data-aprovar-proposta]');
    const revisar = painel.querySelector('[data-revisar-proposta]');
    if (aprovar) aprovar.addEventListener('click', async () => {
      ocupado(aprovar, true, 'Aprovando...');
      try { await api('solicitacoes', { acao: 'aprovar_proposta', solicitacao_id: s.id }); toast('Proposta aprovada. O pagamento está liberado.'); }
      catch (e) { mostrarErro(e.message); }
      ocupado(aprovar, false);
      await carregar();
    });
    if (revisar) revisar.addEventListener('click', async () => {
      const mensagem = window.prompt('O que precisa mudar na proposta?');
      if (!mensagem || !mensagem.trim()) return;
      ocupado(revisar, true, 'Enviando...');
      try { await api('solicitacoes', { acao: 'recusar_proposta', solicitacao_id: s.id, mensagem }); toast('Pedido de revisão enviado à equipe.'); }
      catch (e) { mostrarErro(e.message); }
      ocupado(revisar, false);
      await carregar();
    });
  }

  // Nova versão: arquivo no Storage e depois a solicitação volta para a análise da CMK
  async function reenviar(s, dados) {
    const versao = (Number(s.versao_atual) || 1) + 1;
    avisar('Enviando a nova versão do seu site...');
    const blob = new Blob([JSON.stringify(dados)], { type: 'application/json' });
    const up = await db.storage.from('arquivos').upload(PERS_PASTA(s.id, versao), blob, { contentType: 'application/json', upsert: false });
    if (up.error && !/exist|duplicate/i.test(up.error.message || '')) {
      avisar('');
      mostrarErro('Não foi possível enviar o site: ' + up.error.message);
      return;
    }
    try {
      await api('solicitacoes', { acao: 'reenviar', solicitacao_id: s.id, personalizada: true });
      avisar('');
      toast('Site reenviado. O projeto voltou para a análise da CMK.');
    } catch (e) {
      avisar('');
      mostrarErro(e.message);
    }
    await carregar();
  }

  const TIPOS_EVENTO = {
    criada: 'Solicitação enviada', analise_iniciada: 'A CMK começou a análise', ajustes_solicitados: 'A CMK pediu ajustes',
    observacao: 'Mensagem da CMK', reenviada: 'Você reenviou com alterações', aprovada: 'Projeto aprovado · pagamento liberado',
    aguardando_cliente: 'Proposta da CMK', cliente_aprovou: 'Você aprovou a proposta', cliente_pediu_revisao: 'Você pediu revisão',
    cancelada: 'Cancelada', pagamento_confirmado: 'Pagamento confirmado', item_removido: 'Item retirado'
  };
  async function carregarHistorico(s) {
    const alvo = painel.querySelector('#painel-historico');
    if (!alvo) return;
    const { data, error } = await db.from('solicitacao_eventos').select('*').eq('solicitacao_id', s.id).order('created_at', { ascending: false });
    if (painel.dataset.sol !== s.id) return;
    const h3 = alvo.querySelector('h3').outerHTML;
    if (error) { alvo.innerHTML = h3 + '<p class="nota">Histórico indisponível no momento.</p>'; return; }
    alvo.innerHTML = h3 + (data && data.length ? `<ol class="historico-lista">${data.map((e) => `<li>
        <p><strong>${esc(TIPOS_EVENTO[e.tipo] || e.tipo)}</strong></p>
        ${e.mensagem && e.autor_papel !== 'cliente' ? `<p class="texto-livre">${esc(e.mensagem)}</p>` : ''}
        <small>${fmtDataHora(e.created_at)}${e.autor_papel === 'admin' ? ' · Equipe CMK' : ''}${e.versao ? ' · versão ' + e.versao : ''}</small></li>`).join('')}</ol>` : '<p class="nota">Sem mensagens ainda.</p>');
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
      if (!window.confirm(`Tirar ${nomes.length === 1 ? '"' + nomes[0] + '"' : nomes.length + ' itens'} desta solicitação?\n\nO valor é recalculado e a solicitação volta para a análise da CMK.`)) return;
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
          ? 'Novo valor: ' + brl(ultima.solicitacao.valor_final) + '.' : 'A solicitação voltou para a análise da CMK.'));
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
