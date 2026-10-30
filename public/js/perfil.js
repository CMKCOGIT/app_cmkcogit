// =====================================================================
// perfil.js — o cliente altera nome, WhatsApp e CPF/CNPJ (tabela profiles), e-mail
// e senha de acesso (Supabase Auth) e encerra as sessões abertas.
// =====================================================================
(async function () {
  let perfil = await protegerPagina();
  if (!perfil) return;
  const sessao = await getSessao();

  const nome = document.getElementById('perfil-nome');
  const telefone = document.getElementById('perfil-telefone');
  nome.value = perfil.nome || '';
  telefone.value = formatarTelefone(perfil.telefone);
  telefone.addEventListener('input', () => { telefone.value = formatarTelefone(telefone.value); });
  // CPF/CNPJ: lido à parte (não vai para o cache do perfil) e mostrado mascarado
  const documento = document.getElementById('perfil-documento');
  let docMascarado = '';
  db.from('profiles').select('documento').eq('id', perfil.id).maybeSingle().then(({ data }) => {
    docMascarado = mascararDocumento(data && data.documento);
    documento.value = docMascarado;
  });
  documento.addEventListener('focus', () => { if (documento.value === docMascarado) documento.select(); });
  documento.addEventListener('input', () => { documento.value = formatarDocumento(documento.value); });
  if (new URLSearchParams(window.location.search).get('falta') === 'documento') {
    avisar('Para pagar, informe seu CPF ou o CNPJ da empresa e clique em "Salvar dados".');
    documento.focus();
  }
  document.getElementById('cliente-desde').textContent = fmtData(perfil.created_at || sessao.user.created_at);
  mostrarEmail(sessao.user);
  preencherCartao();
  document.getElementById('falar-conosco').href = linkWhatsApp(`Olá! Sou ${perfil.nome || 'cliente'} (${perfil.email || ''}) e preciso de ajuda com minha conta na plataforma COGIT.`);
  if (ehAdmin(perfil)) document.getElementById('perfil-rotulo').textContent = 'Painel de gestão';
  ligarAbas();
  carregarNotificacoes();

  function preencherCartao() {
    document.getElementById('perfil-avatar').textContent = iniciais(perfil.nome || perfil.email);
    document.getElementById('perfil-nome-cartao').textContent = perfil.nome || 'Sem nome';
    document.getElementById('perfil-email-cartao').textContent = perfil.email || '';
    document.getElementById('perfil-papel').textContent = ehAdmin(perfil) ? 'Admin' : 'Cliente';
  }

  // Abas acessíveis: setas, Home/End; a aba aberta fica no endereço (#seguranca)
  function ligarAbas() {
    const abas = [...document.querySelectorAll('[role=tab]')];
    const abrir = (aba, focar) => {
      abas.forEach((a) => {
        const sel = a === aba;
        a.setAttribute('aria-selected', String(sel));
        a.tabIndex = sel ? 0 : -1;
        document.getElementById(a.getAttribute('aria-controls')).hidden = !sel;
      });
      if (focar) aba.focus();
      history.replaceState(null, '', '#' + aba.id.replace('aba-', ''));
      limpar();
    };
    abas.forEach((a, i) => {
      a.addEventListener('click', () => abrir(a, false));
      a.addEventListener('keydown', (e) => {
        const n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: abas.length - 1 }[e.key];
        if (n === undefined) return;
        e.preventDefault();
        abrir(abas[(n + abas.length) % abas.length], true);
      });
    });
    const inicial = abas.find((a) => '#' + a.id.replace('aba-', '') === window.location.hash);
    if (inicial) abrir(inicial, false);
  }

  async function carregarNotificacoes() {
    const ul = document.getElementById('perfil-notificacoes');
    const botao = document.getElementById('perfil-marcar-lidas');
    try {
      const r = await api('notificacoes?limite=20', null, 'GET');
      const lista = r.notificacoes || [];
      ul.innerHTML = lista.length ? linhaDoTempoHtml(lista) : '<li><p class="widget-vazio">Nenhuma notificação por enquanto.</p></li>';
      botao.hidden = !Number(r.nao_lidas);
    } catch (e) {
      ul.innerHTML = '<li><p class="widget-vazio">Não foi possível carregar as notificações agora.</p></li>';
    }
  }
  document.getElementById('perfil-marcar-lidas').addEventListener('click', async (e) => {
    ocupado(e.currentTarget, true, 'Marcando...');
    await Sino.marcar(null);
    ocupado(e.currentTarget, false);
    toast('Notificações marcadas como lidas.');
    carregarNotificacoes();
  });

  function mostrarEmail(usuario) {
    document.getElementById('email-atual').textContent = usuario.email +
      (usuario.new_email ? ' (aguardando confirmação de ' + usuario.new_email + ')' : '');
  }
  function limpar() { avisar(''); mostrarErro(''); }

  // nome e WhatsApp
  document.getElementById('form-dados').addEventListener('submit', async (e) => {
    e.preventDefault();
    limpar();
    const novoNome = nome.value.trim();
    const fone = telefone.value.replace(/\D/g, '');
    if (novoNome.length < 2) return mostrarErro('Informe seu nome.');
    if (fone && (fone.length < 10 || fone.length > 11)) return mostrarErro('Informe o WhatsApp com DDD.');
    const novoDoc = documento.value === docMascarado ? '' : documento.value.replace(/\D/g, '');
    if (novoDoc && !documentoValido(novoDoc)) return mostrarErro('CPF ou CNPJ inválido. Confira os números.');
    if (!novoDoc && documento.value !== docMascarado) return mostrarErro('Informe o CPF ou CNPJ completo.');
    const botao = e.target.querySelector('button');
    botao.disabled = true;
    const { error } = await db.from('profiles').update({ nome: novoNome, telefone: fone || null }).eq('id', perfil.id);
    if (error) { botao.disabled = false; return mostrarErro('Não foi possível salvar: ' + error.message); }
    if (novoDoc) {
      const r = await db.rpc('salvar_documento', { p_documento: novoDoc });
      if (r.error) { botao.disabled = false; return mostrarErro('Não foi possível salvar o CPF/CNPJ: ' + r.error.message); }
      docMascarado = mascararDocumento(novoDoc);
      documento.value = docMascarado;
    }
    botao.disabled = false;
    perfil = { ...perfil, nome: novoNome, telefone: fone || null };
    salvarPerfilCache(perfil);
    montarMenu(perfil);
    preencherCartao();
    toast('Dados salvos.');
  });

  // e-mail: o Supabase manda o link de confirmação; o profiles acompanha (sql/11)
  document.getElementById('form-email').addEventListener('submit', async (e) => {
    e.preventDefault();
    limpar();
    const email = document.getElementById('novo-email').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return mostrarErro('Informe um e-mail válido.');
    if (email === String(perfil.email || '').toLowerCase()) return mostrarErro('Esse já é o seu e-mail atual.');
    const botao = e.target.querySelector('button');
    botao.disabled = true;
    const { data, error } = await db.auth.updateUser({ email }, { emailRedirectTo: window.location.origin + '/perfil.html' });
    botao.disabled = false;
    if (error) return mostrarErro('Não foi possível trocar o e-mail: ' + error.message);
    e.target.reset();
    if (data && data.user) mostrarEmail(data.user);
    avisar('Enviamos um link de confirmação para ' + email + '. Confira também o e-mail atual: por segurança, a troca pode pedir confirmação nos dois.');
  });

  // senha: confere a atual antes de trocar
  document.getElementById('form-senha').addEventListener('submit', async (e) => {
    e.preventDefault();
    limpar();
    const atual = document.getElementById('senha-atual').value;
    const nova = document.getElementById('senha-nova').value;
    if (nova.length < 8) return mostrarErro('A nova senha precisa ter pelo menos 8 caracteres.');
    if (nova !== document.getElementById('senha-nova2').value) return mostrarErro('As senhas novas não conferem.');
    if (nova === atual) return mostrarErro('A nova senha precisa ser diferente da atual.');
    const botao = e.target.querySelector('button');
    botao.disabled = true;
    const conferir = await db.auth.signInWithPassword({ email: sessao.user.email, password: atual });
    if (conferir.error) {
      botao.disabled = false;
      return mostrarErro('Senha atual incorreta.');
    }
    const { error } = await db.auth.updateUser({ password: nova });
    botao.disabled = false;
    if (error) return mostrarErro('Não foi possível alterar a senha: ' + error.message);
    e.target.reset();
    toast('Senha alterada.');
  });

  document.getElementById('sair-todos').addEventListener('click', async () => {
    if (!window.confirm('Sair da sua conta em todos os aparelhos, inclusive neste?')) return;
    limparPerfilCache();
    await db.auth.signOut({ scope: 'global' });
    window.location.href = 'login.html';
  });
})();
