// Limite de requisições (rate limit) das rotas /api.
// Conta no banco (tabela rate_limits + função consumir_limite, sql/33_seguranca.sql), então
// vale para todas as instâncias da Vercel ao mesmo tempo. Passou do limite: 429 com
// Retry-After e uma mensagem amigável. Se o banco ainda não tiver a função (sql/33 não
// rodado) ou falhar, a requisição SEGUE (o limite nunca derruba a plataforma).
import { json, registrarErro } from './http.js';

// chave -> [máximo, janela em segundos]. Ajuste aqui.
export const LIMITES = Object.freeze({
  checkout: [10, 600],              // abrir pagamento: 10 a cada 10 min por cliente
  verificar: [20, 300],             // "Já paguei — verificar": 20 a cada 5 min por cliente
  solicitacao_ip: [30, 3600],       // criar solicitação: 30 por hora por IP (além das 15/h por conta)
  solicitacao_acao: [30, 600],      // reenviar / aprovar / recusar / cancelar: 30 a cada 10 min
  itens: [30, 600],                 // tirar itens
  admin: [120, 600],                // ações do admin
  comprovante_ip: [60, 600],        // comprovante público por IP
  notificacoes: [240, 600],         // sino (lista a cada 45 s + cliques)
  assinatura: [10, 600]             // plano/renovação no cartão
});

let avisouSemFuncao = false;

// IP de quem chamou. Na Vercel o x-forwarded-for é definido pela própria plataforma.
export function ipDe(req) {
  const h = (req && req.headers) || {};
  const xff = String(h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim();
  return xff.slice(0, 64) || 'desconhecido';
}

/**
 * Consome uma unidade do limite. Devolve true se pode seguir; false se já respondeu 429.
 * @param db   cliente do servidor (lib/supabase.js)
 * @param res  resposta da Vercel
 * @param nome chave de LIMITES
 * @param quem id do usuário ou IP
 */
export async function limitar(db, res, nome, quem) {
  const regra = LIMITES[nome];
  if (!regra) throw new Error('limite desconhecido: ' + nome);
  const [max, janela] = regra;
  let permitido = true;
  try {
    const r = await db.rpc('consumir_limite', { p_chave: (nome + ':' + String(quem || '?')).slice(0, 200), p_max: max, p_janela_seg: janela });
    permitido = r !== false;
  } catch (e) {
    if (!avisouSemFuncao) { registrarErro('limite', e); avisouSemFuncao = true; }
    return true;
  }
  if (permitido) return true;
  const minutos = Math.max(1, Math.ceil(janela / 60));
  res.setHeader('Retry-After', String(janela));
  json(res, 429, {
    ok: false,
    codigo: 'limite',
    erro: 'Muitas tentativas em pouco tempo. Aguarde ' + (minutos === 1 ? '1 minuto' : 'até ' + minutos + ' minutos') + ' e tente de novo.'
  });
  return false;
}
