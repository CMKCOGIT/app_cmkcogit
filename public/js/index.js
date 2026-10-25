// index.js — porta de entrada: manda para o login ou para dentro da plataforma
(async function () {
  capturarCfgDaUrl(); // se alguém chegou aqui com #cfg=..., guarda a solução
  const sessao = await getSessao();
  window.location.replace(sessao ? proximaPagina() : 'login.html');
})();
