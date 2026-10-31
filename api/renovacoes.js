// GET /api/renovacoes   (rotina diária da Vercel — vercel.json "crons")
// Cria as cobranças de renovação dos planos mensal/anual que vencem nos próximos
// dias (sql/19: gerar_renovacoes) e avisa o cliente no sino e por e-mail.
// Protegida por CRON_SECRET: a Vercel envia "Authorization: Bearer <CRON_SECRET>".
import { criarDb } from '../lib/supabase.js';
import { json, erro, registrarErro, urlApp } from '../lib/http.js';
import { createNotification } from '../lib/notificacoes.js';
import { enviarEmail, emailRenovacao } from '../lib/email.js';

const DIAS_ANTES = 7;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return erro(res, 405, 'Método não permitido.');
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.authorization !== 'Bearer ' + segredo) return erro(res, 401, 'Não autorizado.');

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('renovacoes:config', e); return erro(res, 500, 'Indisponível no momento.'); }

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
  return json(res, 200, { ok: true, cobrancas: novas.length, emails });
}
