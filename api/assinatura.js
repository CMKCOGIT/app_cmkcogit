// POST /api/assinatura   (cliente logado) — planos mensal/anual do modelo pronto
// Corpo: { assinatura_id, acao }
//   acao 'ativar_cartao'    -> cria a assinatura no Mercado Pago e devolve { url } para cadastrar o cartão
//   acao 'verificar_cartao' -> consulta o Mercado Pago e liga a renovação automática se o cartão foi autorizado
//   acao 'desligar_cartao'  -> cancela no Mercado Pago; a renovação volta a ser por cobrança (e-mail + Pagamentos)
//   acao 'cancelar'         -> cancela a renovação (e o cartão, se houver); o site fica no ar até o fim do período
import { criarDb } from '../lib/supabase.js';
import { json, erro, lerCorpo, exigirUsuario, exigirCadastroCompleto, registrarErro, UUID, urlApp } from '../lib/http.js';
import { criarAssinaturaMp, buscarAssinaturaMp, cancelarAssinaturaMp, estadoAssinaturaMp } from '../lib/mercadopago.js';

const ACOES = ['ativar_cartao', 'verificar_cartao', 'desligar_cartao', 'cancelar'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return erro(res, 405, 'Método não permitido.');

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('assinatura:config', e); return erro(res, 500, 'Indisponível no momento.'); }

  const usuario = await exigirUsuario(req, res, db);
  if (!usuario) return;
  if (!(await exigirCadastroCompleto(usuario, res, db))) return;

  let corpo;
  try { corpo = await lerCorpo(req, 2000); } catch { return erro(res, 400, 'Requisição inválida.'); }
  if (typeof corpo.assinatura_id !== 'string' || !UUID.test(corpo.assinatura_id) || !ACOES.includes(corpo.acao)) {
    return erro(res, 400, 'Requisição inválida.');
  }

  try {
    const a = await db.um('assinaturas', { select: '*', id: 'eq.' + corpo.assinatura_id, cliente_id: 'eq.' + usuario.id });
    if (!a) return erro(res, 404, 'Plano não encontrado.');
    if (corpo.acao !== 'cancelar' && !process.env.MP_ACCESS_TOKEN) return erro(res, 500, 'Pagamento indisponível no momento.');

    if (corpo.acao === 'cancelar') {
      if (a.mp_preapproval_id && a.mp_status !== 'cancelled') await cancelarAssinaturaMp(a.mp_preapproval_id);
      const ate = await db.rpc('cancelar_assinatura', { p_assinatura_id: a.id });
      return json(res, 200, { ok: true, no_ar_ate: ate });
    }

    if (a.status === 'cancelada') return erro(res, 409, 'Este plano está cancelado.');

    if (corpo.acao === 'ativar_cartao') {
      if (a.renovacao_automatica) return erro(res, 409, 'A renovação automática já está ligada.');
      // 1ª cobrança no próximo vencimento; vencido (ou hoje), cobra em seguida
      const venc = new Date(a.proximo_vencimento + 'T12:00:00-03:00');
      const inicio = venc.getTime() > Date.now() + 3600_000 ? venc : new Date(Date.now() + 10 * 60_000);
      const pre = await criarAssinaturaMp({
        referencia: a.id,
        motivo: 'CMKCOGIT — ' + a.nome + ' (plano ' + a.plano + ')',
        email: usuario.email,
        valor: a.valor,
        plano: a.plano,
        inicio,
        voltarPara: urlApp() + '/pagamentos.html?renovacao=' + a.id
      });
      await db.rpc('atualizar_renovacao_cartao', { p_assinatura_id: a.id, p_preapproval_id: String(pre.id), p_status: estadoAssinaturaMp(pre).status, p_inicio: inicio.toISOString().slice(0, 10) });
      if (!/^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(\.[a-z]{2})?\//i.test(pre.init_point || '')) throw new Error('Link de assinatura inesperado');
      return json(res, 200, { ok: true, url: pre.init_point });
    }

    if (!a.mp_preapproval_id) return erro(res, 409, 'A renovação automática não foi ativada para este plano.');

    if (corpo.acao === 'verificar_cartao') {
      const estado = estadoAssinaturaMp(await buscarAssinaturaMp(a.mp_preapproval_id));
      await db.rpc('atualizar_renovacao_cartao', { p_assinatura_id: a.id, p_preapproval_id: a.mp_preapproval_id, p_status: estado.status, p_inicio: null });
      return json(res, 200, { ok: true, status: estado.status, renovacao_automatica: estado.status === 'authorized' });
    }

    // desligar_cartao
    await cancelarAssinaturaMp(a.mp_preapproval_id);
    await db.rpc('atualizar_renovacao_cartao', { p_assinatura_id: a.id, p_preapproval_id: a.mp_preapproval_id, p_status: 'cancelled', p_inicio: null });
    return json(res, 200, { ok: true, renovacao_automatica: false });
  } catch (e) {
    registrarErro('assinatura:' + corpo.acao, e);
    return erro(res, 502, 'Não foi possível concluir agora. Tente novamente em instantes.');
  }
}
