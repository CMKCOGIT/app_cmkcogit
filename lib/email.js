// E-mails transacionais pela API do Resend (https://resend.com), sem dependências.
// Configure na Vercel: RESEND_API_KEY e EMAIL_FROM (ex.: "CMKCOGIT <cobranca@cmkcogit.com.br>",
// com o domínio verificado no Resend). Sem essas variáveis nada é enviado e o resto continua
// funcionando: a cobrança fica em "Pagamentos" e o aviso aparece no sino da plataforma.
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function emailConfigurado(env = process.env) {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export async function enviarEmail({ para, assunto, texto, html }, env = process.env) {
  if (!emailConfigurado(env)) return { enviado: false, motivo: 'sem_configuracao' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para || '')) return { enviado: false, motivo: 'sem_email' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [para], subject: assunto, text: texto, html })
  });
  if (!r.ok) throw new Error('Resend ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return { enviado: true };
}

// Aviso de renovação: texto simples + HTML mínimo (o link leva a Pagamentos na plataforma)
export function emailRenovacao({ nome, descricao, valor, vencimento, link }) {
  const brl = Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const data = new Date(vencimento + 'T12:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  const ola = 'Olá' + (nome ? ', ' + String(nome).split(' ')[0] : '') + '!';
  const assunto = 'Renovação do seu plano CMKCOGIT — vence em ' + data;
  const texto = `${ola}\n\nA renovação "${descricao}" está disponível para pagamento: ${brl}, com vencimento em ${data}.\n\nPague com Pix, cartão ou boleto em: ${link}\n\nSe não quiser renovar, você pode cancelar na mesma página; o site continua no ar até o fim do período já pago.\n\nEquipe CMKCOGIT`;
  const html = `<p>${esc(ola)}</p><p>A renovação <strong>${esc(descricao)}</strong> está disponível para pagamento: <strong>${esc(brl)}</strong>, com vencimento em <strong>${esc(data)}</strong>.</p><p><a href="${esc(link)}">Pagar agora com Pix, cartão ou boleto</a></p><p>Se não quiser renovar, você pode cancelar na mesma página; o site continua no ar até o fim do período já pago.</p><p>Equipe CMKCOGIT</p>`;
  return { assunto, texto, html };
}
