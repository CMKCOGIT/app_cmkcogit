// POST /api/mp-webhook   (chamado pelo Mercado Pago)
// Nunca confia no corpo da notificação: valida a assinatura (quando enviada),
// busca o pagamento na API do Mercado Pago e só então aplica no banco.
//
// Painel do Mercado Pago > Suas integrações > (aplicação) > Webhooks:
//   URL: https://app.cmkcogit.com.br/api/mp-webhook   Evento: Pagamentos
//   Copie a "assinatura secreta" para a variável MP_WEBHOOK_SECRET.
import { criarDb } from '../lib/supabase.js';
import { registrarErro, UUID } from '../lib/http.js';
import { assinaturaValida, buscarPagamento, aplicarNoBanco } from '../lib/mercadopago.js';

function responder(res, status, texto) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(texto);
}

async function lerJsonSeguro(req) {
  if (Buffer.isBuffer(req.body)) req.body = req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body || '{}'); } catch { return {}; } }
  let t = '';
  try { for await (const p of req) { t += p; if (t.length > 20000) break; } } catch { /* sem corpo */ }
  try { return JSON.parse(t || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return responder(res, 200, 'ok');

  const url = new URL(req.url, 'http://local');
  const corpo = await lerJsonSeguro(req);

  const tipo = String(corpo.type || url.searchParams.get('type') || url.searchParams.get('topic') || '');
  const dataId = String(url.searchParams.get('data.id') || (corpo.data && corpo.data.id) || url.searchParams.get('id') || '');
  if (tipo !== 'payment' || !/^\d{1,30}$/.test(dataId)) return responder(res, 200, 'ignorado');

  // assinatura: se o Mercado Pago mandou, tem que bater
  const segredo = process.env.MP_WEBHOOK_SECRET;
  const xSignature = req.headers['x-signature'];
  if (segredo && xSignature) {
    const ok = assinaturaValida({ segredo, xSignature, xRequestId: req.headers['x-request-id'], dataId });
    if (!ok) {
      registrarErro('mp-webhook', 'assinatura inválida para data.id ' + dataId);
      return responder(res, 401, 'assinatura inválida');
    }
  }

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('mp-webhook:config', e); return responder(res, 500, 'configuração'); }

  try {
    const mp = await buscarPagamento(dataId);
    if (!mp) return responder(res, 200, 'pagamento inexistente'); // "simular" do painel usa id fictício

    const ref = String(mp.external_reference || '');
    if (!UUID.test(ref)) return responder(res, 200, 'sem referência');

    const resultado = await aplicarNoBanco(db, ref, mp, 'webhook');
    return responder(res, 200, String(resultado));
  } catch (e) {
    registrarErro('mp-webhook', e);
    return responder(res, 500, 'tente novamente'); // o Mercado Pago reenvia
  }
}
