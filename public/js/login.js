// =====================================================================
// login.js — entrar, criar conta e recuperar senha
// =====================================================================
(async function () {
  const formLogin = document.getElementById('form-login');
  const formCadastro = document.getElementById('form-cadastro');
  const msg = document.getElementById('mensagem');
  const card = document.getElementById('auth-card');
  const blocosPainel = card.querySelectorAll('.auth-painel-conteudo');
  const movimentoReduzido = window.matchMedia('(prefers-reduced-motion: reduce)');
  const celular = window.matchMedia('(max-width: 759.98px)');
  // ms — fim da animação mais longa em plataforma.css (card de dois painéis / versão compacta)
  const DURACAO_TROCA = 800;
  const DURACAO_TROCA_CELULAR = 480;
  let modo = card.dataset.modo || 'login';
  let trocando = false;

  function mensagem(texto, erro) {
    msg.textContent = texto || '';
    msg.setAttribute('role', erro ? 'alert' : 'status');
  }

  // Só o formulário (e o bloco do painel) do modo atual aceita clique e teclado.
  function aplicarModo(qual) {
    modo = qual;
    card.dataset.modo = qual;
    formLogin.inert = qual !== 'login';
    formCadastro.inert = qual !== 'cadastro';
    blocosPainel.forEach((b) => { b.inert = b.dataset.para !== qual; });
  }

  // Troca sem animação (abertura da página já em "cadastro")
  function definirModoSemAnimacao(qual) {
    card.classList.add('sem-transicao');
    aplicarModo(qual);
    void card.offsetWidth; // aplica o estado antes de religar as transições
    card.classList.remove('sem-transicao');
  }

  // Alterna com a animação dos painéis. Cliques durante a troca são ignorados,
  // então o card nunca fica entre dois estados. Os dados digitados ficam nos campos.
  function mostrar(qual) {
    if (qual === modo || trocando) return;
    mensagem('');
    const espera = movimentoReduzido.matches ? 0 : celular.matches ? DURACAO_TROCA_CELULAR : DURACAO_TROCA;
    trocando = true;
    card.classList.add('trocando');
    aplicarModo(qual);
    setTimeout(() => {
      trocando = false;
      card.classList.remove('trocando');
      const primeiro = (qual === 'login' ? formLogin : formCadastro).querySelector('input');
      if (primeiro) primeiro.focus();
    }, espera);
  }
  aplicarModo(modo);

  document.getElementById('link-termos').href = urlSite('termos-de-uso.html');
  document.getElementById('link-privacidade').href = urlSite('privacidade.html');
  document.getElementById('ir-cadastro').addEventListener('click', () => mostrar('cadastro'));
  document.getElementById('ir-login').addEventListener('click', () => mostrar('login'));

  // Se o cliente veio do site com uma solução, mostra o resumo e abre "Criar conta"
  capturarCfgDaUrl();
  const pendente = lerPendente();
  if (pendente) {
    document.getElementById('pendente').hidden = false;
    document.getElementById('pendente-resumo').innerHTML = resumoPendenteHtml(pendente);
    definirModoSemAnimacao('cadastro');
  }

  // Já está logado? Segue direto.
  if (await getSessao()) {
    window.location.replace(proximaPagina());
    return;
  }

  function traduzirErro(m) {
    const t = String(m || '').toLowerCase();
    if (t.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
    if (t.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar (procure o link na sua caixa de entrada e no spam).';
    if (t.includes('already registered') || t.includes('already been registered')) return 'Este e-mail já tem conta. Use "Entrar".';
    if (t.includes('password should be at least') || t.includes('weak')) return 'Escolha uma senha mais forte (mínimo 8 caracteres).';
    if (t.includes('rate limit') || t.includes('too many')) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    if (t.includes('invalid email') || t.includes('unable to validate email')) return 'E-mail inválido.';
    return m || 'Não foi possível concluir agora.';
  }

  const telefone = document.getElementById('cad-telefone');
  telefone.addEventListener('input', () => { telefone.value = formatarTelefone(telefone.value); });

  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-senha').value;
    if (!email || !senha) return mensagem('Preencha e-mail e senha.', true);
    const botao = formLogin.querySelector('button[type=submit]');
    botao.disabled = true;
    mensagem('Entrando...');
    const { error } = await db.auth.signInWithPassword({ email, password: senha });
    if (error) {
      botao.disabled = false;
      return mensagem(traduzirErro(error.message), true);
    }
    window.location.href = proximaPagina();
  });

  formCadastro.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('cad-nome').value.trim();
    const email = document.getElementById('cad-email').value.trim();
    const fone = telefone.value.replace(/\D/g, '');
    const senha = document.getElementById('cad-senha').value;

    if (nome.length < 2) return mensagem('Informe seu nome.', true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return mensagem('Informe um e-mail válido.', true);
    if (fone && !/^\d{10,11}$/.test(fone)) return mensagem('WhatsApp com DDD: 10 ou 11 números.', true);
    if (senha.length < 8) return mensagem('A senha precisa ter pelo menos 8 caracteres.', true);
    if (senha !== document.getElementById('cad-senha2').value) return mensagem('As senhas não conferem.', true);
    if (!document.getElementById('cad-aceite').checked) return mensagem('Para criar a conta, aceite os Termos de Uso e a Política de Privacidade.', true);

    const botao = formCadastro.querySelector('button[type=submit]');
    botao.disabled = true;
    mensagem('Criando conta...');

    const { data, error } = await db.auth.signUp({
      email,
      password: senha,
      options: {
        data: { nome, telefone: fone, aceite_termos_em: new Date().toISOString() }, // o SQL usa nome/telefone para criar o perfil
        emailRedirectTo: window.location.origin + '/' + proximaPagina()
      }
    });
    if (error) {
      botao.disabled = false;
      return mensagem(traduzirErro(error.message), true);
    }
    if (!data.session) {
      // confirmação de e-mail ligada no Supabase
      formCadastro.hidden = true;
      return mensagem('Conta criada! Enviamos um link de confirmação para ' + email +
        '. Abra o link NESTE MESMO navegador para continuar de onde parou' + (pendente ? ' — sua solução fica guardada aqui.' : '.'));
    }
    window.location.href = proximaPagina();
  });

  document.getElementById('esqueci-senha').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    if (!email) return mensagem('Digite seu e-mail no campo acima e clique de novo em "Esqueci minha senha".', true);
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/redefinir-senha.html' });
    if (error) return mensagem(traduzirErro(error.message), true);
    mensagem('Se este e-mail tiver conta, você receberá um link para criar uma nova senha.');
  });
})();
