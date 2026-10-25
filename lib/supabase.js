// Cliente mínimo da API REST do Supabase para o SERVIDOR (sem dependências).
// Usa a service_role key, que ignora o RLS — por isso só roda dentro de /api,
// nunca no navegador. Toda checagem de "quem é o dono" é feita no código das rotas.

export class ErroSupabase extends Error {
  constructor(status, corpo) {
    super((corpo && (corpo.message || corpo.msg || corpo.error_description)) || 'Erro no Supabase (' + status + ')');
    this.status = status;
    this.code = corpo && corpo.code;
    this.corpo = corpo;
  }
}

export function criarDb(env = process.env) {
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const chave = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base || !chave) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configurados.');

  async function req(caminho, { method = 'GET', body, prefer } = {}) {
    const headers = { apikey: chave, Authorization: 'Bearer ' + chave, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const r = await fetch(base + caminho, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const texto = await r.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
    if (!r.ok) throw new ErroSupabase(r.status, dados);
    return dados;
  }

  return {
    // filtros no formato do PostgREST, ex.: { id: 'eq.123', select: '*' }
    select(tabela, filtros = {}) {
      return req('/rest/v1/' + tabela + '?' + new URLSearchParams(filtros));
    },
    async um(tabela, filtros = {}) {
      const linhas = await req('/rest/v1/' + tabela + '?' + new URLSearchParams({ ...filtros, limit: '1' }));
      return Array.isArray(linhas) && linhas.length ? linhas[0] : null;
    },
    async inserir(tabela, linha) {
      const r = await req('/rest/v1/' + tabela, { method: 'POST', body: linha, prefer: 'return=representation' });
      return Array.isArray(r) ? r[0] : r;
    },
    async atualizar(tabela, filtros, campos) {
      const r = await req('/rest/v1/' + tabela + '?' + new URLSearchParams(filtros), {
        method: 'PATCH', body: campos, prefer: 'return=representation'
      });
      return Array.isArray(r) ? r[0] || null : r;
    },
    rpc(funcao, args) {
      return req('/rest/v1/rpc/' + funcao, { method: 'POST', body: args });
    },
    // Valida o token de login enviado pelo navegador e devolve o usuário (ou null).
    async usuarioDoToken(jwt) {
      if (!jwt) return null;
      const r = await fetch(base + '/auth/v1/user', { headers: { apikey: chave, Authorization: 'Bearer ' + jwt } });
      if (!r.ok) return null;
      const u = await r.json().catch(() => null);
      return u && u.id ? u : null;
    }
  };
}
