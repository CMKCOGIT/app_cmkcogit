// Utilitários das rotas /api (formato de função da Vercel: handler(req, res)).

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function json(res, status, corpo) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corpo));
}

export function erro(res, status, mensagem) {
  json(res, status, { ok: false, erro: mensagem });
}

// A Vercel já entrega req.body como objeto quando o Content-Type é JSON.
export async function lerCorpo(req, limite = 20000) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) req.body = req.body.toString('utf8');
    if (typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
      if (req.body.length > limite) throw new Error('payload_grande');
      return req.body ? JSON.parse(req.body) : {};
    }
  }
  let texto = '';
  for await (const parte of req) {
    texto += parte;
    if (texto.length > limite) throw new Error('payload_grande');
  }
  return texto ? JSON.parse(texto) : {};
}

export function tokenDoCabecalho(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// Garante que a requisição veio de um cliente logado. Responde 401 se não.
export async function exigirUsuario(req, res, db) {
  const usuario = await db.usuarioDoToken(tokenDoCabecalho(req));
  if (!usuario) {
    erro(res, 401, 'Sua sessão expirou. Entre novamente.');
    return null;
  }
  return usuario;
}

export function urlApp(env = process.env) {
  return String(env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

// URL pública que o Mercado Pago consegue chamar (webhook). Em produção é a
// própria APP_URL; no computador, só existe se você usar um túnel (PUBLIC_URL).
export function urlPublica(env = process.env) {
  const u = String(env.PUBLIC_URL || env.APP_URL || '').replace(/\/+$/, '');
  return /^https:\/\//i.test(u) ? u : null;
}

export function registrarErro(onde, e) {
  // só a mensagem: nunca o corpo inteiro (pode conter dados do cliente)
  console.error('[' + onde + ']', e && e.status ? e.status : '', e && e.message ? e.message : e);
}
