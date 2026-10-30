// =====================================================================
// projeto.js — tudo sobre um projeto: projeto.html?id=<uuid>
// Cliente: progresso, etapas, prazo, pendências, repositório (baixa o que a
// equipe enviou e envia documentos), funcionalidades e pagamentos.
// Admin: além disso, avança etapa, muda status/previsão/domínio, adiciona
// pendências e envia arquivos/links ao repositório.
// =====================================================================
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;
  const admin = perfil.role === 'admin';
  // admin não compra: sem "adquirir funcionalidade"/"pagar"; volta para Clientes
  const voltarHtml = admin ? '<p><a href="admin-clientes.html">Voltar para Clientes</a></p>'
    : '<p><a href="projetos.html">Voltar para Meus projetos</a></p>';
  if (admin) {
    const voltar = document.getElementById('voltar');
    voltar.href = 'admin-clientes.html';
    voltar.textContent = '← Clientes';
    document.getElementById('acao-nova-funcionalidade').hidden = true;
    document.getElementById('titulo-pendencias').textContent = 'Pendências com o cliente';
  }

  const id = new URLSearchParams(window.location.search).get('id') || '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    mostrarErro('Projeto não encontrado.');
    document.getElementById('resumo-projeto').innerHTML = voltarHtml;
    return;
  }
  document.getElementById('link-nova-funcionalidade').href = 'funcionalidades.html?projeto=' + encodeURIComponent(id);

  let projeto = null;
  await carregar();
  if (projeto) prepararRepositorio();
  if (projeto && admin) prepararAdmin();
  if (projeto && window.location.hash === '#repositorio') document.getElementById('repositorio').scrollIntoView();

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
      document.getElementById('resumo-projeto').innerHTML = voltarHtml;
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
    document.title = p.nome + ' | CMKCOGIT';
    const atrasado = p.previsao_entrega && p.status_projeto !== 'concluido' && new Date(p.previsao_entrega + 'T23:59:59') < new Date();
    const pct = progressoProjeto(p);
    document.getElementById('subtitulo-projeto').innerHTML = `${esc(p.codigo || '')} · ${esc(rotulo('tipo', p.tipo))} · ${etiquetaStatus('projeto', p.status_projeto)}`;
    document.getElementById('resumo-projeto').innerHTML = `
      <div class="resumo-anel">${anelHtml(pct, `Progresso: ${pct}%`, true)}
        <p><strong>${p.status_projeto === 'concluido' ? 'Concluído' : 'Etapa ' + Number(p.etapa_atual) + ' de 8'}</strong>
        <small>${esc(rotulo('projeto', p.status_projeto))}</small></p></div>
      <dl class="dados-projeto">
        <dt>Código</dt><dd>${esc(p.codigo || '-')}</dd>
        <dt>Endereço do site</dt><dd>${p.dominio ? linkDominio(p.dominio) : 'definido na publicação'}</dd>
        <dt>Previsão de entrega</dt><dd>${p.previsao_entrega ? fmtData(p.previsao_entrega) : 'a definir'}${atrasado ? ' <small>(em revisão pela equipe)</small>' : ''}</dd>
        <dt>Valor do projeto</dt><dd>${brl(p.valor_total)} <small>${esc(rotulo('status_pagamento', p.status_pagamento))}</small></dd>
        <dt>Início</dt><dd>${fmtData(p.created_at)}</dd>
      </dl>
      <p class="nota">Projetos maiores (mais soluções, sob medida ou complementos) têm prazo maior.</p>
      <a class="widget-whatsapp" href="${esc(linkWhatsApp('Olá! Sobre o meu projeto ' + (p.codigo || p.nome) + ' na plataforma COGIT.'))}" target="_blank" rel="noopener noreferrer">${icone('whatsapp')}<span>Falar com a equipe<small>Sobre este projeto</small></span></a>`;
    animarNumeros(document.getElementById('resumo-projeto'));
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
    const itens = await Promise.all(arqs.map(async (a) => {
      let href = null;
      if (a.url && /^https?:\/\//i.test(a.url)) href = a.url;
      else if (a.storage_path) {
        // arquivo no Supabase Storage (bucket "arquivos"): link temporário de 1 hora
        const { data } = await db.storage.from('arquivos').createSignedUrl(a.storage_path, 3600, { download: a.nome });
        href = data && data.signedUrl;
      }
      const podeApagar = admin || (a.origem === 'cliente' && a.enviado_por === perfil.id);
      return { origem: a.origem || 'equipe', html: `<li>
        ${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(a.nome)}</a>` : esc(a.nome)}
        <small>${fmtData(a.created_at)}${a.tamanho ? ' · ' + fmtTamanho(a.tamanho) : ''}</small>
        ${a.descricao ? '<br>' + esc(a.descricao) : ''}
        ${podeApagar ? `<button type="button" data-apagar-arquivo="${esc(a.id)}">Excluir</button>` : ''}
      </li>` };
    }));
    const lista = (origem, vazio) => itens.filter((i) => i.origem === origem).map((i) => i.html).join('') || `<li>${vazio}</li>`;
    document.getElementById('lista-arquivos-equipe').innerHTML =
      lista('equipe', 'Nada por aqui ainda. Código, layouts e entregas aparecem assim que a equipe enviar.');
    document.getElementById('lista-arquivos-cliente').innerHTML =
      lista('cliente', admin ? 'O cliente ainda não enviou arquivos.' : 'Você ainda não enviou arquivos.');

    document.querySelectorAll('[data-apagar-arquivo]').forEach((b) => b.addEventListener('click', async () => {
      const a = arqs.find((x) => x.id === b.dataset.apagarArquivo);
      if (!a || !window.confirm(`Excluir "${a.nome}" do repositório?`)) return;
      b.disabled = true;
      mostrarErro('');
      if (a.storage_path) {
        const { error } = await db.storage.from('arquivos').remove([a.storage_path]);
        if (error) { mostrarErro('Não foi possível excluir: ' + error.message); b.disabled = false; return; }
      }
      const { error } = await db.from('arquivos').delete().eq('id', a.id);
      if (error) { mostrarErro('Não foi possível excluir: ' + error.message); b.disabled = false; return; }
      avisar('Arquivo excluído.');
      await carregar();
    }));
  }

  function renderFuncionalidades(funcs) {
    const ul = document.getElementById('lista-funcionalidades');
    ul.innerHTML = funcs.length ? funcs.map((f) => `
      <li><strong>${esc(f.funcionalidades ? f.funcionalidades.nome : 'Funcionalidade')}</strong> — ${brl(f.valor)} —
        ${esc(rotulo('funcionalidade', f.status))}
        ${f.status === 'aguardando_pagamento' && !admin ? ' <a href="pagamentos.html">Pagar</a>' : ''}</li>`).join('')
      : '<li>Nenhuma funcionalidade extra contratada.</li>';
  }

  function renderPagamentos(pags) {
    const ul = document.getElementById('lista-pagamentos');
    ul.innerHTML = pags.length ? pags.map((p) => `
      <li>${esc(p.descricao)} — ${brl(p.valor)} — ${esc(rotulo('pagamento', p.status))}
        ${p.status === 'pago' ? ' em ' + fmtData(p.pago_em) : ''}${p.metodo ? ' (' + esc(rotulo('metodo', p.metodo)) + ')' : ''}</li>`).join('')
      : '<li>Nenhum pagamento ligado a este projeto.</li>';
  }

  // ---------------- repositório: envio de arquivos ----------------
  // Caminho no bucket: <projeto>/<equipe|cliente>/<data>-<nome>; o Storage confere a pasta (sql/11)
  function prepararRepositorio() {
    const origem = admin ? 'equipe' : 'cliente';
    if (admin) {
      document.getElementById('titulo-arquivos-cliente').textContent = 'Enviados pelo cliente';
      document.getElementById('titulo-upload').textContent = 'Enviar arquivos para o cliente (código, layouts, entregas)';
    }
    document.getElementById('form-upload').addEventListener('submit', async (e) => {
      e.preventDefault();
      mostrarErro('');
      const arquivos = [...document.getElementById('up-arquivo').files];
      if (!arquivos.length) return;
      const grande = arquivos.find((f) => f.size > LIMITE_ARQUIVO);
      if (grande) return mostrarErro(`"${grande.name}" passa de 50 MB. Para arquivos maiores, envie um link (Drive, WeTransfer) pelo WhatsApp.`);
      const descricao = document.getElementById('up-descricao').value.trim() || null;
      const botao = e.target.querySelector('button');
      botao.disabled = true;
      let enviados = 0;
      for (const f of arquivos) {
        avisar(`Enviando ${enviados + 1} de ${arquivos.length}: ${f.name}...`);
        const caminho = `${id}/${origem}/${Date.now()}-${nomeSeguro(f.name)}`;
        const up = await db.storage.from('arquivos').upload(caminho, f, { contentType: f.type || 'application/octet-stream' });
        if (up.error) { mostrarErro(`Não foi possível enviar "${f.name}": ${up.error.message}`); break; }
        const { error } = await db.from('arquivos').insert({
          projeto_id: id, nome: f.name, storage_path: caminho, origem, enviado_por: perfil.id, descricao, tamanho: f.size
        });
        if (error) {
          await db.storage.from('arquivos').remove([caminho]);
          mostrarErro(`Não foi possível registrar "${f.name}": ${error.message}`);
          break;
        }
        enviados++;
      }
      botao.disabled = false;
      avisar(enviados ? `${enviados} ${enviados === 1 ? 'arquivo enviado' : 'arquivos enviados'}. ${admin ? 'O cliente foi avisado.' : 'A equipe foi avisada.'}` : '');
      if (enviados) { e.target.reset(); await carregar(); }
    });
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
      const { error } = await db.from('arquivos').insert({
        projeto_id: id, nome: document.getElementById('arq-nome').value.trim(), url, origem: 'equipe', enviado_por: perfil.id
      });
      if (error) return mostrarErro('Não foi possível adicionar: ' + error.message);
      e.target.reset();
      avisar('Arquivo adicionado.');
      await carregar();
    });
  }
})();

const LIMITE_ARQUIVO = 50 * 1024 * 1024;

function fmtTamanho(bytes) {
  const n = Number(bytes);
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
  return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}

// Nome aceito pelo Storage: sem acentos, espaços ou símbolos
function nomeSeguro(nome) {
  return String(nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(-100) || 'arquivo';
}
