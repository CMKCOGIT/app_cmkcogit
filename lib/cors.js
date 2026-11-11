// CORS das rotas que o mvp.cmkcogit.com.br chama (Jornada e orçamento pago).
// Só origens da lista recebem permissão; o login vai no cabeçalho Authorization (Bearer),
// então não há cookie entre domínios (Allow-Credentials fica desligado).
// MVP_ORIGENS: lista separada por vírgula (padrão https://mvp.cmkcogit.com.br).
// Em desenvolvimento (APP_URL em localhost) também aceita http://localhost:3001.

export function origensPermitidas(env = process.env) {
  const lista = String(env.MVP_ORIGENS || 'https://mvp.cmkcogit.com.br')
    .split(',').map((o) => o.trim().replace(/\/+$/, '')).filter((o) => /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o));
  if (/^http:\/\/localhost/i.test(String(env.APP_URL || ''))) lista.push('http://localhost:3001');
  return new Set(lista);
}

// Aplica os cabeçalhos. Devolve true quando era um preflight (OPTIONS) já respondido.
export function aplicarCors(req, res, env = process.env) {
  const origem = String(req.headers.origin || '').replace(/\/+$/, '');
  if (origem && origensPermitidas(env).has(origem)) {
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

// Origem de quem chamou, se for uma das permitidas (para as voltas do Mercado Pago)
export function origemPermitida(req, env = process.env) {
  const origem = String(req.headers.origin || '').replace(/\/+$/, '');
  return origem && origensPermitidas(env).has(origem) ? origem : null;
}
