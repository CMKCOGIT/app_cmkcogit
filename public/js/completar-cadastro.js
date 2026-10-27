// =====================================================================
// completar-cadastro.js — dados obrigatórios antes de liberar a plataforma
// (quem entrou pelo Google, ou qualquer conta com cadastro pendente).
// O rascunho (nome/WhatsApp) é salvo no perfil enquanto a pessoa digita, então
// sair, fechar o navegador ou atualizar a página não perde nada. A conclusão só
// é gravada pelo banco (concluir_cadastro), depois de validar tudo.
// =====================================================================
(async function () {
  const msg = document.getElementById('mensagem');
  const form = document.getElementById('form-completar');
  const campoNome = document.getElementById('comp-nome');
  const campoFone = document.getElementById('comp-telefone');
  const campoAceite = document.getElementById('comp-aceite');
  const pendencias = document.getElementById('pendencias');
  const rascunho = document.getElementById('rascunho');

  function mensagem(texto, erro) {
    msg.textContent = texto || '';
    msg.setAttribute('role', erro ? 'alert' : 'status');
  }

  document.getElementById('sair-cadastro').addEventListener('click', sair);
  document.getElementById('link-termos').href = urlSite('termos-de-uso.html');
  document.getElementById('link-privacidade').href = urlSite('privacidade.html');

  const sessao = await getSessao();
  if (!sessao) {
    window.location.replace('login.html');
    return;
  }

  let perfil;
  try {
    perfil = await getPerfil();
  } catch (e) {
    mensagem(e.message, true);
    msg.insertAdjacentHTML('afterend', '<p><button type="button" id="btn-recarregar">Tentar de novo</button></p>');
    document.getElementById('btn-recarregar').addEventListener('click', () => window.location.reload());
    return;
  }

  // Já concluído (ex.: abriu esta página pelo histórico): segue para a plataforma
  if (cadastroConcluido(perfil)) {
    window.location.replace(proximaPagina());
    return;
  }

  // Preenche com o que já está salvo (nome do Google ou rascunho anterior)
  document.getElementById('comp-email').value = perfil.email || sessao.user.email || '';
  campoNome.value = perfil.nome || '';
  campoFone.value = perfil.telefone || '';
  campoFone.value = formatarTelefone(campoFone.value);
  const jaAceitou = Boolean(perfil.aceite_termos_em);
  if (jaAceitou) {
    campoAceite.checked = true;
    campoAceite.disabled = true;
  }

  const nomeValido = () => campoNome.value.trim().replace(/\s+/g, ' ').length >= 2;
  const digitosFone = () => campoFone.value.replace(/\D/g, '');
  const foneValido = () => !digitosFone() || /^\d{10,11}$/.test(digitosFone());

  function faltando() {
    const f = [];
    if (!nomeValido()) f.push('seu nome');
    if (!foneValido()) f.push('um WhatsApp válido com DDD (ou deixe em branco)');
    if (!jaAceitou && !campoAceite.checked) f.push('aceitar os Termos de Uso e a Política de Privacidade');
    return f;
  }
  function mostrarPendencias() {
    const f = faltando();
    pendencias.innerHTML = f.length
      ? '<p><strong>Para concluir, falta:</strong></p><ul>' + f.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>'
      : '<p><strong>Tudo pronto.</strong> Clique em "Concluir cadastro".</p>';
  }

  // Rascunho: grava nome/WhatsApp válidos no perfil (RLS: só o próprio; role e conclusão não são graváveis)
  let timer = null;
  let ultimoSalvo = JSON.stringify({ nome: perfil.nome || '', telefone: perfil.telefone || null });
  async function salvarRascunho() {
    clearTimeout(timer);
    if (!nomeValido() || !foneValido()) return;
    const dados = { nome: campoNome.value.trim().replace(/\s+/g, ' '), telefone: digitosFone() || null };
    const chave = JSON.stringify(dados);
    if (chave === ultimoSalvo) return;
    const { error } = await db.from('profiles').update(dados).eq('id', sessao.user.id);
    if (error) {
      rascunho.textContent = 'Não foi possível salvar o rascunho agora. O que você digitou continua aqui.';
      return;
    }
    ultimoSalvo = chave;
    rascunho.textContent = 'Rascunho salvo às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '. Você pode continuar depois.';
  }
  function aoDigitar() {
    mostrarPendencias();
    clearTimeout(timer);
    timer = setTimeout(salvarRascunho, 900);
  }

  campoNome.addEventListener('input', aoDigitar);
  campoFone.addEventListener('input', () => { campoFone.value = formatarTelefone(campoFone.value); aoDigitar(); });
  campoNome.addEventListener('change', salvarRascunho);
  campoFone.addEventListener('change', salvarRascunho);
  campoAceite.addEventListener('change', mostrarPendencias);

  function traduzirErro(m) {
    const t = String(m || '').toLowerCase();
    if (t.includes('jwt') || t.includes('sessão expirou')) return null; // tratado à parte
    if (t.includes('failed to fetch') || t.includes('network')) return 'Sem conexão. Verifique sua internet — seus dados continuam aqui.';
    if (t.includes('could not find the function')) return 'A plataforma está sendo atualizada. Tente novamente em alguns minutos.';
    return m || 'Não foi possível salvar agora. Tente novamente.';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = faltando();
    mostrarPendencias();
    if (f.length) {
      mensagem('Para concluir, falta: ' + f.join('; ') + '.', true);
      (!nomeValido() ? campoNome : !foneValido() ? campoFone : campoAceite).focus();
      return;
    }
    const botao = form.querySelector('button[type=submit]');
    botao.disabled = true;
    mensagem('Salvando seu cadastro...');
    clearTimeout(timer);

    const { error } = await db.rpc('concluir_cadastro', {
      p_nome: campoNome.value,
      p_telefone: digitosFone() || null,
      p_aceite: jaAceitou || campoAceite.checked
    });
    if (error) {
      botao.disabled = false;
      const texto = traduzirErro(error.message);
      if (texto === null || !(await getSessao())) {
        mensagem('Sua sessão expirou. Entre novamente — o que já foi salvo continua na sua conta.', true);
        setTimeout(() => window.location.replace('login.html'), 2500);
        return;
      }
      return mensagem(texto, true);
    }

    // Confere no banco antes de liberar (a conclusão vale pelo que foi gravado)
    try {
      perfil = await getPerfil();
    } catch (err) {
      botao.disabled = false;
      return mensagem(err.message, true);
    }
    if (!cadastroConcluido(perfil)) {
      botao.disabled = false;
      return mensagem('Não foi possível confirmar seu cadastro. Tente novamente.', true);
    }
    mensagem('Cadastro concluído! Abrindo a plataforma...');
    window.location.replace(proximaPagina());
  });

  mostrarPendencias();
  mensagem('');
  form.hidden = false;
  (nomeValido() ? (jaAceitou ? campoFone : campoAceite) : campoNome).focus();
})();
