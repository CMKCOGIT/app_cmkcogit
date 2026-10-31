// GET /api/renovacoes   (rotina diária da Vercel — vercel.json "crons")
// Cria as cobranças de renovação dos planos mensal/anual que vencem nos próximos
// dias (sql/19: gerar_renovacoes) e avisa o cliente no sino e por e-mail.
// Protegida por CRON_SECRET: a Vercel envia "Authorization: Bearer <CRON_SECRET>".
import { criarDb } from '../lib/supabase.js';
import { json, erro, registrarErro, urlApp } from '../lib/http.js';
import { createNotification } from '../lib/notificacoes.js';
import { enviarEmail, emailRenovacao } from '../lib/email.js';
import { buscarAssinaturaMp, cancelarAssinaturaMp, estadoAssinaturaMp } from '../lib/mercadopago.js';

const DIAS_ANTES = 7;
const TOLERANCIA_CARTAO = 5; // dias após o vencimento sem cobrança no cartão -> volta para a cobrança manual

// Renovação automática no cartão (sql/20): registra as cobranças feitas pelo Mercado Pago e
// devolve para a cobrança manual quem teve a assinatura cancelada lá ou não foi cobrado a tempo.
async function sincronizarCartoes(db) {
  const resultado = { registradas: 0, voltaram_manual: 0 };
  if (!process.env.MP_ACCESS_TOKEN) return resultado;
  const lista = await db.select('assinaturas', {
    select: 'id,cliente_id,nome,proximo_vencimento,mp_preapproval_id,mp_status',
    mp_preapproval_id: 'not.is.null', status: 'neq.cancelada', mp_status: 'in.(pending,authorized,paused)'
  });
  const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); // dia em Brasília
  for (const a of lista || []) {
    try {
      const estado = estadoAssinaturaMp(await buscarAssinaturaMp(a.mp_preapproval_id));
      if (estado.cobrancas != null) {
        resultado.registradas += Number(await db.rpc('registrar_cobrancas_cartao', {
          p_assinatura_id: a.id, p_total_cobrado: estado.cobrancas, p_ultima_cobranca: estado.ultimaCobranca
        })) || 0;
      }
      const atual = await db.um('assinaturas', { select: 'proximo_vencimento,renovacao_automatica', id: 'eq.' + a.id });
      const atrasou = estado.status === 'authorized' && atual && atual.proximo_vencimento
        && (Date.parse(hoje) - Date.parse(atual.proximo_vencimento)) / 86400_000 > TOLERANCIA_CARTAO;
      let status = estado.status;
      if (atrasou) { await cancelarAssinaturaMp(a.mp_preapproval_id); status = 'cancelled'; }
      await db.rpc('atualizar_renovacao_cartao', { p_assinatura_id: a.id, p_preapproval_id: a.mp_preapproval_id, p_status: status, p_inicio: null });
      if ((atrasou || (a.mp_status === 'authorized' && status !== 'authorized'))) {
        resultado.voltaram_manual += 1;
        await createNotification(db, {
          destinatarioId: a.cliente_id,
          tipo: 'renovacao',
          titulo: 'Renovação automática desligada',
          mensagem: atrasou
            ? 'Não conseguimos cobrar o cartão de "' + a.nome + '". A renovação foi enviada para Pagamentos.'
            : 'A renovação automática de "' + a.nome + '" foi cancelada no Mercado Pago. As próximas renovações chegam por e-mail e em Pagamentos.',
          link: 'pagamentos.html'
        }).catch((e) => registrarErro('renovacoes:aviso-cartao', e));
      }
    } catch (e) { registrarErro('renovacoes:cartao', e); }
  }
  return resultado;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return erro(res, 405, 'Método não permitido.');
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.authorization !== 'Bearer ' + segredo) return erro(res, 401, 'Não autorizado.');

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('renovacoes:config', e); return erro(res, 500, 'Indisponível no momento.'); }

  let cartoes = { registradas: 0, voltaram_manual: 0 };
  try { cartoes = await sincronizarCartoes(db); } catch (e) { registrarErro('renovacoes:cartoes', e); }

  let novas;
  try {
    novas = (await db.rpc('gerar_renovacoes', { p_dias_antes: DIAS_ANTES })) || [];
  } catch (e) {
    registrarErro('renovacoes', e);
    return erro(res, 500, 'Não foi possível gerar as renovações.');
  }

  const link = urlApp() + '/pagamentos.html';
  let emails = 0;
  for (const r of novas) {
    // aviso e e-mail são "melhor esforço": a cobrança já está criada em Pagamentos
    try {
      await createNotification(db, {
        destinatarioId: r.cliente_id,
        tipo: 'renovacao',
        titulo: 'Renovação disponível para pagamento',
        mensagem: r.descricao + ' — vence em ' + new Date(r.vencimento + 'T12:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC' }),
        link: 'pagamentos.html'
      });
    } catch (e) { registrarErro('renovacoes:notificacao', e); }
    try {
      const cliente = await db.um('profiles', { select: 'nome,email', id: 'eq.' + r.cliente_id });
      const msg = emailRenovacao({ nome: cliente && cliente.nome, descricao: r.descricao, valor: r.valor, vencimento: r.vencimento, link });
      const envio = await enviarEmail({ para: cliente && cliente.email, assunto: msg.assunto, texto: msg.texto, html: msg.html });
      if (envio.enviado) emails += 1;
    } catch (e) { registrarErro('renovacoes:email', e); }
  }
  return json(res, 200, { ok: true, cobrancas: novas.length, emails, cartao: cartoes });
}
