// Testa o banco de verdade (RLS, funções, gatilhos) num Postgres LOCAL descartável.
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:sql
// Cria o banco cogit_teste_<n>, aplica tests/sql/supabase-stub.sql (imitação mínima do Supabase),
// roda os sql/ na ordem do README e depois cada tests/sql/*.test.sql. Qualquer falha = saída 1.
// Sem TEST_DATABASE_URL (ou sem psql), avisa e sai com 0: não roda no `npm test` comum.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.TEST_DATABASE_URL;
if (!url) { console.log('test:sql pulado: defina TEST_DATABASE_URL (Postgres local, nunca o do Supabase).'); process.exit(0); }
if (/supabase\.(co|com)/i.test(url)) { console.error('TEST_DATABASE_URL aponta para o Supabase. Use um Postgres local.'); process.exit(1); }

// ordem do README (o 00, 10, 14, 16 e 23 são opcionais/dados; tudo_01_a_09 repete o 01..09)
const ORDEM = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '11', '12', '13', '15', '17', '18', '19', '20', '21', '22', '24', '25', '26', '27', '28', '29', '30', '31', '32'];
const sqlDir = path.join(raiz, 'sql');
const arquivos = ORDEM.map((n) => readdirSync(sqlDir).find((f) => f.startsWith(n + '_'))).filter(Boolean);
const testes = readdirSync(path.join(raiz, 'tests/sql')).filter((f) => f.endsWith('.test.sql')).sort();

const banco = 'cogit_teste_' + process.pid;
const u = new URL(url);
const urlTeste = new URL(url); urlTeste.pathname = '/' + banco;
const psql = (alvo, args) => execFileSync('psql', [alvo.toString(), '-v', 'ON_ERROR_STOP=1', '-q', '-X', ...args], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });

let falhou = false;
try {
  psql(u, ['-c', 'create database ' + banco]);
  psql(urlTeste, ['-f', path.join(raiz, 'tests/sql/supabase-stub.sql')]);
  for (const f of arquivos) {
    try { psql(urlTeste, ['-f', path.join(sqlDir, f)]); }
    catch (e) { console.error('✗ sql/' + f + '\n' + (e.stderr || e.message)); e.mostrado = true; throw e; }
  }
  console.log('✓ ' + arquivos.length + ' arquivos de sql/ aplicados (o último duas vezes: idempotente)');
  psql(urlTeste, ['-f', path.join(sqlDir, arquivos[arquivos.length - 1])]);
  for (const t of testes) {
    try {
      const saida = psql(urlTeste, ['-t', '-A', '-f', path.join(raiz, 'tests/sql', t)]);
      const fim = saida.split('\n').filter((l) => /^ok:/.test(l)).pop();
      console.log('✓ ' + t + (fim ? ' — ' + fim.slice(3).trim() : ''));
    } catch (e) {
      falhou = true;
      console.error('✗ ' + t + '\n' + (e.stderr || e.message));
    }
  }
} catch (e) {
  falhou = true;
  if (!e.mostrado) console.error(e.stderr || e.message);
} finally {
  try { psql(u, ['-c', 'drop database if exists ' + banco + ' with (force)']); } catch (_) { /* ignora */ }
}
process.exit(falhou ? 1 : 0);
