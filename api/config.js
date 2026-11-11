// GET /config.js  (vercel.json reescreve /config.js -> /api/config)
// Entrega ao navegador SÓ as configurações públicas: URL do Supabase e a chave
// "anon" (feita para ficar no navegador; a segurança é o RLS do banco).
// A service_role e o token do Mercado Pago NUNCA saem do servidor.

export default function handler(req, res) {
  const env = process.env;
  const config = {
    supabaseUrl: env.SUPABASE_URL || '',
    supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
    siteUrl: (env.SITE_URL || 'https://www.cmkcogit.com.br').replace(/\/+$/, ''),
    whatsapp: (env.WHATSAPP_SUPORTE || '5517981568889').replace(/\D/g, ''),
    // login único entre app. e mvp. (sessão em cookie no domínio pai; vazio = só neste domínio)
    cookieDomain: /^\.?[a-z0-9.-]+\.[a-z]{2,}$/i.test(env.COOKIE_DOMAIN || '') ? env.COOKIE_DOMAIN : '',
    // captcha do cadastro/login (Cloudflare Turnstile; a chave secreta fica só no painel do Supabase)
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
    mvpUrl: (env.MVP_URL || 'https://mvp.cmkcogit.com.br').replace(/\/+$/, '')
  };
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  // CDN da Vercel guarda por 1 dia e serve a cópia antiga enquanto renova (sem partida a frio para quem visita);
  // trocar variável exige deploy, que limpa o cache
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800');
  res.end('window.COGIT_CONFIG = Object.freeze(' + JSON.stringify(config) + ');\n');
}
