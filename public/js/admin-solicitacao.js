// =====================================================================
// admin-solicitacao.js — projeto de uma solicitação (só admin)
// Cliente, formato, modelo, personalização (cores, textos, imagens, prévia),
// versões, histórico e ações: iniciar análise, aprovar (libera o pagamento),
// solicitar ajustes e enviar observação. Cada ação fica registrada com o admin e a data
// (api/admin-solicitacao.js -> solicitacao_eventos).
// =====================================================================
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;

  const id = new URLSearchParams(location.search).get('id') || '';
  const principal = document.getElementById('sol-principal');
  const acoes = document.getElementById('sol-acoes');
  const historico = document.getElementById('sol-historico');
  let s = null;
  let versoes = [];
  let versaoMostrada = 1;
  const MSG_REENVIO = 'O arquivo do seu site personalizado não chegou até a plataforma. Abra esta solicitação em "Minhas solicitações", clique em "Enviar meu site" e depois em "Concluir" no editor. Use o mesmo navegador em que você personalizou: o que você fez continua salvo nele.';
  let dadosAtuais = null;
  let arquivosSite = [];   // .zip gerados (solicitacoes/<id>/site-final), mais recente primeiro
  let liberados = [];      // .zip já entregues no repositório do projeto
  let autoTentado = false; // geração automática: uma tentativa por abertura da página

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    principal.innerHTML = '<p data-vazio>Solicitação não informada. <a href="admin.html">Voltar para Solicitações</a>.</p>';
    principal.removeAttribute('aria-busy');
    return;
  }

  async function carregar() {
    mostrarErro('');
    const [sol, ev, ve] = await Promise.all([
      db.from('solicitacoes').select('*, cliente:profiles!solicitacoes_cliente_id_fkey(nome, email, telefone, documento), pagamentos(id, status, valor, metodo, pago_em)').eq('id', id).maybeSingle(),
      db.from('solicitacao_eventos').select('*').eq('solicitacao_id', id).order('created_at', { ascending: false }),
      db.from('solicitacao_versoes').select('*').eq('solicitacao_id', id).order('numero', { ascending: false })
    ]);
    principal.removeAttribute('aria-busy');
    if (sol.error || !sol.data) {
      principal.innerHTML = '<p data-vazio>Solicitação não encontrada.</p>';
      mostrarErro(sol.error ? 'Não foi possível carregar: ' + sol.error.message : '');
      return;
    }
    s = sol.data;
    versoes = ve.error ? [] : (ve.data || []);
    if (ev.error || ve.error) mostrarErro('Histórico e versões indisponíveis: rode o sql/32_analise_aprovacao.sql no Supabase.');
    const sel = s.selecao || {};
    const versaoAtual = Number(s.versao_atual) || 1;
    const atual = versoes.find((v) => v.numero === versaoAtual);
    const personalizada = atual ? atual.personalizada : sel.personalizacao === true;
    dadosAtuais = null;
    versaoMostrada = versaoAtual;
    if (personalizada) {
      // versão atual primeiro; se o arquivo dela não chegou, a mais recente que chegou
      const candidatas = [versaoAtual, ...versoes.filter((v) => v.personalizada && v.numero !== versaoAtual).map((v) => v.numero)];
      for (const n of candidatas) {
        dadosAtuais = await baixarPersonalizacao(s.id, n);
        if (dadosAtuais) { versaoMostrada = n; break; }
      }
    }
    arquivosSite = personalizada ? await listarArquivosDoSite(s.id) : [];
    liberados = [];
    if (s.projeto_id) {
      const lib = await db.from('arquivos').select('id, nome, created_at, descricao').eq('projeto_id', s.projeto_id).like('nome', '%-site.zip').order('created_at', { ascending: false });
      liberados = lib.error ? [] : (lib.data || []);
    }
    render(ev.error ? [] : (ev.data || []), personalizada);
  }

  function render(eventos, personalizada) {
    const c = s.cliente || {};
    const sel = s.selecao || {};
    const r = s.resumo || {};
    const itens = [...(r.itens || []), ...(r.mensais || []), ...(r.complementos || [])];
    const modelo = (r.itens || []).find((i) => i.variante);
    const formato = (r.itens || []).map((i) => (i.modelo === 'sob-medida' ? 'Sob medida' : i.modelo === 'modelos-prontos' ? 'Modelo pronto' : '')).find(Boolean) || '—';
    document.getElementById('titulo-sol').textContent = 'Projeto ' + s.codigo;
    document.getElementById('sub-sol').innerHTML = `${etiquetaStatus('solicitacao', s.status)} · enviada em ${fmtDataHora(s.created_at)} · versão ${Number(s.versao_atual) || 1}`;
    const fone = String(c.telefone || '').replace(/\D/g, '');

    principal.innerHTML = `
      <section class="cartao" aria-labelledby="t-cliente">
        <h2 id="t-cliente">Cliente</h2>
        <dl class="dados-grade">
          <div><dt>Nome</dt><dd>${esc(c.nome || '-')}</dd></div>
          <div><dt>E-mail</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '-'}</dd></div>
          <div><dt>Telefone</dt><dd>${c.telefone ? esc(formatarTelefone(c.telefone)) + (fone ? ` · <a href="https://wa.me/55${esc(fone)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : '') : '-'}</dd></div>
          <div><dt>CPF/CNPJ</dt><dd>${esc(mascararDocumento(c.documento) || '-')}</dd></div>
        </dl>
      </section>
      <section class="cartao" aria-labelledby="t-pedido">
        <h2 id="t-pedido">Solicitação</h2>
        <dl class="dados-grade">
          <div><dt>Formato</dt><dd>${esc(formato)}</dd></div>
          <div><dt>Modelo</dt><dd>${modelo ? esc(modelo.variante_nome || modelo.variante) : '—'}</dd></div>
          <div><dt>Data</dt><dd>${fmtDataHora(s.created_at)}</dd></div>
          <div><dt>Status</dt><dd>${etiquetaStatus('solicitacao', s.status)}</dd></div>
          <div><dt>Valor de referência</dt><dd>${brl(s.valor_calculado)}</dd></div>
          <div><dt>Valor aprovado</dt><dd>${s.valor_final != null ? brl(s.valor_final) : '—'}</dd></div>
        </dl>
        <p><strong>Itens:</strong> ${itens.map((i) => esc(i.nome + (i.variante_nome ? ' (' + i.variante_nome + ')' : ''))).join(', ') || '—'}</p>
        ${s.notas ? `<details><summary>Contexto informado pelo cliente</summary><p class="texto-livre">${esc(s.notas)}</p></details>` : ''}
      </section>
      <section class="cartao" aria-labelledby="t-pers">
        <div class="cartao-topo">
          <h2 id="t-pers">Personalização do site</h2>
          ${personalizada && dadosAtuais ? '<button type="button" id="btn-visualizar">' + icone('externo') + ' Visualizar projeto</button>' : ''}
        </div>
        ${'personalizacao' in sel || modelo ? (personalizada
          ? (dadosAtuais
            ? (versaoMostrada !== (Number(s.versao_atual) || 1) ? `<p class="aviso-destaque">O arquivo da versão ${Number(s.versao_atual) || 1} não chegou. Mostrando a versão ${versaoMostrada}, a mais recente recebida.</p>` : '') + personalizacaoHtml(dadosAtuais)
            : `<div class="aviso-destaque"><p><strong>O arquivo do site personalizado não chegou à plataforma.</strong> O cliente personalizou o modelo, mas o envio não terminou no navegador dele (a aba fechou, a conexão caiu ou ele trocou de navegador). Nada foi perdido do lado dele: o editor guarda o rascunho no navegador em que ele personalizou.</p>
              <p>Peça para ele abrir <strong>Minhas solicitações → Enviar meu site → Concluir</strong>. A nova versão aparece aqui.</p>
              <p><button type="button" id="btn-pedir-reenvio">${icone('mensagem')} Pedir ao cliente para reenviar</button></p></div>`)
          : '<p class="aviso-destaque"><strong>Enviada sem personalização.</strong> O cliente escolheu o modelo e não personalizou o site. Os textos e as imagens precisam ser combinados com ele.</p>')
          : '<p data-vazio>Esta solicitação não usa modelo pronto com editor.</p>'}
      </section>
      ${modelo || personalizada ? `<section class="cartao" aria-labelledby="t-arq" id="arquivo-site"></section>` : ''}
      ${versoes.length ? `
      <section class="cartao" aria-labelledby="t-versoes">
        <h2 id="t-versoes">Versões enviadas</h2>
        <ul class="lista-simples">${versoes.map((v) => `<li><strong>Versão ${v.numero}</strong> · ${fmtDataHora(v.created_at)} · ${v.personalizada ? 'com personalização' : 'sem personalização'}${v.numero === Number(s.versao_aprovada) ? ' · <span data-etiqueta="ok">aprovada</span>' : ''}
          ${v.personalizada ? ` <button type="button" class="botao-texto" data-baixar-versao="${v.numero}">Baixar (.json)</button>` : ''}</li>`).join('')}</ul>
      </section>` : ''}`;

    const vis = document.getElementById('btn-visualizar');
    if (vis) vis.addEventListener('click', () => abrirNoEditor({ pasta: pastaDoModelo(dadosAtuais), dados: dadosAtuais, modo: 'preview', aoErro: mostrarErro }));
    const pedir = document.getElementById('btn-pedir-reenvio');
    if (pedir) pedir.addEventListener('click', () => executar(pedir, { acao: 'observacao', mensagem: MSG_REENVIO }, 'Pedido enviado. O cliente recebe a notificação e o link para reenviar.'));
    principal.querySelectorAll('[data-baixar-versao]').forEach((b) => b.addEventListener('click', () => baixarVersao(Number(b.dataset.baixarVersao))));

    historico.innerHTML = eventos.length ? eventos.map((e) => `
      <li>
        <p><strong>${esc(TIPOS[e.tipo] || e.tipo)}</strong>${e.status_para && e.status_para !== e.status_de ? ' → ' + esc(rotulo('solicitacao', e.status_para)) : ''}</p>
        ${e.mensagem ? `<p class="texto-livre">${esc(e.mensagem)}</p>` : ''}
        <small>${fmtDataHora(e.created_at)} · ${esc(e.autor_papel === 'admin' ? (e.autor_nome || 'Equipe CMK') : e.autor_papel === 'cliente' ? 'Cliente' : 'Sistema')}${e.versao ? ' · versão ' + e.versao : ''}${e.visivel_cliente ? '' : ' · interno'}</small>
      </li>`).join('') : '<li><small>Sem registros ainda.</small></li>';

    renderAcoes();
    renderArquivoSite(personalizada);
  }

  // ---------------- Arquivo do site (código final) ----------------
  // Tudo preenchido: o arquivo é gerado sozinho ao abrir a página. Faltando informação: lista
  // as pendências para cobrar o cliente; "Gerar" junta o que existe e "Liberar" entrega no
  // repositório do projeto (o cliente é avisado pela notificação do repositório).
  function renderArquivoSite(personalizada) {
    const box = document.getElementById('arquivo-site');
    if (!box) return;
    const versao = versaoMostrada;
    const atual = arquivosSite.find((a) => a.versao === versao) || null;
    const pend = !personalizada ? [{ tipo: 'sem', nivel: 'bloqueia', titulo: 'O cliente não personalizou o site (nome, textos, imagens e contatos)', itens: [] }]
      : !dadosAtuais ? [{ tipo: 'arquivo', nivel: 'bloqueia', titulo: 'O arquivo da personalização não chegou à plataforma', itens: [] }]
      : (atual && atual.resumo && Array.isArray(atual.resumo.pendencias) ? atual.resumo.pendencias : pendenciasDaPersonalizacao(dadosAtuais));
    const bloqueia = temBloqueio(pend);
    const podeCobrar = solicitacaoEditavel(s) || !!s.projeto_id;
    const r = (atual && atual.resumo) || {};
    box.innerHTML = `
      <div class="cartao-topo"><h2 id="t-arq">Arquivo do site (código)</h2></div>
      <h3 class="arq-sub">Pendências de personalização${dadosAtuais ? ' · versão ' + versao : ''}</h3>
      ${pendenciasHtml(pend)}
      ${bloqueia ? `
      <form id="form-cobrar" class="form-acao" novalidate>
        <p class="campo"><label for="cb-msg">Mensagem para cobrar o cliente</label><textarea id="cb-msg" rows="5" maxlength="2000">${esc(mensagemPendencias(pend))}</textarea></p>
        <p><button type="submit"${podeCobrar ? '' : ' disabled'}>${icone('mensagem')} Cobrar o cliente</button>
        <small>${solicitacaoEditavel(s) ? 'Pede ajustes: o cliente completa no editor e reenvia. Uma nova versão aparece aqui.' : s.projeto_id ? 'Vira uma pendência no projeto do cliente.' : 'Solicitação encerrada.'}</small></p>
      </form>` : ''}
      <h3 class="arq-sub">Arquivo gerado</h3>
      ${atual ? `
        <p class="arq-arquivo">${icone('arquivo')} <strong>${esc(r.nome || atual.nome)}</strong>
          <small>versão ${atual.versao} · ${fmtDataHora(atual.criadoEm)}${atual.tamanho ? ' · ' + Math.max(1, Math.round(atual.tamanho / 1024)) + ' KB' : ''}${r.automatico ? ' · gerado automaticamente' : r.geradoPor ? ' · por ' + esc(r.geradoPor) : ''}</small></p>
        ${Array.isArray(r.arquivos) && r.arquivos.length ? `<details><summary>${r.arquivos.length} arquivos no pacote</summary><p class="texto-livre">${r.arquivos.map(esc).join('\n')}</p></details>` : ''}
        <p><button type="button" id="btn-baixar-site">${icone('exportar')} Baixar código (.zip)</button></p>`
      : `<p data-arq-status>${dadosAtuais ? (bloqueia ? 'Ainda não gerado: faltam informações do cliente. Você pode cobrar acima ou gerar com o que existe.' : 'Ainda não gerado.') : 'Sem personalização recebida: não há o que gerar.'}</p>`}
      <p class="arq-status" id="arq-status" role="status" hidden></p>
      ${dadosAtuais ? `<p><button type="button" id="btn-gerar-site">${icone('recarregar')} ${atual ? 'Juntar as informações e gerar de novo' : 'Juntar as informações e gerar o arquivo'}</button></p>` : ''}
      ${atual ? `
      <form id="form-liberar" class="form-acao" novalidate>
        <h3>Liberar para o cliente</h3>
        ${s.projeto_id ? `
          <p class="campo"><label for="lb-msg">Mensagem que acompanha o arquivo</label><textarea id="lb-msg" rows="2" maxlength="500">Código do seu site, pronto para publicar.</textarea></p>
          <p><button type="submit">${icone('enviado')} Liberar arquivo pronto</button></p>`
        : '<p><small>A liberação fica disponível depois do pagamento: o arquivo vai para o repositório do projeto, que é criado quando o pagamento é confirmado.</small></p>'}
        ${liberados.length ? `<p><small>Já liberado: ${liberados.map((l) => esc(l.nome) + ' em ' + fmtDataHora(l.created_at)).join('; ')}. <a href="projeto.html?id=${encodeURIComponent(s.projeto_id)}#repositorio">Ver repositório</a></small></p>` : ''}
      </form>` : ''}`;

    const status = document.getElementById('arq-status');
    const dizer = (msg) => { status.textContent = msg || ''; status.hidden = !msg; };

    const cobrar = document.getElementById('form-cobrar');
    if (cobrar) cobrar.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('cb-msg').value.trim();
      if (!msg) { mostrarErro('Escreva a mensagem para o cliente.'); return; }
      if (solicitacaoEditavel(s)) {
        executar(e.submitter, { acao: 'ajustes', mensagem: msg }, 'Cliente cobrado: ele recebe o aviso e pode completar e reenviar.', (r2) => { if (r2.whatsapp_url) window.open(r2.whatsapp_url, '_blank', 'noopener'); });
        return;
      }
      ocupado(e.submitter, true, 'Enviando...');
      const { error } = await db.from('pendencias').insert({ projeto_id: s.projeto_id, titulo: 'Complete a personalização do seu site', descricao: msg });
      ocupado(e.submitter, false);
      if (error) { mostrarErro('Não foi possível criar a pendência: ' + error.message); return; }
      avisar('Pendência criada no projeto. O cliente foi avisado.');
    });

    const baixar = document.getElementById('btn-baixar-site');
    if (baixar) baixar.addEventListener('click', async () => {
      const { data, error } = await db.storage.from('arquivos').createSignedUrl(atual.caminho, 600, { download: s.codigo + '-' + (r.nome || 'site.zip') });
      if (error || !data) { mostrarErro('Arquivo não encontrado no Storage.'); return; }
      window.location.href = data.signedUrl;
    });

    async function gerar(botao, oculto) {
      mostrarErro('');
      if (botao) ocupado(botao, true, 'Gerando...');
      dizer(oculto ? 'Tudo preenchido: gerando o arquivo do site automaticamente...' : 'Gerando o arquivo na aba do editor...');
      try {
        const gerado = await gerarArquivoDoSite({ pasta: pastaDoModelo(dadosAtuais), dados: dadosAtuais, oculto });
        if (!gerado.pendencias) gerado.pendencias = pendenciasDaPersonalizacao(dadosAtuais);
        const novo = await guardarArquivoDoSite(s.id, versaoMostrada, gerado, { automatico: !!oculto, geradoPor: oculto ? null : (perfil.nome || perfil.email || null) });
        arquivosSite = [novo, ...arquivosSite];
        renderArquivoSite(personalizada);
        avisar(temBloqueio(gerado.pendencias) ? 'Arquivo gerado, mas ainda há pendências. Confira antes de liberar.' : 'Arquivo do site gerado.');
      } catch (err) {
        if (botao) ocupado(botao, false);
        dizer(oculto ? 'Não deu para gerar automaticamente (' + err.message + '). Clique em "Juntar as informações e gerar o arquivo".' : err.message);
      }
    }
    const btnGerar = document.getElementById('btn-gerar-site');
    if (btnGerar) btnGerar.addEventListener('click', () => {
      if (bloqueia && !window.confirm('Ainda há pendências de personalização. Gerar o arquivo mesmo assim, com o que o cliente enviou?')) return;
      gerar(btnGerar, false);
    });

    const liberar = document.getElementById('form-liberar');
    if (liberar && s.projeto_id) liberar.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (temBloqueio(pend) && !window.confirm('O arquivo tem pendências de personalização. Liberar para o cliente mesmo assim?')) return;
      mostrarErro('');
      ocupado(e.submitter, true, 'Liberando...');
      try {
        const nome = s.codigo + '-site.zip';
        const destino = s.projeto_id + '/equipe/' + Date.now() + '-' + nome;
        let cp = await db.storage.from('arquivos').copy(atual.caminho, destino);
        if (cp.error) { // sem cópia no servidor: baixa e envia de novo
          const dl = await db.storage.from('arquivos').download(atual.caminho);
          if (dl.error || !dl.data) throw new Error('Arquivo gerado não encontrado.');
          cp = await db.storage.from('arquivos').upload(destino, dl.data, { contentType: 'application/zip' });
          if (cp.error) throw new Error(cp.error.message);
        }
        const descricao = (document.getElementById('lb-msg').value.trim() || 'Código do seu site, pronto para publicar.') + ' (versão ' + atual.versao + ')';
        const { error } = await db.from('arquivos').insert({ projeto_id: s.projeto_id, nome, storage_path: destino, origem: 'equipe', enviado_por: perfil.id, descricao, tamanho: atual.tamanho });
        if (error) { await db.storage.from('arquivos').remove([destino]); throw new Error(error.message); }
        avisar('Arquivo liberado no repositório do projeto. O cliente foi avisado.');
        await carregar();
      } catch (err) {
        mostrarErro('Não foi possível liberar: ' + err.message);
        ocupado(e.submitter, false);
      }
    });

    // Tudo preenchido e ainda sem arquivo desta versão: gera sozinho, sem clique.
    if (dadosAtuais && !atual && !bloqueia && !autoTentado) { autoTentado = true; gerar(null, true); }
  }

  const TIPOS = {
    criada: 'Solicitação enviada', analise_iniciada: 'Análise iniciada', ajustes_solicitados: 'Ajustes solicitados',
    observacao: 'Observação da equipe', reenviada: 'Cliente reenviou com alterações', aprovada: 'Projeto aprovado',
    aguardando_cliente: 'Proposta enviada ao cliente', cliente_aprovou: 'Cliente aprovou a proposta',
    cliente_pediu_revisao: 'Cliente pediu revisão', cancelada: 'Cancelada', pagamento_confirmado: 'Pagamento confirmado',
    item_removido: 'Item retirado'
  };

  function renderAcoes() {
    const aberta = solicitacaoEditavel(s);
    if (!aberta) {
      acoes.innerHTML = s.status === 'paga'
        ? `<p>Pagamento confirmado. ${s.projeto_id ? `Acompanhe a preparação e a entrega em <a href="projeto.html?id=${encodeURIComponent(s.projeto_id)}">Projeto</a>.` : ''}</p>`
        : '<p>Solicitação cancelada.</p>';
      return;
    }
    const podeAnalisar = ['em_validacao', 'ajustes_solicitados', 'aguardando_cliente'].includes(s.status);
    const valorSugerido = s.valor_final != null ? Number(s.valor_final) : Number(s.valor_calculado) || '';
    acoes.innerHTML = `
      ${podeAnalisar ? '<p><button type="button" id="ac-analisar">' + icone('em-validacao') + ' Iniciar análise</button></p>' : ''}
      <form id="ac-aprovar" class="form-acao" novalidate>
        <h3>Aprovar projeto</h3>
        <p class="campo"><label for="ap-valor">Valor final (R$)</label><input id="ap-valor" type="number" min="1" step="0.01" inputmode="decimal" value="${esc(valorSugerido)}" required></p>
        <p class="campo"><label for="ap-msg">Mensagem ao cliente (opcional)</label><textarea id="ap-msg" rows="2" maxlength="1000"></textarea></p>
        <p><button type="submit">${icone('aprovar')} Aprovar e liberar pagamento</button></p>
        <p><small>Para mudar itens antes de aprovar, use <a href="admin.html?filtro=todas&busca=${encodeURIComponent(s.codigo)}">Itens e valor</a>. Se a equipe mudar itens, o cliente confirma a proposta antes de pagar.</small></p>
      </form>
      <form id="ac-ajustes" class="form-acao" novalidate>
        <h3>Solicitar ajustes</h3>
        <p class="campo"><label for="aj-msg">O que o cliente precisa corrigir</label><textarea id="aj-msg" rows="3" maxlength="2000" required></textarea></p>
        <p><button type="submit">${icone('editar')} Solicitar ajustes</button></p>
      </form>
      <form id="ac-obs" class="form-acao" novalidate>
        <h3>Enviar observação</h3>
        <p class="campo"><label for="ob-msg">Mensagem ao cliente</label><textarea id="ob-msg" rows="2" maxlength="2000" required></textarea></p>
        <p><button type="submit">${icone('mensagem')} Enviar observação</button></p>
      </form>`;

    const an = document.getElementById('ac-analisar');
    if (an) an.addEventListener('click', () => executar(an, { acao: 'analisar' }, 'Análise iniciada. O cliente foi avisado.'));
    document.getElementById('ac-aprovar').addEventListener('submit', (e) => {
      e.preventDefault();
      const valor = Number(document.getElementById('ap-valor').value);
      if (!(valor > 0)) { mostrarErro('Informe o valor final.'); return; }
      const sel = s.selecao || {};
      executar(e.submitter, {
        acao: 'aprovar', updated_at: s.updated_at, valor_final: valor, mensagem: document.getElementById('ap-msg').value,
        itens: {
          servicos: (sel.servicos || []).map((x) => ({ id: x.id, modelo: x.modelo || null, plano: x.plano || null, ...(x.variante ? { variante: x.variante } : {}) })),
          complementos: (sel.complementos || []).map((x) => ({ id: x.id, qtd: Number(x.qtd) || 1 })),
          personalizados: (sel.personalizados || []).map((x) => ({ id: x.id, nome: x.nome, descricao: x.descricao || '', valor: Number(x.valor) }))
        }
      }, (r) => (r.solicitacao && r.solicitacao.status === 'aguardando_cliente'
        ? 'Proposta enviada: o cliente confirma as alterações e depois paga.'
        : 'Projeto aprovado. Pagamento liberado para o cliente.'));
    });
    document.getElementById('ac-ajustes').addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = document.getElementById('aj-msg').value.trim();
      if (!msg) { mostrarErro('Explique o que o cliente precisa ajustar.'); return; }
      executar(e.submitter, { acao: 'ajustes', mensagem: msg }, 'Ajustes solicitados. O cliente foi avisado e pode editar e reenviar.', (r) => {
        if (r.whatsapp_url) window.open(r.whatsapp_url, '_blank', 'noopener');
      });
    });
    document.getElementById('ac-obs').addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = document.getElementById('ob-msg').value.trim();
      if (!msg) { mostrarErro('Escreva a mensagem.'); return; }
      executar(e.submitter, { acao: 'observacao', mensagem: msg }, 'Observação enviada ao cliente.');
    });
  }

  async function executar(botao, corpo, sucesso, depois) {
    mostrarErro('');
    ocupado(botao, true, 'Salvando...');
    try {
      const r = await api('admin-solicitacao', { ...corpo, solicitacao_id: s.id });
      avisar(typeof sucesso === 'function' ? sucesso(r) : sucesso);
      if (depois) depois(r);
      await carregar();
    } catch (e) {
      mostrarErro(e.message);
    } finally {
      ocupado(botao, false);
    }
  }

  async function baixarVersao(numero) {
    const caminho = PERS_PASTA(s.id, numero);
    const { data, error } = await db.storage.from('arquivos').createSignedUrl(caminho, 600, { download: s.codigo + '-v' + numero + '-personalizacao.json' });
    if (error || !data) { mostrarErro('Arquivo desta versão não encontrado no Storage.'); return; }
    window.location.href = data.signedUrl;
  }

  await carregar();
})();
