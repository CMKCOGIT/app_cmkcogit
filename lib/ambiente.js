// Ambiente de teste nos previews da Vercel (cada branch/PR ganha uma URL de preview).
//
// No preview (VERCEL_ENV=preview) o pagamento usa SEMPRE as credenciais de TESTE do Mercado Pago:
//   MP_ACCESS_TOKEN_TESTE   -> Access Token da conta de teste VENDEDORA (começa com APP_USR-)
//   MP_WEBHOOK_SECRET_TESTE -> assinatura secreta do webhook de teste (opcional)
// Sem MP_ACCESS_TOKEN_TESTE, o preview NÃO usa o token de produção: o pagamento fica indisponível
// (assim nenhum teste gera cobrança de verdade). Os links de volta do checkout apontam para a
// URL do próprio preview (VERCEL_BRANCH_URL). Produção e o computador local não mudam.
//
// Importado por lib/http.js, que todas as rotas usam, então vale antes de qualquer requisição.

export function aplicarAmbiente(env = process.env) {
  if (env.VERCEL_ENV !== 'preview' || env.COGIT_AMBIENTE_APLICADO) return env;
  env.MP_ACCESS_TOKEN = env.MP_ACCESS_TOKEN_TESTE || '';
  env.MP_WEBHOOK_SECRET = env.MP_WEBHOOK_SECRET_TESTE || '';
  const url = env.VERCEL_BRANCH_URL || env.VERCEL_URL;
  if (url) {
    env.APP_URL = 'https://' + String(url).replace(/^https?:\/\//, '').replace(/\/+$/, '');
    env.PUBLIC_URL = env.APP_URL;
  }
  env.COGIT_AMBIENTE_APLICADO = '1';
  return env;
}

aplicarAmbiente();
