// =====================================================================
// sso.js — login único com o mvp.cmkcogit.com.br (sem cookie compartilhado). Dois papéis:
//
// 1. RECEBER (#token_hash=...&volta=...): o mvp mandou um código de uso único para a pessoa que já
//    está logada lá. Troca o código por uma sessão própria deste site (verifyOtp) e segue.
// 2. EMITIR (?para=mvp&volta=...): o mvp quer saber se a pessoa está logada aqui. Logada: pede o
//    código ao servidor (/api/sso, que só aceita destinos do ambiente) e manda para o mvp. Não logada:
//    devolve ao login do mvp com ?sso=0 (lá aparece a tela de login normal).
// =====================================================================
(async function () {
  const estado = document.getElementById('sso-estado');
  estado.innerHTML = carregandoCogit('Entrando...');
  const caminho = (v) => (/^\/(?!\/)[\w./%-]*(\?[\w=&%.-]*)?$/.test(v || '') ? v : null);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));

  if (hash.get('token_hash')) {
    history.replaceState(null, '', window.location.pathname);   // o código some da barra e do histórico
    const { error } = await db.auth.verifyOtp({ token_hash: hash.get('token_hash'), type: 'magiclink' });
    if (error) { window.location.replace('/login.html?sso=0'); return; }
    SSO.entrou();
    window.location.replace(caminho(hash.get('volta')) || '/' + proximaPagina());
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const volta = caminho(params.get('volta')) || '/painel.html';
  if (params.get('para') !== 'mvp' || !CFG.mvpUrl) { window.location.replace('/login.html'); return; }
  const voltarSemLogin = () => window.location.replace(CFG.mvpUrl + '/entrar.html?sso=0&volta=' + encodeURIComponent(volta));
  let saiu = false;
  try { saiu = Boolean(localStorage.getItem(SSO.SAIU)); } catch (_) {}
  if (saiu || !(await getSessao())) { voltarSemLogin(); return; }
  try {
    const r = await api('sso', { para: 'mvp', volta });
    if (!String(r.url).startsWith(CFG.mvpUrl + '/sso.html#')) throw new Error('destino inesperado');
    window.location.replace(r.url);
  } catch (_) {
    voltarSemLogin();
  }
})();
