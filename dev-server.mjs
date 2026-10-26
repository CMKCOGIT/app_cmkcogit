// Servidor local que imita a Vercel: arquivos de /public + funções de /api.
// Uso:  npm run dev   (ou: node dev-server.mjs)   ->  http://localhost:3000
// Lê as variáveis de .env.local (copie de .env.example). Não precisa de npm install.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const publico = path.join(raiz, 'public');

// ---- variáveis de ambiente (.env.local tem prioridade sobre .env) ----
// Aceita .env.local ou .env; ignora valores vazios (assim um .env.local copiado do
// exemplo e ainda em branco não "apaga" o que está preenchido no .env).
const arquivosEnv = [];
for (const nome of ['.env.local', '.env']) {
  const arquivo = path.join(raiz, nome);
  if (!fs.existsSync(arquivo)) continue;
  arquivosEnv.push(nome);
  const texto = fs.readFileSync(arquivo, 'utf8').replace(/^﻿/, ''); // BOM do Bloco de Notas
  for (const linha of texto.split(/\r?\n/)) {
    if (linha.trim().startsWith('#')) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linha);
    if (!m) continue;
    let valor = m[2];
    if (/^(['"]).*\1$/.test(valor)) valor = valor.slice(1, -1);
    if (/SEU-PROJETO|SEU@EMAIL/i.test(valor)) valor = ''; // texto de exemplo não conta
    if (valor && !process.env[m[1]]) process.env[m[1]] = valor;
  }
}
for (const errado of ['.env.local.txt', '.env.txt', 'env.local', '.env.example.local']) {
  if (fs.existsSync(path.join(raiz, errado))) {
    console.log('  Atenção: existe um arquivo "' + errado + '". O nome certo é ".env.local" (sem .txt, com ponto no começo).');
  }
}
const PORTA = Number(process.env.PORT || 3000);
if (!process.env.APP_URL) process.env.APP_URL = 'http://localhost:' + PORTA;

// ---- mesmos cabeçalhos de segurança do vercel.json ----
const vercel = JSON.parse(fs.readFileSync(path.join(raiz, 'vercel.json'), 'utf8'));
const cabecalhos = (vercel.headers || []).filter((h) => h.source === '/(.*)').flatMap((h) => h.headers);
const reescritas = vercel.rewrites || [];

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

const funcoes = new Map();
async function carregarFuncao(nome) {
  if (!funcoes.has(nome)) {
    const arquivo = path.join(raiz, 'api', nome + '.js');
    if (!fs.existsSync(arquivo)) return null;
    funcoes.set(nome, (await import(pathToFileURL(arquivo).href)).default);
  }
  return funcoes.get(nome);
}

const servidor = http.createServer(async (req, res) => {
  for (const h of cabecalhos) res.setHeader(h.key, h.value);
  let { pathname } = new URL(req.url, 'http://localhost');
  const inicio = Date.now();
  res.on('finish', () => {
    if (pathname.startsWith('/api/')) console.log(req.method, pathname, res.statusCode, (Date.now() - inicio) + 'ms');
  });

  const r = reescritas.find((x) => x.source === pathname);
  if (r) pathname = r.destination;

  try {
    // ---- funções /api/<nome> ----
    const api = /^\/api\/([a-z0-9-]+)\/?$/.exec(pathname);
    if (api) {
      const fn = await carregarFuncao(api[1]);
      if (!fn) { res.statusCode = 404; return res.end('Função não encontrada'); }
      req.query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
      return await fn(req, res);
    }

    // ---- arquivos estáticos de /public ----
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const arquivo = path.normalize(path.join(publico, rel));
    if (!arquivo.startsWith(publico + path.sep)) { res.statusCode = 403; return res.end('Proibido'); }
    if (!fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const p404 = path.join(publico, '404.html');
      return res.end(fs.existsSync(p404) ? fs.readFileSync(p404) : 'Não encontrado');
    }
    res.setHeader('Content-Type', TIPOS[path.extname(arquivo)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(arquivo).pipe(res);
  } catch (e) {
    console.error('Erro em', pathname, e);
    if (!res.headersSent) { res.statusCode = 500; res.end('Erro interno'); }
  }
});

servidor.listen(PORTA, () => {
  const falta = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'MP_ACCESS_TOKEN'].filter((k) => !process.env[k]);
  console.log('\n  CMK COGIT app rodando em http://localhost:' + PORTA + '\n');
  console.log('  Pasta: ' + raiz);
  console.log('  Arquivo de variáveis lido: ' + (arquivosEnv.length ? arquivosEnv.join(' + ') : 'NENHUM (crie .env.local nesta pasta)'));
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'MP_ACCESS_TOKEN']) {
    console.log('    ' + (process.env[k] ? 'OK     ' : 'FALTA  ') + k);
  }
  console.log('');
  if (falta.length) console.log('  Atenção: preencha as variáveis que faltam e reinicie (Ctrl+C e npm run dev).\n');
  if (!process.env.PUBLIC_URL) console.log('  Sem PUBLIC_URL: o webhook não chega aqui; a confirmação usa o botão/volta do checkout.\n');
});
