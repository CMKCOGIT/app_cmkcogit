// GET /api/comprovante?t=<token>   (PÚBLICA — quem tem o link vê o comprovante)
// Devolve a cópia do pedido gravada na aprovação + o status atual do pagamento.
// Sem token válido: 404 (não diz se o pedido existe).
import { criarDb } from '../lib/supabase.js';
import { json, erro, registrarErro } from '../lib/http.js';
import { TOKEN, statusPagamento } from '../lib/comprovante.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return erro(res, 405, 'Método não permitido.');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  const t = String((req.query && req.query.t) || new URL(req.url, 'http://local').searchParams.get('t') || '');
  if (!TOKEN.test(t)) return erro(res, 404, 'Comprovante não encontrado.');

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('comprovante:config', e); return erro(res, 500, 'Indisponível no momento.'); }

  try {
    const s = await db.um('solicitacoes', { select: 'status,comprovante', comprovante_token: 'eq.' + t });
    if (!s || !s.comprovante) return erro(res, 404, 'Comprovante não encontrado.');
    return json(res, 200, { ok: true, comprovante: s.comprovante, pagamento: statusPagamento(s.status) });
  } catch (e) {
    registrarErro('comprovante', e);
    return erro(res, 500, 'Não foi possível abrir o comprovante agora.');
  }
}
