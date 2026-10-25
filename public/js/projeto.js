// =====================================================================
// projeto.js — tudo sobre um projeto: projeto.html?id=<uuid>
// Cliente: progresso, etapas, prazo, pendências, arquivos, funcionalidades
// e pagamentos. Admin: além disso, avança etapa, muda status/previsão/domínio
// e adiciona pendências e arquivos.
// =====================================================================
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;
  const admin = perfil.role === 'admin';

  const id = new URLSearchParams(window.location.search).get('id') || '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    mostrarErro('Projeto não encontrado.');
    document.getElementById('resumo-projeto').innerHTML = '<p><a href="projetos.html">Voltar para Meus projetos</a></p>';
    return;
  }
  document.getElementById('link-nova-funcionalidade').href = 'funcionalidades.html?projeto=' + encodeURIComponent(id);

  let projeto = null;
  await carregar();
  if (projeto && admin) prepararAdmin();

  async function carregar() {
    const [proj, etapas, pend, arqs, funcs, pags] = await Promise.all([
      db.from('projetos').select('*').eq('id', id).maybeSingle(),
      db.from('projeto_etapas').select('*').eq('projeto_id', id).order('ordem'),
      db.from('pendencias').select('*').eq('projeto_id', id).order('created_at', { ascending: false }),
      db.from('arquivos').select('*').eq('projeto_id', id).order('created_at', { ascending: false }),
      db.from('projeto_funcionalidades').select('*, funcionalidades(nome, descricao)').eq('projeto_id', id).order('created_at', { ascending: false }),
      db.from('pagamentos').select('*').eq('projeto_id', id).order('created_at', { ascending: false })
    ]);
    const erro = [proj, etapas, pend, arqs, funcs, pags].find((r) => r.error);
    if (erro) { mostrarErro('Não foi possível carregar o projeto: ' + erro.error.message); return; }
    if (!proj.data) {
      mostrarErro('Projeto não encontrado.');
      document.getElementById('resumo-projeto').innerHTML = '<p><a href="projetos.html">Voltar para Meus projetos</a></p>';
      return;
    }
    projeto = { ...proj.data, projeto_etapas: etapas.data };
    renderResumo(projeto);
    renderEtapas(etapas.data);
    renderPendencias(pend.data);
    await renderArquivos(arqs.data);
    renderFuncionalidades(funcs.data);
    renderPagamentos(pags.data);
  }

  function renderResumo(p) {
    document.getElementById('titulo').textContent = p.nome;
    document.title = p.nome + ' | CMK COGIT';
    const atrasado = p.previsao_entrega && p.status_projeto !== 'concluido' && new Date(p.previsao_entrega + 'T23:59:59') < new Date();
    document.getElementById('resumo-projeto').innerHTML = `
      <p>Progresso: ${barraProgresso(progressoProjeto(p))}</p>
      <dl>
        <dt>Código</dt><dd>${esc(p.codigo || '-')}</dd>
        <dt>Tipo</dt><dd>${esc(rotulo('tipo', p.tipo))}</dd>
        <dt>Endereço do site</dt><dd>${p.dominio ? linkDominio(p.dominio) : 'definido na publicação'}</dd>
        <dt>Status</dt><dd>${esc(rotulo('projeto', p.status_projeto))} — etapa ${Number(p.etapa_atual)} de 8</dd>
        <dt>Previsão de entrega</dt><dd>${p.previsao_entrega ? fmtData(p.previsao_entrega) : 'a definir'}${atrasado ? ' <small>(em revisão pela equipe)</small>' : ''}
          <br><small>Projetos maiores (mais soluções, sob medida ou complementos) têm prazo maior.</small></dd>
        <dt>Valor do projeto</dt><dd>${brl(p.valor_total)} · Pagamento: ${esc(rotulo('status_pagamento', p.status_pagamento))}</dd>
        <dt>Início</dt><dd>${fmtData(p.created_at)}</dd>
      </dl>
      <p><a href="${esc(linkWhatsApp('Olá! Sobre o meu projeto ' + (p.codigo || p.nome) + ' na plataforma COGIT.'))}" target="_blank" rel="noopener noreferrer">Falar com a equipe sobre este projeto</a></p>`;
  }

  function renderEtapas(etapas) {
    const ol = document.getElementById('lista-etapas');
    ol.innerHTML = etapas.length ? etapas.map((e) => `
      <li${e.status === 'em_andamento' ? ' aria-current="step"' : ''}>
        <strong>${esc(e.nome)}</strong> — ${esc(rotulo('etapa', e.status))}
        ${e.data_concluida ? ' <small>(concluída em ' + fmtData(e.data_concluida) + ')</small>' : e.data_prevista ? ' <small>(previsto: ' + fmtData(e.data_prevista) + ')</small>' : ''}
      </li>`).join('') : '<li>Etapas ainda não criadas.</li>';
  }

  function renderPendencias(pend) {
    const ul = document.getElementById('lista-pendencias');
    const abertas = pend.filter((x) => !x.resolvida);
    const resolvidas = pend.filter((x) => x.resolvida);
    if (!pend.length) { ul.innerHTML = '<li>Nada pendente com você no momento.</li>'; return; }
    ul.innerHTML = abertas.concat(resolvidas).map((x) => `
      <li>
        <strong>${esc(x.titulo)}</strong>${x.resolvida ? ' — <em>resolvida</em>' : ''}
        ${x.prazo ? ' <small>(prazo: ' + fmtData(x.prazo) + ')</small>' : ''}
        ${x.descricao ? '<br>' + esc(x.descricao) : ''}
        ${admin && !x.resolvida ? ` <button type="button" data-resolver="${esc(x.id)}">Marcar resolvida</button>` : ''}
      </li>`).join('');
    ul.querySelectorAll('[data-resolver]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      const { error } = await db.from('pendencias').update({ resolvida: true }).eq('id', b.dataset.resolver);
      if (error) { mostrarErro(error.message); b.disabled = false; return; }
      await carregar();
    }));
  }

  async function renderArquivos(arqs) {
    const ul = document.getElementById('lista-arquivos');
    if (!arqs.length) { ul.innerHTML = '<li>Nenhum arquivo ainda.</li>'; return; }
    const itens = await Promise.all(arqs.map(async (a) => {
      let href = null;
      if (a.url && /^https?:\/\//i.test(a.url)) href = a.url;
      else if (a.storage_path) {
        // arquivo no Supabase Storage (bucket "arquivos"): link temporário de 1 hora
        const { data } = await db.storage.from('arquivos').createSignedUrl(a.storage_path, 3600);
        href = data && data.signedUrl;
      }
      return `<li>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(a.nome)}</a>` : esc(a.nome)} <small>${fmtData(a.created_at)}</small></li>`;
    }));
    ul.innerHTML = itens.join('');
  }

  function renderFuncionalidades(funcs) {
    const ul = document.getElementById('lista-funcionalidades');
    ul.innerHTML = funcs.length ? funcs.map((f) => `
      <li><strong>${esc(f.funcionalidades ? f.funcionalidades.nome : 'Funcionalidade')}</strong> — ${brl(f.valor)} —
        ${esc(rotulo('funcionalidade', f.status))}
        ${f.status === 'aguardando_pagamento' ? ' <a href="pagamentos.html">Pagar</a>' : ''}</li>`).join('')
      : '<li>Nenhuma funcionalidade extra contratada.</li>';
  }

  function renderPagamentos(pags) {
    const ul = document.getElementById('lista-pagamentos');
    ul.innerHTML = pags.length ? pags.map((p) => `
      <li>${esc(p.descricao)} — ${brl(p.valor)} — ${esc(rotulo('pagamento', p.status))}
        ${p.status === 'pago' ? ' em ' + fmtData(p.pago_em) : ''}${p.metodo ? ' (' + esc(rotulo('metodo', p.metodo)) + ')' : ''}</li>`).join('')
      : '<li>Nenhum pagamento ligado a este projeto.</li>';
  }

  // ---------------- admin ----------------
  function prepararAdmin() {
    document.getElementById('painel-admin').hidden = false;
    document.getElementById('adm-etapa').value = String(projeto.etapa_atual || 1);
    document.getElementById('adm-status').value = projeto.status_projeto;
    document.getElementById('adm-previsao').value = projeto.previsao_entrega || '';
    document.getElementById('adm-dominio').value = projeto.dominio || '';

    document.getElementById('form-projeto').addEventListener('submit', async (e) => {
      e.preventDefault();
      mostrarErro('');
      const { error } = await db.rpc('admin_atualizar_projeto', {
        p_id: id,
        p_etapa: Number(document.getElementById('adm-etapa').value),
        p_status: document.getElementById('adm-status').value,
        p_previsao: document.getElementById('adm-previsao').value || null,
        p_dominio: document.getElementById('adm-dominio').value.trim() || null
      });
      if (error) return mostrarErro('Não foi possível salvar: ' + error.message);
      avisar('Projeto atualizado.');
      await carregar();
    });

    document.getElementById('form-pendencia').addEventListener('submit', async (e) => {
      e.preventDefault();
      const titulo = document.getElementById('pend-titulo').value.trim();
      if (!titulo) return;
      const prazo = document.getElementById('pend-prazo').value;
      const { error } = await db.from('pendencias').insert({
        projeto_id: id, titulo,
        descricao: document.getElementById('pend-descricao').value.trim() || null,
        prazo: prazo ? prazo + 'T23:59:00' : null
      });
      if (error) return mostrarErro('Não foi possível adicionar: ' + error.message);
      e.target.reset();
      avisar('Pendência adicionada.');
      await carregar();
    });

    document.getElementById('form-arquivo').addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('arq-url').value.trim();
      if (!/^https:\/\//i.test(url)) return mostrarErro('Use um link começando com https://');
      const { error } = await db.from('arquivos').insert({ projeto_id: id, nome: document.getElementById('arq-nome').value.trim(), url });
      if (error) return mostrarErro('Não foi possível adicionar: ' + error.message);
      e.target.reset();
      avisar('Arquivo adicionado.');
      await carregar();
    });
  }
})();
