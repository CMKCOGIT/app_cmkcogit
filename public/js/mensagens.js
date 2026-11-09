// mensagens.js — conversas dentro da plataforma (sql/25_mensagens.sql)
//   Cliente: uma conversa com a equipe (abre direto).
//   Admin: lista de conversas (clientes + equipe), notas internas, IA (Gemini, /api/mensagens-ia),
//   modelos de mensagem e envio manual pelo WhatsApp.
// Texto, áudio (MediaRecorder) e arquivos (Storage, bucket "mensagens"); editar e apagar a própria
// mensagem; tempo real pelo Supabase Realtime com atualização periódica de garantia.
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;
  const ADMIN = ehAdmin(perfil);
  const $ = (id) => document.getElementById(id);
  const app = $('msg-app');
  const texto = $('msg-texto');
  const form = $('msg-form');
  const rolagem = $('msg-rolagem');
  const linhas = $('msg-linhas');

  const LIMITE_ARQUIVO = 25 * 1024 * 1024;
  const POR_PAGINA = 40;
  const AUDIO_MAX_SEG = 300;
  const BUCKET = 'mensagens';
  const CAMPOS = 'id, conversa_id, autor_id, autor_nome, autor_papel, tipo, corpo, interna, anexo_path, anexo_nome, anexo_mime, anexo_tamanho, duracao_seg, editada_em, apagada_em, created_at, projeto_id, assunto';

  const estado = {
    conversas: [], filtro: 'todas', busca: '', atual: null,
    mensagens: [], temAntigas: false, editando: null, anexos: [],
    leituraOutro: null, canal: null, pessoas: null, modelos: [], categoria: 'todas'
  };
  const urls = new Map(); // anexo_path -> { url, expira }
  const ASSUNTOS = { duvida: 'Dúvida', prazo: 'Prazo e andamento', alteracao: 'Alteração', material: 'Material', pagamento: 'Pagamento', outro: 'Outro' };
  // Mensagens rápidas do cliente: um toque escolhe o assunto e começa o texto
  const ATALHOS = [
    { assunto: 'prazo', rotulo: 'Prazo e andamento', icone: 'prazo', texto: 'Olá! Gostaria de saber como está o andamento e a previsão de entrega do meu projeto.' },
    { assunto: 'alteracao', rotulo: 'Pedir alteração', icone: 'editar', texto: 'Olá! Gostaria de pedir uma alteração: ' },
    { assunto: 'material', rotulo: 'Enviar material', icone: 'anexo', texto: 'Olá! Estou enviando os materiais do projeto.', anexar: true },
    { assunto: 'duvida', rotulo: 'Tirar uma dúvida', icone: 'ajuda', texto: 'Olá! Tenho uma dúvida: ' },
    { assunto: 'pagamento', rotulo: 'Pagamento', icone: 'pagamentos', texto: 'Olá! Tenho uma dúvida sobre o pagamento: ' }
  ];
  const projetosPorCliente = new Map(); // cliente_id -> [{ id, codigo, nome }]
  let projetoInicial = new URLSearchParams(location.search).get('projeto');

  // ---------------------------------------------------------------
  // Papel: cliente vê só a conversa com a equipe
  // ---------------------------------------------------------------
  if (ADMIN) {
    $('msg-rotulo').textContent = 'Painel de gestão';
    $('msg-intro').textContent = 'Converse com clientes e com a equipe. Notas internas ficam só entre vocês.';
    $('msg-acoes-admin').hidden = false;
    $('btn-ia').hidden = false;
  } else {
    app.dataset.cliente = '';
    document.documentElement.classList.add('msg-cliente');
    $('msg-lista-painel').hidden = true;
    $('btn-voltar-lista').hidden = true;
  }

  // ---------------------------------------------------------------
  // Formatação (mesma sintaxe do WhatsApp: *negrito* _itálico_ ~riscado~)
  // ---------------------------------------------------------------
  function formatar(t, { marcarLacunas = false } = {}) {
    let h = esc(t || '');
    h = h.replace(/(^|[\s(>])\*([^*\n]+?)\*(?=$|[\s).,!?:;<])/g, '$1<strong>$2</strong>')
      .replace(/(^|[\s(>])_([^_\n]+?)_(?=$|[\s).,!?:;<])/g, '$1<em>$2</em>')
      .replace(/(^|[\s(>])~([^~\n]+?)~(?=$|[\s).,!?:;<])/g, '$1<s>$2</s>');
    if (marcarLacunas) h = h.replace(/\[([^\]\n]{1,60})\]|\{([a-z_]{2,20})\}/g, (m) => `<mark>${m}</mark>`);
    h = h.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
    return h.replace(/\n/g, '<br>');
  }
  const hora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const duracao = (s) => { s = Math.max(0, Math.round(Number(s) || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const tamanho = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const primeiroNome = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const foneWhats = (t) => {
    const d = String(t || '').replace(/\D/g, '');
    if (d.length === 10 || d.length === 11) return '55' + d;
    return d.length >= 12 ? d : '';
  };
  const urlWhats = (fone, msg) => 'https://wa.me/' + (fone || '') + '?text=' + encodeURIComponent(msg);
  const rascunhoChave = (id) => 'cmk_rascunho_' + id;
  const lerRascunho = (id) => { try { return localStorage.getItem(rascunhoChave(id)) || ''; } catch (_) { return ''; } };
  const salvarRascunho = (id, v) => { try { if (v) localStorage.setItem(rascunhoChave(id), v); else localStorage.removeItem(rascunhoChave(id)); } catch (_) {} };
  const telaPequena = () => window.matchMedia('(max-width: 767.98px)').matches;
  // um painel por vez quando a área do chat é estreita (mesmo limite da container query do CSS)
  const umaColuna = () => (document.querySelector('body.app > main')?.clientWidth || window.innerWidth) < 820;
  const toque = () => window.matchMedia('(pointer: coarse)').matches;

  // ---------------------------------------------------------------
  // Lista de conversas
  // ---------------------------------------------------------------
  async function carregarConversas() {
    const { data, error } = await db.rpc('listar_conversas');
    const ul = $('lista-conversas');
    ul.removeAttribute('aria-busy');
    if (error) {
      const faltaSql = /listar_conversas|function|schema cache/i.test(error.message || '');
      mostrarErro(faltaSql ? 'As mensagens ainda não estão ativas no banco (rode o sql/25_mensagens.sql).' : 'Não foi possível carregar as conversas: ' + error.message);
      ul.innerHTML = '';
      return false;
    }
    estado.conversas = data || [];
    renderLista();
    return true;
  }

  function renderLista() {
    const ul = $('lista-conversas');
    const n = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const q = n(estado.busca);
    const lista = estado.conversas.filter((c) => (estado.filtro === 'todas' || (estado.filtro === 'nao_lidas' ? c.nao_lidas > 0 : c.tipo === estado.filtro))
      && (!q || n(c.nome + ' ' + (c.email || '')).includes(q)));
    if (!lista.length) {
      ul.innerHTML = `<li class="msg-lista-vazia">${estado.conversas.length ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa ainda. Use <strong>Nova conversa</strong> para começar.'}</li>`;
      return;
    }
    ul.innerHTML = lista.map((c) => {
      const minha = c.ultima_autor === perfil.id;
      const limpa = String(c.ultima_previa || '').replace(/(^|\s)[*_~]+|[*_~]+(?=\s|$|[.,!?:;])/g, '$1');
      const previa = c.ultima_previa ? (minha ? 'Você: ' : '') + limpa : 'Sem mensagens ainda';
      const avatar = c.tipo === 'equipe' && !c.membros
        ? `<span class="avatar msg-avatar-equipe" aria-hidden="true">${icone('equipe')}</span>`
        : `<span class="avatar" aria-hidden="true"${c.tipo === 'equipe' ? ' data-equipe' : ''}>${esc(iniciais(c.nome))}</span>`;
      return `<li><button type="button" class="msg-conversa" data-conversa="${esc(c.id)}"${estado.atual && estado.atual.id === c.id ? ' aria-current="true"' : ''}>
        ${avatar}
        <span class="msg-conversa-texto">
          <span class="msg-conversa-linha"><strong>${esc(c.nome || 'Conversa')}</strong><time datetime="${esc(c.ultima_em)}">${esc(rotuloCurto(c.ultima_em))}</time></span>
          <span class="msg-conversa-linha"><span class="msg-conversa-previa">${c.ultima_interna ? icone('nota') : ''}${esc(previa)}</span>
            ${c.nao_lidas ? `<span class="msg-badge" aria-label="${c.nao_lidas} não lidas">${c.nao_lidas > 99 ? '99+' : c.nao_lidas}</span>` : ''}</span>
          ${c.tipo === 'equipe' && c.membros ? '<span class="msg-tag-equipe">Equipe</span>' : ''}
        </span></button></li>`;
    }).join('');
  }
  function rotuloCurto(d) {
    if (!d) return '';
    const r = rotuloDia(d);
    return r === 'Hoje' ? hora(d) : r === 'Ontem' ? 'Ontem' : new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  $('lista-conversas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-conversa]');
    if (b) abrirConversa(b.dataset.conversa);
  });
  $('msg-busca').addEventListener('input', (e) => { estado.busca = e.target.value; renderLista(); });
  document.querySelectorAll('.msg-filtros [data-filtro]').forEach((b) => b.addEventListener('click', () => {
    estado.filtro = b.dataset.filtro;
    document.querySelectorAll('.msg-filtros [data-filtro]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderLista();
  }));

  // ---------------------------------------------------------------
  // Abrir conversa
  // ---------------------------------------------------------------
  async function abrirConversa(id, { foco = true } = {}) {
    let c = estado.conversas.find((x) => x.id === id);
    if (!c) { await carregarConversas(); c = estado.conversas.find((x) => x.id === id); }
    if (!c) { toast('Conversa não encontrada.', 'erro'); return; }
    if (estado.atual && estado.atual.id !== id) { salvarRascunho(estado.atual.id, texto.value); cancelarEdicao(); limparAnexos(); }
    estado.atual = c;
    estado.mensagens = [];
    fecharIa();

    const params = new URLSearchParams(location.search);
    params.delete('cliente');
    params.delete('projeto');
    params.set('c', id);
    history.replaceState(null, '', location.pathname + '?' + params);

    $('thread-vazia').hidden = true;
    $('thread-topo').hidden = false;
    rolagem.hidden = false;
    form.hidden = false;
    app.dataset.vista = 'conversa';
    document.documentElement.classList.toggle('msg-em-conversa', ADMIN && telaPequena());
    renderLista();
    montarTopo(c);
    montarContexto(c);
    linhas.innerHTML = '<li class="msg-carregando">' + carregandoCogit('Carregando mensagens...') + '</li>';

    const podeNota = ADMIN && c.tipo === 'cliente';
    $('chave-nota').hidden = !podeNota;
    $('msg-interna').checked = false;
    atualizarModoNota();
    texto.value = lerRascunho(id);
    ajustarAltura();
    atualizarBotoes();

    await carregarMensagens();
    ouvirConversa(id);
    marcarLida();
    if (foco && !toque()) texto.focus({ preventScroll: true });
    if (ADMIN && c.tipo === 'cliente' && !$('msg-detalhes').hidden) montarDetalhes();
  }

  function montarTopo(c) {
    const av = $('thread-avatar');
    const grupo = c.tipo === 'equipe' && !c.membros;
    av.innerHTML = grupo || !ADMIN ? icone(grupo ? 'equipe' : 'mensagens') : esc(iniciais(c.nome));
    av.classList.toggle('msg-avatar-equipe', grupo || !ADMIN);
    $('thread-nome').textContent = c.nome || 'Conversa';
    $('thread-sub').textContent = !ADMIN ? 'Normalmente respondemos em até 1 dia útil.'
      : c.tipo === 'cliente' ? [c.email, c.telefone && formatarTelefone(c.telefone)].filter(Boolean).join(' · ') || 'Cliente'
        : grupo ? 'Todos os administradores' : 'Conversa interna · ' + (c.email || '');
    const fone = ADMIN && c.tipo === 'cliente' ? foneWhats(c.telefone) : '';
    const w = $('thread-whatsapp');
    w.hidden = !fone;
    if (fone) w.href = 'https://wa.me/' + fone;
    $('btn-detalhes').hidden = !(ADMIN && c.tipo === 'cliente');
    $('btn-modelos-conversa').hidden = !(ADMIN && c.tipo === 'cliente');
    if ($('btn-detalhes').hidden) fecharDetalhes();
  }

  // ---- Sobre o que é a mensagem (projeto e assunto) ----
  async function projetosDoCliente(clienteId) {
    if (!projetosPorCliente.has(clienteId)) {
      let q = db.from('projetos').select('id, codigo, nome, status_projeto').order('created_at', { ascending: false });
      if (ADMIN) q = q.eq('cliente_id', clienteId);
      const { data } = await q;
      projetosPorCliente.set(clienteId, data || []);
    }
    return projetosPorCliente.get(clienteId);
  }
  function projetoPorId(id) {
    for (const lista of projetosPorCliente.values()) { const p = lista.find((x) => x.id === id); if (p) return p; }
    return null;
  }
  function rotuloContexto(m) {
    const p = m.projeto_id && projetoPorId(m.projeto_id);
    return [m.assunto && ASSUNTOS[m.assunto], p && (p.codigo ? p.codigo + ' · ' + p.nome : p.nome)].filter(Boolean).join(' · ');
  }
  async function montarContexto(c) {
    const barra = $('contexto-barra');
    const sel = $('msg-projeto');
    $('msg-assunto').value = '';
    sel.innerHTML = '<option value="">Geral</option>';
    if (c.tipo !== 'cliente') { barra.hidden = true; atualizarAtalhos(); return; }
    const projetos = await projetosDoCliente(c.cliente_id);
    if (estado.atual !== c) return;
    sel.innerHTML = '<option value="">Geral</option>' + projetos.map((p) => `<option value="${esc(p.id)}">${esc(p.codigo ? p.codigo + ' · ' + p.nome : p.nome)}</option>`).join('');
    if (projetoInicial && projetos.some((p) => p.id === projetoInicial)) sel.value = projetoInicial;
    else if (projetos.length === 1 && !ADMIN) sel.value = projetos[0].id; // um projeto só: já vem marcado
    projetoInicial = null;
    $('campo-projeto').hidden = !projetos.length;
    $('campo-assunto').hidden = ADMIN;
    barra.hidden = ADMIN && !projetos.length;
    marcarSelecionados();
    atualizarAtalhos();
    if (estado.mensagens.length) renderMensagens(); // etiquetas com o nome do projeto
  }
  function marcarSelecionados() {
    ['msg-projeto', 'msg-assunto'].forEach((id) => $(id).closest('label').toggleAttribute('data-escolhido', Boolean($(id).value)));
  }
  $('msg-projeto').addEventListener('change', marcarSelecionados);
  $('msg-assunto').addEventListener('change', marcarSelecionados);
  const contexto = () => ({ projeto_id: estado.atual && estado.atual.tipo === 'cliente' ? $('msg-projeto').value || null : null, assunto: !ADMIN ? $('msg-assunto').value || null : null });

  function atualizarAtalhos() {
    const box = $('msg-atalhos');
    const mostrar = !ADMIN && estado.atual && !texto.value.trim() && !estado.anexos.length && !estado.editando && !gravacao.rec;
    box.hidden = !mostrar;
    if (mostrar && !box.children.length) {
      box.innerHTML = ATALHOS.map((a, i) => `<button type="button" data-atalho="${i}">${icone(a.icone)}<span>${esc(a.rotulo)}</span></button>`).join('');
    }
  }
  $('msg-atalhos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-atalho]');
    if (!b) return;
    const a = ATALHOS[Number(b.dataset.atalho)];
    $('msg-assunto').value = a.assunto;
    marcarSelecionados();
    texto.value = a.texto;
    ajustarAltura(); atualizarBotoes();
    texto.focus();
    texto.setSelectionRange(texto.value.length, texto.value.length);
    if (a.anexar) $('msg-arquivo').click();
  });

  $('btn-voltar-lista').addEventListener('click', () => {
    app.dataset.vista = 'lista';
    document.documentElement.classList.remove('msg-em-conversa');
    fecharDetalhes();
    if (estado.atual) salvarRascunho(estado.atual.id, texto.value);
  });
  window.addEventListener('resize', () => {
    document.documentElement.classList.toggle('msg-em-conversa', ADMIN && telaPequena() && app.dataset.vista === 'conversa');
  }, { passive: true });

  // ---------------------------------------------------------------
  // Mensagens
  // ---------------------------------------------------------------
  async function carregarMensagens({ antigas = false } = {}) {
    const c = estado.atual;
    let q = db.from('mensagens').select(CAMPOS).eq('conversa_id', c.id).order('created_at', { ascending: false }).limit(POR_PAGINA + 1);
    if (antigas && estado.mensagens.length) q = q.lt('created_at', estado.mensagens[0].created_at);
    const [{ data, error }, leitura] = await Promise.all([q, db.rpc('leitura_da_conversa', { p_conversa: c.id })]);
    if (estado.atual !== c) return;
    if (error) { linhas.innerHTML = `<li class="msg-lista-vazia">Não foi possível carregar: ${esc(error.message)}</li>`; return; }
    estado.leituraOutro = leitura && !leitura.error ? leitura.data : null;
    const lote = (data || []).slice(0, POR_PAGINA).reverse();
    estado.temAntigas = (data || []).length > POR_PAGINA;
    await assinarUrls(lote);
    if (antigas) {
      const altura = rolagem.scrollHeight;
      estado.mensagens = [...lote, ...estado.mensagens];
      renderMensagens();
      rolagem.scrollTop = rolagem.scrollHeight - altura;
    } else {
      estado.mensagens = lote;
      renderMensagens();
      irParaFim(false);
    }
  }
  $('btn-antigas').addEventListener('click', async (e) => {
    ocupado(e.currentTarget, true, 'Carregando...');
    await carregarMensagens({ antigas: true });
    ocupado(e.currentTarget, false);
  });

  async function assinarUrls(lista) {
    const agora = Date.now();
    const faltam = [...new Set(lista.filter((m) => m.anexo_path && !m.apagada_em).map((m) => m.anexo_path))]
      .filter((p) => !urls.has(p) || urls.get(p).expira < agora);
    if (!faltam.length) return;
    const { data } = await db.storage.from(BUCKET).createSignedUrls(faltam, 3600);
    (data || []).forEach((d) => { if (d.signedUrl) urls.set(d.path, { url: d.signedUrl, expira: agora + 50 * 60000 }); });
  }

  function renderMensagens() {
    const c = estado.atual;
    $('btn-antigas').hidden = !estado.temAntigas;
    if (!estado.mensagens.length) {
      linhas.innerHTML = `<li class="msg-inicio-conversa">
        <span class="avatar msg-avatar-equipe" aria-hidden="true">${icone(ADMIN ? 'mensagens' : 'equipe')}</span>
        <strong>${ADMIN ? 'Comece a conversa' : 'Fale com a equipe CMKCOGIT'}</strong>
        <span>${ADMIN ? (c.tipo === 'cliente' ? 'O cliente é avisado no sino da plataforma. Precisa de ajuda para escrever? Use a IA ou um modelo.' : 'Só administradores veem esta conversa.') : 'Tire dúvidas, envie arquivos ou grave um áudio. Você é avisado aqui quando respondermos.'}</span></li>`;
      return;
    }
    let dia = '';
    let anterior = null;
    const minhasLidas = estado.leituraOutro ? new Date(estado.leituraOutro).getTime() : 0;
    linhas.innerHTML = estado.mensagens.map((m) => {
      const r = rotuloDia(m.created_at);
      let cabeca = '';
      if (r !== dia) { cabeca = `<li class="msg-dia" aria-hidden="true"><span>${esc(r)}</span></li>`; dia = r; anterior = null; }
      const eu = m.autor_id === perfil.id;
      const junta = anterior && anterior.autor_id === m.autor_id && anterior.interna === m.interna
        && (new Date(m.created_at) - new Date(anterior.created_at)) < 5 * 60000;
      anterior = m;
      return cabeca + mensagemHtml(m, { eu, junta, lida: eu && minhasLidas >= new Date(m.created_at).getTime() });
    }).join('');
    ligarAudios(linhas);
  }

  // Nome no balão só quando há mais de uma pessoa possível do outro lado: no grupo da equipe,
  // e nas conversas com cliente quando quem escreveu foi alguém da equipe. Numa conversa 1:1
  // o cabeçalho já diz quem é, repetir o nome em cada balão é ruído.
  function mostrarAutor(m) {
    const c = estado.atual;
    if (c.tipo === 'equipe') return !c.membros;
    return m.autor_papel === 'admin';
  }
  function nomeAutor(m) {
    if (m.autor_papel === 'admin') return ADMIN ? m.autor_nome : primeiroNome(m.autor_nome) + ' · Equipe CMKCOGIT';
    return m.autor_nome || 'Cliente';
  }

  function conteudoHtml(m) {
    if (m.apagada_em) return `<p class="msg-apagada">${icone('cancelado')} Mensagem apagada</p>`;
    const u = m.anexo_path && urls.get(m.anexo_path);
    if (m.tipo === 'audio') {
      return `<div class="msg-audio" data-duracao="${Number(m.duracao_seg) || 0}">
          <button type="button" class="msg-audio-tocar" aria-label="Tocar áudio">${icone('tocar')}</button>
          <input type="range" min="0" max="1000" value="0" aria-label="Posição do áudio" class="msg-audio-barra" style="--p:0%">
          <span class="msg-audio-tempo">${duracao(m.duracao_seg)}</span>
          <button type="button" class="msg-audio-vel" aria-label="Velocidade">1×</button>
          ${u ? `<audio preload="metadata" src="${esc(u.url)}"></audio>` : ''}
        </div>${m.corpo ? `<p>${formatar(m.corpo)}</p>` : ''}`;
    }
    if (m.tipo === 'arquivo') {
      const imagem = /^image\/(png|jpe?g|gif|webp|avif)$/i.test(m.anexo_mime || '');
      const corpo = m.corpo ? `<p>${formatar(m.corpo)}</p>` : '';
      if (imagem && u) {
        return `<a class="msg-imagem" href="${esc(u.url)}" target="_blank" rel="noopener noreferrer" title="Abrir ${esc(m.anexo_nome)}">
          <img src="${esc(u.url)}" alt="${esc(m.anexo_nome || 'Imagem')}" loading="lazy" decoding="async"></a>${corpo}`;
      }
      return `<a class="msg-arquivo" ${u ? `href="${esc(u.url)}" download="${esc(m.anexo_nome || '')}" target="_blank" rel="noopener noreferrer"` : 'aria-disabled="true"'}>
          <span class="msg-arquivo-icone" aria-hidden="true">${icone(/pdf/i.test(m.anexo_mime || '') ? 'pdf' : 'arquivo')}</span>
          <span class="msg-arquivo-texto"><strong>${esc(m.anexo_nome || 'Arquivo')}</strong><small>${m.anexo_tamanho ? tamanho(m.anexo_tamanho) + ' · ' : ''}Baixar</small></span>
          ${icone('exportar')}</a>${corpo}`;
    }
    return `<p>${formatar(m.corpo)}</p>`;
  }

  function contextoHtml(m) {
    if (m.apagada_em || (!m.projeto_id && !m.assunto)) return '';
    const rot = rotuloContexto(m) || (m.assunto ? ASSUNTOS[m.assunto] : 'Projeto');
    const conteudo = `${icone(m.projeto_id ? 'projetos' : 'info')}<span>${esc(rot)}</span>`;
    return m.projeto_id
      ? `<a class="msg-contexto" href="projeto.html?id=${esc(m.projeto_id)}" title="Abrir o projeto">${conteudo}</a>`
      : `<span class="msg-contexto">${conteudo}</span>`;
  }

  function mensagemHtml(m, { eu, junta, lida }) {
    const podeEditar = eu && !m.apagada_em && m.tipo === 'texto';
    const podeApagar = eu && !m.apagada_em;
    const podeWhats = ADMIN && estado.atual.tipo === 'cliente' && !m.apagada_em && m.tipo === 'texto' && !m.interna;
    const acoes = [
      !m.apagada_em && m.corpo ? `<button type="button" role="menuitem" data-acao="copiar">${icone('copiar')} Copiar</button>` : '',
      podeWhats ? `<button type="button" role="menuitem" data-acao="whatsapp">${icone('whatsapp')} Enviar pelo WhatsApp</button>` : '',
      podeEditar ? `<button type="button" role="menuitem" data-acao="editar">${icone('editar')} Editar</button>` : '',
      podeApagar ? `<button type="button" role="menuitem" data-acao="apagar" data-perigo>${icone('remover')} Apagar</button>` : ''
    ].join('');
    const status = eu && !m.apagada_em
      ? (m._pendente ? `<span class="msg-status" title="Enviando">${icone('relogio')}</span>`
        : `<span class="msg-status"${lida ? ' data-lida' : ''} title="${lida ? 'Visto' : 'Enviada'}">${icone(lida ? 'lido' : 'enviada')}<span class="so-leitor-tela">${lida ? 'Visto' : 'Enviada'}</span></span>`)
      : '';
    return `<li class="msg" data-id="${esc(m.id)}" data-lado="${eu ? 'eu' : 'outro'}"${junta ? ' data-junta' : ''}${m.interna ? ' data-interna' : ''}${m._pendente ? ' data-pendente' : ''}${m._erro ? ' data-erro' : ''}>
      ${!eu && !junta ? `<span class="avatar msg-avatar" aria-hidden="true"${m.autor_papel === 'admin' && !ADMIN ? ' data-equipe' : ''}>${esc(iniciais(m.autor_nome))}</span>` : ''}
      <div class="msg-balao" data-tipo="${esc(m.tipo)}">
        ${m.interna ? `<span class="msg-tag-nota">${icone('nota')} Nota interna · só a equipe vê</span>` : ''}
        ${!eu && !junta && mostrarAutor(m) ? `<span class="msg-autor">${esc(nomeAutor(m))}</span>` : ''}
        ${contextoHtml(m)}
        ${conteudoHtml(m)}
        <span class="msg-meta">${m.editada_em && !m.apagada_em ? '<span>editada</span>' : ''}<time datetime="${esc(m.created_at)}" title="${esc(fmtDataHora(m.created_at))}">${esc(hora(m.created_at))}</time>${status}</span>
        ${m._erro ? `<button type="button" class="msg-reenviar" data-acao="reenviar">${icone('recarregar')} Não enviada. Tentar de novo</button>` : ''}
      </div>
      ${acoes && !m._pendente ? `<div class="msg-acoes">
        <button type="button" class="msg-mais" aria-haspopup="menu" aria-expanded="false" aria-label="Opções da mensagem">${icone('opcoes')}</button>
        <div class="msg-menu" role="menu" hidden>${acoes}</div></div>` : ''}
    </li>`;
  }

  // Player de áudio (um tocando por vez)
  function ligarAudios(raiz) {
    raiz.querySelectorAll('.msg-audio:not([data-ligado])').forEach((caixa) => {
      caixa.dataset.ligado = '';
      const audio = caixa.querySelector('audio');
      const btn = caixa.querySelector('.msg-audio-tocar');
      const barra = caixa.querySelector('.msg-audio-barra');
      const tempo = caixa.querySelector('.msg-audio-tempo');
      const vel = caixa.querySelector('.msg-audio-vel');
      const total = () => (audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(caixa.dataset.duracao) || 0);
      if (!audio) { btn.disabled = true; return; }
      btn.addEventListener('click', () => {
        if (audio.paused) { document.querySelectorAll('.msg-audio audio').forEach((a) => { if (a !== audio) a.pause(); }); audio.play().catch(() => toast('Não foi possível tocar o áudio.', 'erro')); }
        else audio.pause();
      });
      audio.addEventListener('play', () => { btn.innerHTML = icone('pausar'); btn.setAttribute('aria-label', 'Pausar áudio'); caixa.dataset.tocando = ''; });
      audio.addEventListener('pause', () => { btn.innerHTML = icone('tocar'); btn.setAttribute('aria-label', 'Tocar áudio'); delete caixa.dataset.tocando; });
      audio.addEventListener('timeupdate', () => {
        const t = total();
        const p = t ? Math.min(1, audio.currentTime / t) : 0;
        barra.value = String(Math.round(p * 1000));
        barra.style.setProperty('--p', (p * 100).toFixed(1) + '%');
        tempo.textContent = duracao(audio.currentTime || 0) + ' / ' + duracao(t);
      });
      audio.addEventListener('ended', () => { audio.currentTime = 0; barra.value = '0'; barra.style.setProperty('--p', '0%'); tempo.textContent = duracao(total()); });
      barra.addEventListener('input', () => {
        const t = total();
        if (t) audio.currentTime = (Number(barra.value) / 1000) * t;
        barra.style.setProperty('--p', Number(barra.value) / 10 + '%');
      });
      vel.addEventListener('click', () => {
        const prox = { 1: 1.5, 1.5: 2, 2: 1 }[audio.playbackRate] || 1;
        audio.playbackRate = prox;
        vel.textContent = String(prox).replace('.', ',') + '×';
      });
    });
  }

  function irParaFim(suave = true) {
    requestAnimationFrame(() => {
      rolagem.scrollTo({ top: rolagem.scrollHeight, behavior: suave && !MOVIMENTO_REDUZIDO ? 'smooth' : 'auto' });
      $('btn-novas').hidden = true;
    });
  }
  const pertoDoFim = () => rolagem.scrollHeight - rolagem.scrollTop - rolagem.clientHeight < 120;
  rolagem.addEventListener('scroll', () => { if (pertoDoFim()) $('btn-novas').hidden = true; }, { passive: true });
  $('btn-novas').addEventListener('click', () => irParaFim());

  // Mensagem nova ou alterada (envio, tempo real ou atualização periódica)
  async function receber(m) {
    if (!estado.atual || m.conversa_id !== estado.atual.id) return;
    if (m.interna && !ADMIN) return;
    await assinarUrls([m]);
    const i = estado.mensagens.findIndex((x) => x.id === m.id);
    const estavaNoFim = pertoDoFim();
    if (i >= 0) estado.mensagens[i] = m;
    else {
      estado.mensagens.push(m);
      estado.mensagens.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
    renderMensagens();
    if (i < 0) {
      if (m.autor_id === perfil.id || estavaNoFim) irParaFim();
      else $('btn-novas').hidden = false;
      if (m.autor_id !== perfil.id) marcarLida();
    }
  }

  let timerLida = null;
  function marcarLida() {
    clearTimeout(timerLida);
    timerLida = setTimeout(async () => {
      if (!estado.atual || document.hidden) return;
      const c = estado.atual;
      const { error } = await db.rpc('marcar_conversa_lida', { p_conversa: c.id });
      if (error) return;
      c.nao_lidas = 0;
      renderLista();
      contarMensagensNaoLidas();
      if (typeof Sino !== 'undefined') Sino.atualizar();
    }, 400);
  }

  // ---------------------------------------------------------------
  // Tempo real + garantia periódica
  // ---------------------------------------------------------------
  function ouvirConversa(id) {
    try {
      if (estado.canal) db.removeChannel(estado.canal);
      estado.canal = db.channel('conversa-' + id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'mensagens', filter: 'conversa_id=eq.' + id },
          (p) => { if (p.new && p.new.id) receber(p.new); })
        .subscribe();
    } catch (e) { console.warn('Tempo real indisponível:', e.message); }
  }
  let timerLista = null;
  const atualizarListaLogo = () => { clearTimeout(timerLista); timerLista = setTimeout(() => { if (ADMIN) carregarConversas(); }, 500); };
  if (ADMIN) {
    try {
      db.channel('mensagens-lista-' + perfil.id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensagens' }, atualizarListaLogo)
        .subscribe();
    } catch (_) {}
  }
  async function sincronizar() {
    if (document.hidden) return;
    if (ADMIN) carregarConversas();
    const c = estado.atual;
    if (!c) return;
    const ultima = estado.mensagens.filter((m) => !m._pendente).slice(-1)[0];
    let q = db.from('mensagens').select(CAMPOS).eq('conversa_id', c.id).order('created_at', { ascending: true }).limit(50);
    if (ultima) q = q.gt('created_at', ultima.created_at);
    const [{ data }, leitura] = await Promise.all([q, db.rpc('leitura_da_conversa', { p_conversa: c.id })]);
    if (estado.atual !== c) return;
    const mudouLeitura = leitura && !leitura.error && leitura.data !== estado.leituraOutro;
    if (mudouLeitura) estado.leituraOutro = leitura.data;
    for (const m of data || []) await receber(m);
    if (mudouLeitura && !(data || []).length) renderMensagens();
  }
  setInterval(sincronizar, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { sincronizar(); if (estado.atual) marcarLida(); } });

  // ---------------------------------------------------------------
  // Compositor: texto, envio, edição
  // ---------------------------------------------------------------
  const PODE_GRAVAR = Boolean(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  function ajustarAltura() {
    texto.style.height = 'auto';
    texto.style.height = Math.min(texto.scrollHeight, 180) + 'px';
  }
  function atualizarBotoes() {
    const temConteudo = texto.value.trim() || estado.anexos.length || estado.editando;
    $('btn-enviar').hidden = !temConteudo && PODE_GRAVAR;
    $('btn-gravar').hidden = Boolean(temConteudo) || !PODE_GRAVAR;
    $('contexto-barra').classList.toggle('msg-desativado', Boolean(estado.editando));
    if (typeof atualizarAtalhos === 'function' && estado.atual) atualizarAtalhos();
  }
  function atualizarModoNota() {
    const nota = $('msg-interna').checked;
    form.toggleAttribute('data-nota', nota);
    $('faixa-nota').hidden = !nota;
    texto.placeholder = nota ? 'Escreva uma nota para a equipe' : 'Escreva uma mensagem';
  }
  $('msg-interna').addEventListener('change', () => { atualizarModoNota(); texto.focus(); });
  texto.addEventListener('input', () => {
    ajustarAltura();
    atualizarBotoes();
    if (estado.atual && !estado.editando) salvarRascunho(estado.atual.id, texto.value);
  });
  texto.addEventListener('focus', () => { if (telaPequena() && toque()) { document.documentElement.classList.add('msg-digitando'); setTimeout(() => { if (pertoDoFim()) irParaFim(false); }, 250); } });
  texto.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== texto) document.documentElement.classList.remove('msg-digitando'); }, 150));
  texto.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !toque()) { e.preventDefault(); form.requestSubmit(); return; }
    if (e.key === 'Escape' && estado.editando) { e.preventDefault(); cancelarEdicao(); return; }
    if (e.key === 'ArrowUp' && !texto.value && !estado.editando) {
      const ultima = [...estado.mensagens].reverse().find((m) => m.autor_id === perfil.id && m.tipo === 'texto' && !m.apagada_em && !m._pendente);
      if (ultima) { e.preventDefault(); iniciarEdicao(ultima); }
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!estado.atual) return;
    if (estado.editando) { await salvarEdicao(); return; }
    const corpo = texto.value.trim();
    const anexos = estado.anexos.slice();
    if (!corpo && !anexos.length) return;
    const interna = $('msg-interna').checked;
    const ctx = contexto();
    texto.value = '';
    salvarRascunho(estado.atual.id, '');
    limparAnexos();
    ajustarAltura();
    atualizarBotoes();
    texto.focus({ preventScroll: true });
    $('msg-assunto').value = ''; // o assunto vale para esta mensagem; o projeto continua escolhido
    marcarSelecionados();
    atualizarAtalhos();
    if (corpo) await enviarTexto(corpo, interna, null, ctx);
    for (const f of anexos) await enviarArquivo(f, { interna, tipo: 'arquivo', ctx });
  });

  function provisoria(campos) {
    const m = {
      id: 'tmp-' + Math.random().toString(36).slice(2), conversa_id: estado.atual.id, autor_id: perfil.id,
      autor_nome: perfil.nome, autor_papel: perfil.role, created_at: new Date().toISOString(), _pendente: true, ...campos
    };
    estado.mensagens.push(m);
    renderMensagens();
    irParaFim();
    return m;
  }
  function trocarProvisoria(tmp, real, erro) {
    const i = estado.mensagens.findIndex((x) => x.id === tmp.id);
    if (real) {
      const dup = estado.mensagens.findIndex((x) => x.id === real.id);
      if (dup >= 0 && dup !== i) estado.mensagens.splice(i, 1); else if (i >= 0) estado.mensagens[i] = real;
    } else if (i >= 0) {
      Object.assign(estado.mensagens[i], { _pendente: false, _erro: erro || true });
    }
    renderMensagens();
  }

  async function enviarTexto(corpo, interna, tmpExistente, ctx = {}) {
    const c = { projeto_id: ctx.projeto_id || (tmpExistente && tmpExistente.projeto_id) || null, assunto: ctx.assunto || (tmpExistente && tmpExistente.assunto) || null };
    const tmp = tmpExistente || provisoria({ tipo: 'texto', corpo, interna, ...c });
    const { data, error } = await db.from('mensagens')
      .insert({ conversa_id: tmp.conversa_id, autor_id: perfil.id, tipo: 'texto', corpo, interna, ...c })
      .select(CAMPOS).single();
    if (error) { trocarProvisoria(tmp, null, error.message); toast('Não foi possível enviar: ' + error.message, 'erro'); return null; }
    trocarProvisoria(tmp, data);
    if (ADMIN) atualizarListaLogo();
    return data;
  }

  async function enviarArquivo(arquivo, { interna, tipo, duracaoSeg = null, nome = null, ctx = contexto() }) {
    const conversa = estado.atual.id;
    const nomeFinal = nome || arquivo.name || 'arquivo';
    const tmp = provisoria({ tipo, interna, anexo_nome: nomeFinal, anexo_tamanho: arquivo.size, anexo_mime: arquivo.type, duracao_seg: duracaoSeg, projeto_id: ctx.projeto_id, assunto: ctx.assunto });
    const seguro = nomeFinal.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').slice(-80) || 'arquivo';
    const caminho = `${conversa}/${interna ? 'interno' : 'publico'}/${crypto.randomUUID()}-${seguro}`;
    const up = await db.storage.from(BUCKET).upload(caminho, arquivo, { contentType: arquivo.type || 'application/octet-stream' });
    if (up.error) { trocarProvisoria(tmp, null, up.error.message); toast('Não foi possível enviar ' + nomeFinal + ': ' + up.error.message, 'erro'); return; }
    const { data, error } = await db.from('mensagens').insert({
      conversa_id: conversa, autor_id: perfil.id, tipo, interna, anexo_path: caminho, anexo_nome: nomeFinal,
      anexo_mime: arquivo.type || null, anexo_tamanho: arquivo.size, duracao_seg: duracaoSeg,
      projeto_id: ctx.projeto_id || null, assunto: ctx.assunto || null
    }).select(CAMPOS).single();
    if (error) {
      await db.storage.from(BUCKET).remove([caminho]);
      trocarProvisoria(tmp, null, error.message);
      toast('Não foi possível enviar: ' + error.message, 'erro');
      return;
    }
    await assinarUrls([data]);
    trocarProvisoria(tmp, data);
    if (ADMIN) atualizarListaLogo();
  }

  function iniciarEdicao(m) {
    estado.editando = m;
    $('faixa-edicao').hidden = false;
    $('chave-nota').classList.add('msg-desativado');
    texto.value = m.corpo || '';
    ajustarAltura();
    atualizarBotoes();
    texto.focus();
    texto.setSelectionRange(texto.value.length, texto.value.length);
    linhas.querySelector(`[data-id="${CSS.escape(m.id)}"]`)?.setAttribute('data-editando', '');
  }
  function cancelarEdicao() {
    if (!estado.editando) return;
    linhas.querySelector('[data-editando]')?.removeAttribute('data-editando');
    estado.editando = null;
    $('faixa-edicao').hidden = true;
    $('chave-nota').classList.remove('msg-desativado');
    texto.value = estado.atual ? lerRascunho(estado.atual.id) : '';
    ajustarAltura();
    atualizarBotoes();
  }
  $('btn-cancelar-edicao').addEventListener('click', cancelarEdicao);
  async function salvarEdicao() {
    const m = estado.editando;
    const corpo = texto.value.trim();
    if (!corpo) { toast('A mensagem não pode ficar vazia. Para tirar, use Apagar.', 'erro'); return; }
    if (corpo === m.corpo) { cancelarEdicao(); return; }
    const btn = $('btn-enviar');
    ocupado(btn, true);
    const { data, error } = await db.from('mensagens').update({ corpo }).eq('id', m.id).select(CAMPOS).single();
    ocupado(btn, false);
    if (error) { toast('Não foi possível editar: ' + error.message, 'erro'); return; }
    cancelarEdicao();
    receber(data);
    toast('Mensagem editada.');
  }

  async function apagar(m) {
    if (!confirm('Apagar esta mensagem para todos? Isso não pode ser desfeito.')) return;
    const caminho = m.anexo_path;
    const { data, error } = await db.from('mensagens').update({ apagada_em: new Date().toISOString() }).eq('id', m.id).select(CAMPOS).single();
    if (error) { toast('Não foi possível apagar: ' + error.message, 'erro'); return; }
    if (caminho) db.storage.from(BUCKET).remove([caminho]).then(() => urls.delete(caminho));
    receber(data);
    if (ADMIN) atualizarListaLogo();
  }

  // Menu de cada mensagem
  linhas.addEventListener('click', async (e) => {
    if (window.matchMedia('(hover: none)').matches && !e.target.closest('a, button, input, audio')) {
      const li = e.target.closest('.msg');
      linhas.querySelectorAll('.msg[data-ativa]').forEach((x) => { if (x !== li) x.removeAttribute('data-ativa'); });
      if (li) li.toggleAttribute('data-ativa');
    }
    const mais = e.target.closest('.msg-mais');
    if (mais) {
      const menu = mais.nextElementSibling;
      const abrir = menu.hidden;
      fecharMenus();
      menu.hidden = !abrir;
      mais.setAttribute('aria-expanded', String(abrir));
      if (abrir) menu.querySelector('button')?.focus();
      return;
    }
    const acao = e.target.closest('[data-acao]');
    if (!acao) return;
    const li = acao.closest('.msg');
    const m = estado.mensagens.find((x) => x.id === li.dataset.id);
    fecharMenus();
    if (!m) return;
    if (acao.dataset.acao === 'copiar') { copiar(m.corpo); }
    else if (acao.dataset.acao === 'editar') iniciarEdicao(m);
    else if (acao.dataset.acao === 'apagar') apagar(m);
    else if (acao.dataset.acao === 'whatsapp') window.open(urlWhats(foneWhats(estado.atual.telefone), m.corpo), '_blank', 'noopener');
    else if (acao.dataset.acao === 'reenviar' && m.tipo === 'texto') {
      Object.assign(m, { _erro: false, _pendente: true });
      renderMensagens();
      enviarTexto(m.corpo, m.interna, m);
    } else if (acao.dataset.acao === 'reenviar') {
      estado.mensagens = estado.mensagens.filter((x) => x !== m);
      renderMensagens();
      toast('Escolha o arquivo de novo para reenviar.', 'erro');
    }
  });
  function fecharMenus() {
    linhas.querySelectorAll('.msg-menu:not([hidden])').forEach((mn) => { mn.hidden = true; mn.previousElementSibling.setAttribute('aria-expanded', 'false'); });
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('.msg-acoes')) fecharMenus(); });
  linhas.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { const aberto = linhas.querySelector('.msg-menu:not([hidden])'); if (aberto) { fecharMenus(); aberto.previousElementSibling.focus(); } }
  });
  async function copiar(t) {
    try { await navigator.clipboard.writeText(t || ''); toast('Copiado.'); } catch (_) { toast('Não foi possível copiar.', 'erro'); }
  }

  // ---------------------------------------------------------------
  // Anexos: botão, arrastar e soltar, colar imagem
  // ---------------------------------------------------------------
  function adicionarAnexos(lista) {
    for (const f of lista) {
      if (f.size > LIMITE_ARQUIVO) { toast(`${f.name} passa de 25 MB.`, 'erro'); continue; }
      if (estado.anexos.length >= 10) { toast('Envie até 10 arquivos por vez.', 'erro'); break; }
      estado.anexos.push(f);
    }
    renderAnexos();
  }
  function limparAnexos() {
    estado.anexos.forEach((f) => f._previa && URL.revokeObjectURL(f._previa));
    estado.anexos = [];
    renderAnexos();
  }
  function renderAnexos() {
    const box = $('anexo-previa');
    box.hidden = !estado.anexos.length;
    box.innerHTML = estado.anexos.map((f, i) => {
      const img = /^image\//.test(f.type);
      if (img && !f._previa) f._previa = URL.createObjectURL(f);
      return `<span class="msg-anexo-chip">
        ${img ? `<img src="${esc(f._previa)}" alt="">` : `<span class="msg-arquivo-icone" aria-hidden="true">${icone('arquivo')}</span>`}
        <span><strong>${esc(f.name)}</strong><small>${tamanho(f.size)}</small></span>
        <button type="button" data-tirar="${i}" aria-label="Tirar ${esc(f.name)}">${icone('fechar')}</button></span>`;
    }).join('');
    atualizarBotoes();
  }
  $('anexo-previa').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tirar]');
    if (!b) return;
    const [f] = estado.anexos.splice(Number(b.dataset.tirar), 1);
    if (f && f._previa) URL.revokeObjectURL(f._previa);
    renderAnexos();
  });
  $('msg-arquivo').addEventListener('change', (e) => { adicionarAnexos([...e.target.files]); e.target.value = ''; texto.focus(); });
  const thread = $('msg-thread');
  thread.addEventListener('dragover', (e) => { if (estado.atual && [...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); thread.dataset.soltar = ''; } });
  thread.addEventListener('dragleave', (e) => { if (!thread.contains(e.relatedTarget)) delete thread.dataset.soltar; });
  thread.addEventListener('drop', (e) => {
    delete thread.dataset.soltar;
    if (!estado.atual || !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    adicionarAnexos([...e.dataTransfer.files]);
  });
  texto.addEventListener('paste', (e) => {
    const arquivos = [...(e.clipboardData?.files || [])];
    if (arquivos.length) { e.preventDefault(); adicionarAnexos(arquivos.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `imagem-colada-${Date.now()}-${i}.png`, { type: f.type })))); }
  });

  // ---------------------------------------------------------------
  // Áudio
  // ---------------------------------------------------------------
  const gravacao = { rec: null, pedacos: [], inicio: 0, timer: null, stream: null, contexto: null, descartar: false };
  if (!PODE_GRAVAR) $('btn-gravar').hidden = true;
  $('btn-gravar').addEventListener('click', async () => {
    if (!estado.atual) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      toast(e.name === 'NotAllowedError' ? 'Permita o uso do microfone no navegador para gravar.' : 'Não foi possível acessar o microfone.', 'erro');
      return;
    }
    const tipo = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo, audioBitsPerSecond: 64000 } : undefined);
    Object.assign(gravacao, { rec, pedacos: [], inicio: Date.now(), stream, descartar: false });
    rec.addEventListener('dataavailable', (ev) => { if (ev.data && ev.data.size) gravacao.pedacos.push(ev.data); });
    rec.addEventListener('stop', finalizarGravacao);
    rec.start(250);
    $('linha-texto').hidden = true;
    $('linha-gravando').hidden = false;
    $('msg-atalhos').hidden = true;
    form.dataset.gravando = '';
    medirVolume(stream);
    gravacao.timer = setInterval(() => {
      const s = (Date.now() - gravacao.inicio) / 1000;
      $('rec-tempo').textContent = duracao(s);
      if (s >= AUDIO_MAX_SEG) { toast('Limite de 5 minutos por áudio.'); pararGravacao(false); }
    }, 250);
    $('btn-enviar-audio').focus();
  });
  function medirVolume(stream) {
    const onda = $('rec-onda');
    onda.innerHTML = '<span></span>'.repeat(28);
    const barras = [...onda.children];
    const niveis = barras.map(() => 0.12);
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const an = ctx.createAnalyser();
      an.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(an);
      gravacao.contexto = ctx;
      const dados = new Uint8Array(an.frequencyBinCount);
      const passo = () => {
        if (!gravacao.rec || gravacao.rec.state !== 'recording') return;
        an.getByteFrequencyData(dados);
        const media = dados.reduce((t, v) => t + v, 0) / dados.length / 255;
        niveis.push(Math.max(0.12, Math.min(1, media * 2.4)));
        niveis.shift();
        barras.forEach((b, i) => b.style.setProperty('--v', niveis[i].toFixed(2)));
        setTimeout(() => requestAnimationFrame(passo), 70);
      };
      passo();
    } catch (_) {}
  }
  function pararGravacao(descartar) {
    if (!gravacao.rec || gravacao.rec.state === 'inactive') return;
    gravacao.descartar = descartar;
    gravacao.rec.stop();
  }
  async function finalizarGravacao() {
    clearInterval(gravacao.timer);
    gravacao.stream.getTracks().forEach((t) => t.stop());
    if (gravacao.contexto) gravacao.contexto.close().catch(() => {});
    $('linha-gravando').hidden = true;
    $('linha-texto').hidden = false;
    delete form.dataset.gravando;
    $('rec-tempo').textContent = '0:00';
    const seg = Math.round((Date.now() - gravacao.inicio) / 1000);
    const mime = (gravacao.rec.mimeType || 'audio/webm').split(';')[0];
    const blob = new Blob(gravacao.pedacos, { type: mime });
    gravacao.rec = null;
    texto.focus({ preventScroll: true });
    if (gravacao.descartar) return;
    if (seg < 1 || blob.size < 1000) { toast('Áudio muito curto.', 'erro'); return; }
    const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
    const nome = 'audio-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.' + ext;
    const ctx = contexto();
    $('msg-assunto').value = '';
    marcarSelecionados();
    await enviarArquivo(new File([blob], nome, { type: mime }), { interna: $('msg-interna').checked, tipo: 'audio', duracaoSeg: seg, nome, ctx });
    atualizarAtalhos();
  }
  $('btn-enviar-audio').addEventListener('click', () => pararGravacao(false));
  $('btn-descartar-audio').addEventListener('click', () => pararGravacao(true));
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape' && gravacao.rec) { e.preventDefault(); pararGravacao(true); } });

  // ---------------------------------------------------------------
  // IA (admin): sugerir resposta e melhorar o rascunho
  // ---------------------------------------------------------------
  const painelIa = $('ia-painel');
  function fecharIa() { painelIa.hidden = true; $('btn-ia').setAttribute('aria-expanded', 'false'); }
  $('btn-ia').addEventListener('click', () => {
    const abrir = painelIa.hidden;
    painelIa.hidden = !abrir;
    $('btn-ia').setAttribute('aria-expanded', String(abrir));
    if (abrir) {
      $('ia-melhorar').disabled = !texto.value.trim();
      if (!$('ia-lista').children.length) $('ia-lista').innerHTML = `<li class="msg-ia-dica">${estado.mensagens.length ? 'Peça uma sugestão de resposta com base na conversa ou escreva um rascunho e peça para melhorar.' : 'Escreva um rascunho e peça para a IA melhorar, ou use <strong>Modelos e WhatsApp → Construir mensagem</strong>.'}</li>`;
      $('ia-sugerir').focus();
    }
  });
  $('ia-fechar').addEventListener('click', () => { fecharIa(); texto.focus(); });
  painelIa.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fecharIa(); $('btn-ia').focus(); } });
  texto.addEventListener('input', () => { if (!painelIa.hidden) $('ia-melhorar').disabled = !texto.value.trim(); });

  async function pedirIa(corpo, lista, botao) {
    ocupado(botao, true, 'Gerando...');
    lista.innerHTML = '<li class="msg-ia-carregando" data-esqueleto-linha></li><li class="msg-ia-carregando" data-esqueleto-linha></li><li class="msg-ia-carregando" data-esqueleto-linha></li>';
    try {
      const r = await api('mensagens-ia', corpo);
      lista.innerHTML = r.sugestoes.map((s, i) => `
        <li class="msg-ia-item">
          <strong>${esc(s.titulo)}</strong>
          <p>${formatar(s.texto, { marcarLacunas: true })}</p>
          <span class="pagina-acoes"><button type="button" data-usar="${i}">Usar</button><button type="button" data-copiar="${i}">${icone('copiar')} Copiar</button></span>
        </li>`).join('');
      lista._sugestoes = r.sugestoes;
      if (r.sugestoes.some((s) => /\[[^\]]+\]/.test(s.texto))) lista.insertAdjacentHTML('beforeend', '<li class="msg-ia-dica">Os trechos <mark>[entre colchetes]</mark> precisam ser completados antes de enviar.</li>');
    } catch (e) {
      lista.innerHTML = `<li class="msg-ia-erro" role="alert">${esc(e.message)}</li>`;
    } finally {
      ocupado(botao, false);
    }
  }
  $('ia-sugerir').addEventListener('click', (e) => pedirIa({ acao: 'sugerir', conversa_id: estado.atual.id, tom: $('ia-tom').value, texto: texto.value.trim() || undefined }, $('ia-lista'), e.currentTarget));
  $('ia-melhorar').addEventListener('click', (e) => pedirIa({ acao: 'reescrever', texto: texto.value.trim(), tom: $('ia-tom').value }, $('ia-lista'), e.currentTarget));
  $('ia-lista').addEventListener('click', (e) => {
    const lista = $('ia-lista');
    const usar = e.target.closest('[data-usar]');
    const cop = e.target.closest('[data-copiar]');
    if (usar) {
      texto.value = lista._sugestoes[Number(usar.dataset.usar)].texto;
      ajustarAltura(); atualizarBotoes();
      if (estado.atual) salvarRascunho(estado.atual.id, texto.value);
      fecharIa();
      texto.focus();
      const lac = texto.value.search(/\[[^\]]+\]/);
      if (lac >= 0) texto.setSelectionRange(lac, texto.value.indexOf(']', lac) + 1);
    }
    if (cop) copiar(lista._sugestoes[Number(cop.dataset.copiar)].texto);
  });

  // ---------------------------------------------------------------
  // Detalhes do cliente (admin)
  // ---------------------------------------------------------------
  const detalhes = $('msg-detalhes');
  function fecharDetalhes() { detalhes.hidden = true; $('btn-detalhes').setAttribute('aria-pressed', 'false'); app.removeAttribute('data-detalhes'); }
  $('btn-detalhes').addEventListener('click', () => {
    if (!detalhes.hidden) { fecharDetalhes(); return; }
    detalhes.hidden = false;
    app.dataset.detalhes = '';
    $('btn-detalhes').setAttribute('aria-pressed', 'true');
    montarDetalhes();
  });
  $('detalhes-fechar').addEventListener('click', fecharDetalhes);
  async function montarDetalhes() {
    const c = estado.atual;
    const corpo = $('detalhes-corpo');
    corpo.innerHTML = '<p data-esqueleto-linha></p><p data-esqueleto-linha></p>';
    const [pf, pj] = await Promise.all([
      db.from('profiles').select('nome, email, telefone, created_at').eq('id', c.cliente_id).maybeSingle(),
      db.from('projetos').select('id, codigo, nome, status_projeto, progresso, etapa_atual, projeto_etapas(status)').eq('cliente_id', c.cliente_id).order('created_at', { ascending: false })
    ]);
    if (estado.atual !== c) return;
    const p = pf.data || {};
    const fone = foneWhats(p.telefone);
    corpo.innerHTML = `
      <div class="msg-detalhes-pessoa"><span class="avatar avatar-grande" aria-hidden="true">${esc(iniciais(p.nome || p.email))}</span>
        <strong>${esc(p.nome || '-')}</strong><small>Cliente desde ${fmtData(p.created_at)}</small></div>
      <dl class="msg-detalhes-dados">
        <div><dt>E-mail</dt><dd>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '-'}</dd></div>
        <div><dt>WhatsApp</dt><dd>${p.telefone ? esc(formatarTelefone(p.telefone)) : 'não informado'}</dd></div>
      </dl>
      ${fone ? `<a class="widget-whatsapp" href="https://wa.me/${fone}" target="_blank" rel="noopener noreferrer">${icone('whatsapp')}<span>Abrir conversa no WhatsApp<small>Envio manual pelo seu aparelho</small></span></a>` : ''}
      <h3>Projetos</h3>
      ${(pj.data || []).length ? `<ul class="lista-widget">${pj.data.map((x) => `<li><a class="widget-item" href="projeto.html?id=${esc(x.id)}">
          ${anelHtml(progressoProjeto(x), x.nome)}<span><strong>${esc(x.nome)}</strong><small>${esc(x.codigo || '')} · ${esc(rotulo('projeto', x.status_projeto))}</small></span></a></li>`).join('')}</ul>`
        : '<p class="widget-vazio">Nenhum projeto ainda.</p>'}
      <p><a class="botao-link" href="admin-clientes.html?busca=${encodeURIComponent(p.email || p.nome || '')}">${icone('clientes')} Ver em Clientes</a></p>`;
    animarNumeros(corpo);
  }

  // ---------------------------------------------------------------
  // Pessoas (admin): nova conversa e destino do WhatsApp
  // ---------------------------------------------------------------
  async function carregarPessoas() {
    if (estado.pessoas) return estado.pessoas;
    const { data, error } = await db.from('profiles').select('id, nome, email, telefone, role').order('nome');
    if (error) { toast('Não foi possível carregar os contatos: ' + error.message, 'erro'); return []; }
    estado.pessoas = data || [];
    return estado.pessoas;
  }
  const dlgNova = $('dlg-nova');
  ligarDialogo(dlgNova);
  $('btn-nova-conversa').addEventListener('click', async () => {
    dlgNova.showModal();
    $('nova-busca').value = '';
    $('nova-lista').innerHTML = '<li data-esqueleto-linha></li><li data-esqueleto-linha></li>';
    await carregarPessoas();
    renderPessoas();
    $('nova-busca').focus();
  });
  $('nova-busca').addEventListener('input', renderPessoas);
  function renderPessoas() {
    const n = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const q = n($('nova-busca').value);
    const casa = (p) => !q || n(p.nome + ' ' + p.email).includes(q);
    const admins = (estado.pessoas || []).filter((p) => p.role === 'admin' && p.id !== perfil.id && casa(p));
    const clientes = (estado.pessoas || []).filter((p) => p.role !== 'admin' && casa(p));
    const item = (p, tipo) => `<li><button type="button" class="msg-pessoa" data-pessoa="${esc(p.id)}" data-tipo="${tipo}">
      <span class="avatar" aria-hidden="true"${tipo === 'equipe' ? ' data-equipe' : ''}>${esc(iniciais(p.nome || p.email))}</span>
      <span><strong>${esc(p.nome || p.email)}</strong><small>${esc(p.email || '')}</small></span></button></li>`;
    $('nova-lista').innerHTML = `
      ${!q || n('grupo equipe').includes(q) ? `<li class="msg-pessoas-grupo">Equipe</li><li><button type="button" class="msg-pessoa" data-pessoa="" data-tipo="grupo">
        <span class="avatar msg-avatar-equipe" aria-hidden="true">${icone('equipe')}</span><span><strong>Grupo da equipe</strong><small>Todos os administradores</small></span></button></li>` : ''}
      ${admins.length ? (q ? '<li class="msg-pessoas-grupo">Administradores</li>' : '') + admins.map((p) => item(p, 'equipe')).join('') : ''}
      <li class="msg-pessoas-grupo">Clientes</li>
      ${clientes.length ? clientes.map((p) => item(p, 'cliente')).join('') : '<li class="msg-lista-vazia">Nenhum cliente encontrado.</li>'}`;
  }
  $('nova-lista').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pessoa]');
    if (!b) return;
    ocupado(b, true);
    const r = b.dataset.tipo === 'cliente'
      ? await db.rpc('abrir_conversa_cliente', { p_cliente: b.dataset.pessoa })
      : await db.rpc('abrir_conversa_equipe', { p_membro: b.dataset.pessoa || null });
    ocupado(b, false);
    if (r.error) { toast('Não foi possível abrir: ' + r.error.message, 'erro'); return; }
    dlgNova.close();
    await carregarConversas();
    abrirConversa(r.data);
  });

  function ligarDialogo(dlg) {
    dlg.querySelector('[data-fechar]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }

  // ---------------------------------------------------------------
  // Modelos + construtor + WhatsApp manual (admin)
  // ---------------------------------------------------------------
  const dlgModelos = $('dlg-modelos');
  const CATEGORIAS = { geral: 'Geral', relacionamento: 'Relacionamento', projeto: 'Projeto', financeiro: 'Financeiro', comercial: 'Comercial' };
  const corpoModelo = $('modelo-corpo');
  const destino = $('modelo-destino');
  const projetosDestino = new Map();
  let construtorAlterado = false;
  ligarDialogo(dlgModelos);
  dlgModelos.addEventListener('cancel', (e) => { if (construtorAlterado && !confirm('Descartar a mensagem que você está montando?')) e.preventDefault(); });

  $('btn-abrir-modelos').addEventListener('click', () => abrirModelos('lista'));
  $('btn-modelos-conversa').addEventListener('click', () => abrirModelos('lista'));
  async function abrirModelos(aba) {
    dlgModelos.showModal();
    trocarAba(aba);
    await Promise.all([carregarModelos(), preencherDestinos()]);
  }
  function trocarAba(aba) {
    const lista = aba === 'lista';
    $('aba-lista').setAttribute('aria-selected', String(lista));
    $('aba-construtor').setAttribute('aria-selected', String(!lista));
    $('aba-lista').tabIndex = lista ? 0 : -1;
    $('aba-construtor').tabIndex = lista ? -1 : 0;
    $('painel-lista').hidden = !lista;
    $('painel-construtor').hidden = lista;
    if (!lista) atualizarPrevia();
  }
  $('aba-lista').addEventListener('click', () => trocarAba('lista'));
  $('aba-construtor').addEventListener('click', () => trocarAba('construtor'));
  dlgModelos.querySelector('[role=tablist]').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const proxima = $('aba-lista').getAttribute('aria-selected') === 'true' ? 'construtor' : 'lista';
    trocarAba(proxima);
    $(proxima === 'lista' ? 'aba-lista' : 'aba-construtor').focus();
  });

  async function carregarModelos() {
    const { data, error } = await db.from('modelos_mensagem').select('*').order('usos', { ascending: false }).order('titulo');
    $('modelos-lista').removeAttribute('aria-busy');
    if (error) { $('modelos-lista').innerHTML = `<li class="msg-lista-vazia">Não foi possível carregar: ${esc(error.message)}</li>`; return; }
    estado.modelos = data || [];
    const usadas = [...new Set(estado.modelos.map((m) => m.categoria))];
    $('modelos-categorias').innerHTML = ['todas', ...usadas].map((c) => `<button type="button" data-categoria="${esc(c)}" aria-pressed="${estado.categoria === c}">${esc(c === 'todas' ? 'Todas' : CATEGORIAS[c] || c)}</button>`).join('');
    renderModelos();
  }
  function renderModelos() {
    const n = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const q = n($('modelos-busca').value);
    const lista = estado.modelos.filter((m) => (estado.categoria === 'todas' || m.categoria === estado.categoria) && (!q || n(m.titulo + ' ' + m.corpo).includes(q)));
    $('modelos-lista').innerHTML = lista.length ? lista.map((m) => `
      <li class="msg-modelo" data-modelo="${esc(m.id)}">
        <header><strong>${esc(m.titulo)}</strong><span data-etiqueta="neutro">${esc(CATEGORIAS[m.categoria] || m.categoria)}</span></header>
        <p>${formatar(m.corpo, { marcarLacunas: true })}</p>
        <footer class="pagina-acoes">
          ${estado.atual ? `<button type="button" data-m="usar">${icone('mensagens')} Usar na conversa</button>` : ''}
          <button type="button" data-m="whatsapp" class="msg-btn-whats">${icone('whatsapp')} WhatsApp</button>
          <button type="button" data-m="editar" class="acao-icone" aria-label="Editar ${esc(m.titulo)}" title="Editar">${icone('editar')}</button>
          <button type="button" data-m="excluir" class="acao-icone" aria-label="Excluir ${esc(m.titulo)}" title="Excluir">${icone('remover')}</button>
        </footer></li>`).join('')
      : `<li class="msg-lista-vazia">${estado.modelos.length ? 'Nenhum modelo encontrado.' : 'Nenhum modelo salvo ainda.'} <button type="button" data-m="novo">Construir mensagem</button></li>`;
  }
  $('modelos-busca').addEventListener('input', renderModelos);
  $('modelos-categorias').addEventListener('click', (e) => {
    const b = e.target.closest('[data-categoria]');
    if (!b) return;
    estado.categoria = b.dataset.categoria;
    $('modelos-categorias').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderModelos();
  });
  $('modelos-lista').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    if (b.dataset.m === 'novo') { limparConstrutor(); trocarAba('construtor'); return; }
    const m = estado.modelos.find((x) => x.id === b.closest('[data-modelo]').dataset.modelo);
    if (!m) return;
    if (b.dataset.m === 'usar') {
      const c = estado.atual;
      const vars = await variaveisPara(c && c.tipo === 'cliente' ? c.cliente_id : null);
      texto.value = preencher(m.corpo, vars);
      ajustarAltura(); atualizarBotoes();
      db.rpc('usar_modelo_mensagem', { p_modelo: m.id });
      dlgModelos.close();
      texto.focus();
    } else if (b.dataset.m === 'editar' || b.dataset.m === 'whatsapp') {
      carregarNoConstrutor(m);
      trocarAba('construtor');
      if (b.dataset.m === 'whatsapp') destino.focus(); else $('modelo-titulo').focus();
    } else if (b.dataset.m === 'excluir') {
      if (!confirm(`Excluir o modelo “${m.titulo}”?`)) return;
      const { error } = await db.from('modelos_mensagem').delete().eq('id', m.id);
      if (error) { toast('Não foi possível excluir: ' + error.message, 'erro'); return; }
      toast('Modelo excluído.');
      carregarModelos();
    }
  });

  function carregarNoConstrutor(m) {
    $('modelo-id').value = m.id;
    $('modelo-titulo').value = m.titulo;
    $('modelo-categoria').value = CATEGORIAS[m.categoria] ? m.categoria : 'geral';
    corpoModelo.value = m.corpo;
    construtorAlterado = false;
    atualizarPrevia();
  }
  function limparConstrutor() {
    $('form-modelo').reset();
    $('modelo-id').value = '';
    $('modelo-registrar').checked = true;
    $('ia-construtor-lista').innerHTML = '';
    if (estado.atual && estado.atual.tipo === 'cliente') destino.value = estado.atual.cliente_id;
    construtorAlterado = false;
    atualizarPrevia();
  }
  $('btn-novo-modelo').addEventListener('click', () => { if (!construtorAlterado || confirm('Limpar a mensagem?')) limparConstrutor(); });

  async function preencherDestinos() {
    const pessoas = await carregarPessoas();
    const atual = destino.value || (estado.atual && estado.atual.tipo === 'cliente' ? estado.atual.cliente_id : '');
    destino.innerHTML = '<option value="">Escolha o cliente (opcional)</option>' + pessoas.filter((p) => p.role !== 'admin')
      .map((p) => `<option value="${esc(p.id)}">${esc(p.nome || p.email)}${foneWhats(p.telefone) ? '' : ' (sem WhatsApp)'}</option>`).join('');
    destino.value = atual;
    atualizarPrevia();
  }
  async function variaveisPara(clienteId) {
    const p = (estado.pessoas || []).find((x) => x.id === clienteId) || (clienteId && estado.atual && estado.atual.cliente_id === clienteId ? { nome: estado.atual.nome } : null);
    if (clienteId && !projetosDestino.has(clienteId)) {
      const { data } = await db.from('projetos').select('nome').eq('cliente_id', clienteId).order('created_at', { ascending: false }).limit(1);
      projetosDestino.set(clienteId, (data && data[0] && data[0].nome) || null);
    }
    return {
      nome: p ? p.nome : null, primeiro_nome: p ? primeiroNome(p.nome) : null,
      projeto: clienteId ? projetosDestino.get(clienteId) : null, link: location.origin
    };
  }
  function preencher(t, vars) {
    return String(t || '').replace(/\{(primeiro_nome|nome|projeto|link)\}/g, (m, k) => vars[k] || m);
  }
  let timerPrevia = null;
  async function atualizarPrevia() {
    const n = corpoModelo.value.length;
    $('modelo-contador').textContent = n + ' / 5000';
    clearTimeout(timerPrevia);
    timerPrevia = setTimeout(async () => {
      const vars = await variaveisPara(destino.value || null);
      const t = preencher(corpoModelo.value, vars);
      $('modelo-previa').innerHTML = t.trim() ? formatar(t, { marcarLacunas: true }) + `<span class="msg-whats-hora">${hora(new Date())}</span>` : '<span class="nota">A prévia aparece aqui.</span>';
      const p = (estado.pessoas || []).find((x) => x.id === destino.value);
      const w = $('btn-whats-modelo');
      w.title = p && !foneWhats(p.telefone) ? 'O cliente não tem WhatsApp cadastrado: você escolhe o contato no WhatsApp.' : '';
      $('modelo-registrar').closest('label').hidden = !destino.value;
    }, 120);
  }
  corpoModelo.addEventListener('input', () => { construtorAlterado = true; atualizarPrevia(); });
  destino.addEventListener('change', atualizarPrevia);
  ['modelo-titulo', 'modelo-categoria'].forEach((id) => $(id).addEventListener('input', () => { construtorAlterado = true; }));

  $('modelo-variaveis').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const ini = corpoModelo.selectionStart;
    const fim = corpoModelo.selectionEnd;
    const v = corpoModelo.value;
    let novo;
    let cursor;
    if (b.dataset.variavel) {
      novo = v.slice(0, ini) + b.dataset.variavel + v.slice(fim);
      cursor = ini + b.dataset.variavel.length;
    } else {
      const s = b.dataset.formato;
      const sel = v.slice(ini, fim) || 'texto';
      novo = v.slice(0, ini) + s + sel + s + v.slice(fim);
      cursor = ini + sel.length + 2;
    }
    corpoModelo.value = novo.slice(0, 5000);
    corpoModelo.focus();
    corpoModelo.setSelectionRange(cursor, cursor);
    construtorAlterado = true;
    atualizarPrevia();
  });

  $('btn-ia-construir').addEventListener('click', (e) => {
    const objetivo = $('ia-objetivo').value.trim();
    if (!objetivo) { toast('Diga o objetivo da mensagem.', 'erro'); $('ia-objetivo').focus(); return; }
    const p = (estado.pessoas || []).find((x) => x.id === destino.value);
    pedirIa({ acao: 'construir', objetivo, detalhes: $('ia-detalhes').value.trim(), tom: $('ia-tom-construtor').value, canal: 'whatsapp', destinatario: p ? p.nome : undefined },
      $('ia-construtor-lista'), e.currentTarget);
  });
  $('ia-construtor-lista').addEventListener('click', (e) => {
    const lista = $('ia-construtor-lista');
    const usar = e.target.closest('[data-usar]');
    const cop = e.target.closest('[data-copiar]');
    if (usar) {
      const s = lista._sugestoes[Number(usar.dataset.usar)];
      corpoModelo.value = s.texto;
      if (!$('modelo-titulo').value.trim()) $('modelo-titulo').value = $('ia-objetivo').value.trim().slice(0, 120);
      construtorAlterado = true;
      atualizarPrevia();
      corpoModelo.focus();
      corpoModelo.scrollIntoView({ block: 'center', behavior: MOVIMENTO_REDUZIDO ? 'auto' : 'smooth' });
    }
    if (cop) copiar(lista._sugestoes[Number(cop.dataset.copiar)].texto);
  });

  async function textoFinal() {
    const vars = await variaveisPara(destino.value || null);
    return preencher(corpoModelo.value.trim(), vars);
  }
  $('btn-copiar-modelo').addEventListener('click', async () => {
    if (!corpoModelo.value.trim()) { toast('Escreva a mensagem primeiro.', 'erro'); return; }
    copiar(await textoFinal());
  });
  $('btn-usar-modelo').addEventListener('click', async () => {
    if (!corpoModelo.value.trim()) { toast('Escreva a mensagem primeiro.', 'erro'); return; }
    let id = estado.atual && estado.atual.id;
    if (destino.value && (!estado.atual || estado.atual.cliente_id !== destino.value)) {
      const r = await db.rpc('abrir_conversa_cliente', { p_cliente: destino.value });
      if (r.error) { toast(r.error.message, 'erro'); return; }
      id = r.data;
    }
    if (!id) { toast('Escolha o cliente ou abra uma conversa.', 'erro'); return; }
    const t = await textoFinal();
    if ($('modelo-id').value) db.rpc('usar_modelo_mensagem', { p_modelo: $('modelo-id').value });
    construtorAlterado = false;
    dlgModelos.close();
    if (!estado.atual || estado.atual.id !== id) await abrirConversa(id);
    texto.value = t;
    ajustarAltura(); atualizarBotoes();
    texto.focus();
  });
  $('btn-whats-modelo').addEventListener('click', async () => {
    if (!corpoModelo.value.trim()) { toast('Escreva a mensagem primeiro.', 'erro'); return; }
    const janela = window.open('', '_blank'); // abre já no clique (o navegador não bloqueia)
    const p = (estado.pessoas || []).find((x) => x.id === destino.value);
    const t = await textoFinal();
    const url = urlWhats(p ? foneWhats(p.telefone) : '', t);
    if (janela) { janela.opener = null; janela.location.href = url; } else window.open(url, '_blank', 'noopener');
    if ($('modelo-id').value) db.rpc('usar_modelo_mensagem', { p_modelo: $('modelo-id').value });
    if (p && $('modelo-registrar').checked) {
      const r = await db.rpc('abrir_conversa_cliente', { p_cliente: p.id });
      if (!r.error) {
        const { error } = await db.from('mensagens').insert({ conversa_id: r.data, autor_id: perfil.id, tipo: 'texto', interna: true, corpo: 'Enviado pelo WhatsApp:\n\n' + t });
        if (!error) {
          toast('Envio registrado na conversa como nota interna.');
          if (estado.atual && estado.atual.id === r.data) sincronizar(); else carregarConversas();
        }
      }
    }
  });
  $('form-modelo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titulo = $('modelo-titulo').value.trim();
    const corpo = corpoModelo.value.trim();
    if (!titulo) { toast('Dê um nome ao modelo.', 'erro'); $('modelo-titulo').focus(); return; }
    if (!corpo) { toast('Escreva a mensagem.', 'erro'); corpoModelo.focus(); return; }
    const btn = $('btn-salvar-modelo');
    ocupado(btn, true, 'Salvando...');
    const dados = { titulo, corpo, categoria: $('modelo-categoria').value };
    const id = $('modelo-id').value;
    const r = id
      ? await db.from('modelos_mensagem').update(dados).eq('id', id).select('id').single()
      : await db.from('modelos_mensagem').insert({ ...dados, autor_id: perfil.id }).select('id').single();
    ocupado(btn, false);
    if (r.error) { toast('Não foi possível salvar: ' + r.error.message, 'erro'); return; }
    $('modelo-id').value = r.data.id;
    construtorAlterado = false;
    toast(id ? 'Modelo atualizado.' : 'Modelo salvo.');
    carregarModelos();
  });

  // ---------------------------------------------------------------
  // Início
  // ---------------------------------------------------------------
  atualizarBotoes();
  const params = new URLSearchParams(location.search);
  if (!ADMIN) {
    const { data, error } = await db.rpc('abrir_conversa_cliente');
    if (error) {
      mostrarErro(/abrir_conversa_cliente|function|schema cache/i.test(error.message || '') ? 'As mensagens ainda não estão disponíveis. Tente mais tarde.' : 'Não foi possível abrir a conversa: ' + error.message);
      return;
    }
    if (await carregarConversas()) abrirConversa(data);
    return;
  }
  if (!(await carregarConversas())) return;
  if (params.get('cliente')) {
    const r = await db.rpc('abrir_conversa_cliente', { p_cliente: params.get('cliente') });
    if (r.error) toast('Não foi possível abrir a conversa: ' + r.error.message, 'erro');
    else { await carregarConversas(); abrirConversa(r.data); }
  } else if (params.get('c')) {
    abrirConversa(params.get('c'), { foco: false });
  } else if (!umaColuna() && estado.conversas.length) {
    abrirConversa(estado.conversas[0].id, { foco: false });
  }
})();
