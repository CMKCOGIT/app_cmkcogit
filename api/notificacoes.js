// /api/notificacoes   (cliente ou admin logado) — usado pelo sino do topo
//   GET                                   -> { ok, nao_lidas, notificacoes: [...] } (mais recentes primeiro)
//   POST { acao: 'marcar_lida', ids: [] } -> { ok, nao_lidas }
//   POST { acao: 'marcar_todas' }         -> { ok, nao_lidas }
// Cada um só vê e altera as próprias notificações (filtro por usuario_id no servidor).
import { criarDb } from '../lib/supabase.js';
import { json, erro, lerCorpo, exigirUsuario, exigirCadastroCompleto, registrarErro } from '../lib/http.js';
import { listarNotificacoes, marcarComoLidas, LIMITE_LISTA } from '../lib/notificacoes.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return erro(res, 405, 'Método não permitido.');

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('notificacoes:config', e); return erro(res, 500, 'Indisponível no momento.'); }

  const usuario = await exigirUsuario(req, res, db);
  if (!usuario) return;
  if (!(await exigirCadastroCompleto(usuario, res, db))) return;

  try {
    if (req.method === 'GET') {
      const limite = Math.min(Math.max(Number(req.query && req.query.limite) || 20, 1), LIMITE_LISTA);
      const r = await listarNotificacoes(db, usuario.id, limite);
      return json(res, 200, { ok: true, nao_lidas: r.naoLidas, notificacoes: r.notificacoes });
    }

    let corpo;
    try { corpo = await lerCorpo(req, 6000); } catch { return erro(res, 400, 'Requisição inválida.'); }
    if (corpo.acao === 'marcar_todas') {
      return json(res, 200, { ok: true, nao_lidas: await marcarComoLidas(db, usuario.id, null) });
    }
    if (corpo.acao === 'marcar_lida' && Array.isArray(corpo.ids)) {
      return json(res, 200, { ok: true, nao_lidas: await marcarComoLidas(db, usuario.id, corpo.ids) });
    }
    return erro(res, 400, 'Ação inválida.');
  } catch (e) {
    registrarErro('notificacoes', e);
    return erro(res, 500, 'Não foi possível carregar as notificações agora.');
  }
}
