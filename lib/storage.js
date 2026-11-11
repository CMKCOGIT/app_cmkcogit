// Supabase Storage pelo REST (service_role, só no servidor). Bucket privado: o cliente
// nunca acessa direto; recebe uma URL assinada de poucos minutos depois de o servidor conferir o dono.
export function criarStorage(env = process.env, fetchFn = fetch) {
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const chave = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const cab = { apikey: chave, Authorization: 'Bearer ' + chave };
  const caminho = (p) => String(p).split('/').map(encodeURIComponent).join('/');

  return {
    async enviar(bucket, path, bytes, tipo = 'application/pdf') {
      const r = await fetchFn(base + '/storage/v1/object/' + bucket + '/' + caminho(path), {
        method: 'POST', headers: { ...cab, 'Content-Type': tipo, 'x-upsert': 'true', 'Cache-Control': 'no-store' }, body: bytes
      });
      if (!r.ok) throw new Error('Storage recusou o envio (' + r.status + ')');
      return path;
    },
    async urlAssinada(bucket, path, segundos = 600, nomeArquivo = null) {
      const r = await fetchFn(base + '/storage/v1/object/sign/' + bucket + '/' + caminho(path), {
        method: 'POST', headers: { ...cab, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: segundos })
      });
      const d = await r.json().catch(() => ({}));
      const rel = d.signedURL || d.signedUrl;
      if (!r.ok || !rel) throw new Error('Storage não assinou o link (' + r.status + ')');
      const url = base + '/storage/v1' + (rel.startsWith('/') ? rel : '/' + rel);
      return nomeArquivo ? url + '&download=' + encodeURIComponent(nomeArquivo) : url;
    }
  };
}
