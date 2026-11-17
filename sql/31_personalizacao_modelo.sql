-- =====================================================================
-- 31 · Personalização de modelo pronto enviada pelo cliente
--
-- O cliente monta o site no editor do modelo (cmkcogit.com.br/templates/...) e clica em
-- "Enviar para a CMKCOGIT". A plataforma cria a solicitação (em validação) e grava o
-- arquivo no bucket privado "arquivos", em:
--     solicitacoes/<solicitacao_id>/personalizacao.json
-- O cliente só pode CRIAR esse arquivo, e só na pasta de uma solicitação dele.
-- Ler continua só para o admin (política "arquivos_storage_select" do 11).
-- Rode depois do 11. Pode rodar de novo sem problema.
-- =====================================================================

-- dono da solicitação da pasta (solicitacoes/<id>/...)
create or replace function public.dono_pasta_solicitacao(p_nome text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.cliente_id from public.solicitacoes s
   where (storage.foldername(p_nome))[1] = 'solicitacoes'
     and s.id::text = (storage.foldername(p_nome))[2];
$$;
revoke all on function public.dono_pasta_solicitacao(text) from public, anon;
grant execute on function public.dono_pasta_solicitacao(text) to authenticated;

drop policy if exists "personalizacao_storage_insert" on storage.objects;
create policy "personalizacao_storage_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'arquivos'
    and (storage.foldername(name))[1] = 'solicitacoes'
    and storage.filename(name) = 'personalizacao.json'
    and public.dono_pasta_solicitacao(name) = auth.uid()
  );
