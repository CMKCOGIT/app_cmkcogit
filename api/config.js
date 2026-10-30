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
    whatsapp: (env.WHATSAPP_SUPORTE || '5517981568889').replace(/\D/g, '')
  };
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  // CDN da Vercel guarda por 1 h (não roda a função a cada página); trocar variável exige deploy, que limpa o cache
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  res.end('window.COGIT_CONFIG = Object.freeze(' + JSON.stringify(config) + ');\n');
}
