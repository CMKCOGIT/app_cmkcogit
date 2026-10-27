// =====================================================================
// perfil.js — o cliente altera nome e WhatsApp (tabela profiles), e-mail
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
  document.getElementById('cliente-desde').textContent = fmtData(perfil.created_at || sessao.user.created_at);
  mostrarEmail(sessao.user);

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
    const botao = e.target.querySelector('button');
    botao.disabled = true;
    const { error } = await db.from('profiles').update({ nome: novoNome, telefone: fone || null }).eq('id', perfil.id);
    botao.disabled = false;
    if (error) return mostrarErro('Não foi possível salvar: ' + error.message);
    perfil = { ...perfil, nome: novoNome, telefone: fone || null };
    montarMenu(perfil);
    avisar('Dados salvos.');
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
    avisar('Senha alterada.');
  });

  document.getElementById('sair-todos').addEventListener('click', async () => {
    if (!window.confirm('Sair da sua conta em todos os aparelhos, inclusive neste?')) return;
    await db.auth.signOut({ scope: 'global' });
    window.location.href = 'login.html';
  });
})();
