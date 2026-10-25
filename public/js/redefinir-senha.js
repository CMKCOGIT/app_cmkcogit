// redefinir-senha.js — o link do e-mail de recuperação abre esta página já com uma sessão temporária
(async function () {
  const msg = document.getElementById('mensagem');
  const form = document.getElementById('form-senha');

  function liberar() {
    msg.textContent = 'Digite sua nova senha.';
    form.hidden = false;
  }

  db.auth.onAuthStateChange((evento) => {
    if (evento === 'PASSWORD_RECOVERY') liberar();
  });
  if (await getSessao()) liberar();
  else setTimeout(() => { if (form.hidden) msg.textContent = 'Link inválido ou expirado. Peça um novo em "Esqueci minha senha".'; }, 4000);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const senha = document.getElementById('nova-senha').value;
    if (senha.length < 8) { msg.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; return; }
    if (senha !== document.getElementById('nova-senha2').value) { msg.textContent = 'As senhas não conferem.'; return; }
    const botao = form.querySelector('button');
    botao.disabled = true;
    const { error } = await db.auth.updateUser({ password: senha });
    if (error) {
      botao.disabled = false;
      msg.textContent = 'Não foi possível salvar: ' + error.message;
      return;
    }
    msg.textContent = 'Senha alterada! Redirecionando...';
    setTimeout(() => window.location.replace(proximaPagina()), 1200);
  });
})();
