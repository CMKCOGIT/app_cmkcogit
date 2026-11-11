// Login único entre app.cmkcogit.com.br e mvp.cmkcogit.com.br SEM cookie compartilhado.
// Cada site guarda a própria sessão só no próprio endereço (nenhum outro subdomínio, como um site
// de cliente em xxx.cmkcogit.com.br, recebe ou lê a sessão). Para "entrar direto", um site pede
// aqui um código de uso único para o usuário JÁ logado e manda a pessoa para o outro site, que troca
// o código por uma sessão própria:
//
//   POST /api/sso { para: 'mvp' | 'app', volta: '/caminho' }   (Authorization: Bearer <sessão atual>)
//   -> { url: '<site de destino>/sso.html#token_hash=...&volta=/caminho' }
//
// - O destino sai SÓ do ambiente (APP_URL / MVP_URL): não há como mandar o código para outro site.
// - O código vai no fragmento (#): não chega a servidor nenhum nem ao Referer, vale uma vez e expira.
// - "volta" é só um caminho deste site (nada de domínio); qualquer outra coisa vira "/".
// - Sem cookie, não há CSRF: a chamada exige o token no cabeçalho.
import { criarDb } from './supabase.js';
import { json, erro, lerCorpo, exigirUsuario, registrarErro, urlApp } from './http.js';
import { aplicarCors } from './cors.js';
import { dentroDoLimite } from './limite.js';

export function urlMvp(env = process.env) {
  if (env.MVP_URL) return String(env.MVP_URL).replace(/\/+$/, '');
  return urlApp(env) === 'https://app.cmkcogit.com.br' ? 'https://mvp.cmkcogit.com.br' : '';
}

export function destinosSso(env = process.env) {
  return { app: urlApp(env), mvp: urlMvp(env) };
}

export const caminhoSeguro = (v) => (typeof v === 'string' && /^\/(?!\/)[\w./%-]*(\?[\w=&%.-]*)?(#[\w-]*)?$/.test(v) && v.length <= 300 ? v : '/');

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return;
  if (req.method !== 'POST') return erro(res, 405, 'Método não permitido.');
  let db;
  try { db = criarDb(); } catch (e) { registrarErro('sso:config', e); return erro(res, 500, 'Indisponível no momento.'); }
  const usuario = await exigirUsuario(req, res, db);
  if (!usuario) return;
  let corpo;
  try { corpo = (await lerCorpo(req, 2000)) || {}; } catch { return erro(res, 400, 'Requisição inválida.'); }
  const base = Object.hasOwn(destinosSso(), corpo.para) ? destinosSso()[corpo.para] : null;
  if (!base || !/^(https:\/\/[a-z0-9.-]+|http:\/\/localhost(:\d+)?)$/i.test(base)) return erro(res, 400, 'Destino inválido.');
  if (!usuario.email) return erro(res, 400, 'Conta sem e-mail.');
  if (!(await dentroDoLimite(db, usuario.id, 'sso'))) return json(res, 429, { ok: false, codigo: 'limite', erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  try {
    const token = await db.gerarLinkMagico(usuario.email);
    return json(res, 200, { ok: true, url: base + '/sso.html#token_hash=' + encodeURIComponent(token) + '&volta=' + encodeURIComponent(caminhoSeguro(corpo.volta)) });
  } catch (e) {
    registrarErro('sso', e);
    return erro(res, 502, 'Não foi possível entrar automaticamente agora. Entre com e-mail e senha.');
  }
}
