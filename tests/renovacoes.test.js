// Renovação dos planos mensal/anual: rota protegida, e-mail e aviso para cada cobrança criada.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { emailRenovacao, enviarEmail } from '../lib/email.js';

Object.assign(process.env, {
  SUPABASE_URL: 'https://teste.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service',
  APP_URL: 'https://app.cmkcogit.com.br', CRON_SECRET: 'segredo-cron'
});
const { default: handler } = await import('../api/renovacoes.js');

let chamadas;
beforeEach(() => { chamadas = []; delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; });

function resp() {
  return { statusCode: 0, corpo: null, setHeader() {}, writeHead(s) { this.statusCode = s; return this; },
    end(b) { this.corpo = b ? JSON.parse(b) : null; }, status(s) { this.statusCode = s; return this; } };
}
function simular() {
  global.fetch = async (url, op = {}) => {
    const u = new URL(url);
    chamadas.push({ url: u.pathname, corpo: op.body ? JSON.parse(op.body) : null });
    const ok = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (u.pathname === '/rest/v1/rpc/gerar_renovacoes') return ok([{ pagamento_id: 'p1', cliente_id: 'aaaaaaaa-0000-4000-8000-000000000001', descricao: 'Renovação mensal — Landing Page', valor: 30, vencimento: '2026-12-01' }]);
    if (u.pathname === '/rest/v1/notificacoes') return ok([{ id: 'n1' }], 201);
    if (u.pathname === '/rest/v1/profiles') return ok([{ nome: 'Ana Souza', email: 'ana@ex.com' }]);
    if (u.origin === 'https://api.resend.com') return ok({ id: 'e1' });
    throw new Error('não simulado: ' + url);
  };
}

test('sem o segredo do cron: 401 e nada é gerado', async () => {
  simular();
  const r = resp();
  await handler({ method: 'GET', headers: {} }, r);
  assert.equal(r.statusCode, 401);
  assert.equal(chamadas.length, 0);
});

test('gera renovação, avisa no sino e manda e-mail quando o Resend está configurado', async () => {
  simular();
  Object.assign(process.env, { RESEND_API_KEY: 're_teste', EMAIL_FROM: 'CMKCOGIT <cobranca@cmkcogit.com.br>' });
  const r = resp();
  await handler({ method: 'GET', headers: { authorization: 'Bearer segredo-cron' } }, r);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.corpo, { ok: true, cobrancas: 1, emails: 1 });
  assert.ok(chamadas.some((c) => c.url === '/rest/v1/notificacoes' && c.corpo.link === 'pagamentos.html'));
  const email = chamadas.find((c) => c.url === '/emails');
  assert.deepEqual(email.corpo.to, ['ana@ex.com']);
  assert.match(email.corpo.text, /app\.cmkcogit\.com\.br\/pagamentos\.html/);
});

test('sem Resend configurado: cobrança e aviso continuam, e-mail não é enviado', async () => {
  simular();
  const r = resp();
  await handler({ method: 'GET', headers: { authorization: 'Bearer segredo-cron' } }, r);
  assert.deepEqual(r.corpo, { ok: true, cobrancas: 1, emails: 0 });
  assert.equal((await enviarEmail({ para: 'a@b.com', assunto: 'x', texto: 'y' })).motivo, 'sem_configuracao');
});

test('texto do e-mail: valor, vencimento e escape de HTML', () => {
  const m = emailRenovacao({ nome: 'Ana <b>', descricao: 'Renovação anual — Site', valor: 324, vencimento: '2027-01-15', link: 'https://app.cmkcogit.com.br/pagamentos.html' });
  assert.match(m.assunto, /15\/01\/2027/);
  assert.match(m.texto, /R\$\s?324,00/);
  assert.ok(!m.html.includes('<b>'));
});
