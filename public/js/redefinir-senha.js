// redefinir-senha.js — o link do e-mail de recuperação abre esta página já com uma sessão temporária
(async function () {
  const msg = document.getElementById('mensagem');
  const form = document.getElementById('form-senha');

  function liberar() {
    msg.textContent = 'Digite sua nova senha.';
    form.hidden = false;
  }

  // Link vencido ou já usado: o Supabase volta com #error=...&error_code=otp_expired
  if (ERRO_RETORNO_AUTH) {
    history.replaceState(null, '', window.location.pathname);
    msg.innerHTML = 'Este link expirou ou já foi usado. <a href="login.html">Peça um novo em "Esqueci minha senha"</a>.';
    return;
  }
  // Só o link de recuperação do e-mail libera a troca sem a senha atual. Quem já está logado
  // e abre esta página direto troca a senha em "Meu perfil" (lá a senha atual é conferida).
  db.auth.onAuthStateChange((evento) => {
    if (evento === 'PASSWORD_RECOVERY') liberar();
  });
  if (RETORNO_RECUPERACAO && await getSessao()) liberar();
  else setTimeout(async () => {
    if (!form.hidden) return;
    msg.innerHTML = (await getSessao())
      ? 'Para trocar a senha estando logado, use <a href="perfil.html">Meu perfil</a> (pedimos a senha atual por segurança).'
      : 'Link inválido ou expirado. <a href="login.html">Peça um novo em "Esqueci minha senha"</a>.';
  }, 4000);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const senha = document.getElementById('nova-senha').value;
    if (senha.length < 8) { msg.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; return; }
    if (senha !== document.getElementById('nova-senha2').value) { msg.textContent = 'As senhas não conferem.'; return; }
    const botao = form.querySelector('button');
    ocupado(botao, true);
    const { error } = await db.auth.updateUser({ password: senha });
    if (error) {
      ocupado(botao, false);
      const t = String(error.message).toLowerCase();
      msg.textContent = t.includes('different from the old') || t.includes('same')
        ? 'A nova senha precisa ser diferente da anterior.'
        : t.includes('session') || t.includes('jwt') ? 'O link expirou. Peça um novo em "Esqueci minha senha".'
        : 'Não foi possível salvar a nova senha agora. Tente de novo ou peça outro link.';
      return;
    }
    // a senha mudou: quem estava logado com a senha antiga em outro aparelho sai
    await db.auth.signOut({ scope: 'others' }).catch(() => {});
    msg.textContent = 'Senha alterada! Saímos da sua conta nos outros aparelhos. Redirecionando...';
    setTimeout(() => window.location.replace(proximaPagina()), 1200);
  });
})();
