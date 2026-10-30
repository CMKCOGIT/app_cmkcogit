// comprovante.js — página pública do comprovante (comprovante.html?t=<token>).
// Não precisa de login: o token aleatório do link é a chave. "Baixar PDF" usa a
// impressão do navegador (Salvar como PDF), com o layout de impressão do CSS.
(async function () {
  const area = document.getElementById('area-comprovante');
  const t = new URLSearchParams(window.location.search).get('t') || '';
  const falha = (texto) => { area.innerHTML = `<p data-comp-erro role="alert">${texto}</p>`; };
  if (!/^[A-Za-z0-9_-]{32}$/.test(t)) return falha('Link de comprovante inválido. Confira se copiou o link inteiro.');

  let dados;
  try {
    const resp = await fetch('/api/comprovante?t=' + encodeURIComponent(t), { headers: { Accept: 'application/json' } });
    dados = await resp.json().catch(() => ({}));
    if (!resp.ok || !dados.ok) return falha(resp.status === 404 ? 'Comprovante não encontrado. O link pode ter sido digitado errado.' : 'Não foi possível abrir o comprovante agora. Tente de novo em instantes.');
  } catch (_) {
    return falha('Sem conexão. Verifique sua internet e tente de novo.');
  }

  const c = dados.comprovante;
  document.title = 'Comprovante ' + c.codigo + ' | CMKCOGIT';
  area.innerHTML = Comprovante.html(c, dados.pagamento);
  document.getElementById('acoes-comprovante').hidden = false;
  document.getElementById('btn-pagar').hidden = dados.pagamento.codigo !== 'liberado';
  document.getElementById('btn-pdf').addEventListener('click', () => window.print());
})();
