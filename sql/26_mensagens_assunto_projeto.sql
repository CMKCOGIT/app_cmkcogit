-- =====================================================================
-- 26_mensagens_assunto_projeto.sql — rode depois do 25. Pode rodar mais de uma vez.
--   Cada mensagem pode dizer SOBRE O QUE é: um projeto do cliente e/ou um assunto
--   (dúvida, prazo, alteração, material, pagamento, outro). Aparece como etiqueta na
--   mensagem, no aviso do sino e no contexto da IA.
-- =====================================================================

alter table public.mensagens add column if not exists projeto_id uuid references public.projetos(id) on delete set null;
alter table public.mensagens add column if not exists assunto text;

alter table public.mensagens drop constraint if exists mensagens_assunto_check;
alter table public.mensagens add constraint mensagens_assunto_check
  check (assunto is null or assunto in ('duvida', 'prazo', 'alteracao', 'material', 'pagamento', 'outro'));

create index if not exists idx_mensagens_projeto on public.mensagens(projeto_id) where projeto_id is not null;

-- o projeto precisa ser do cliente dessa conversa (conversa da equipe não tem projeto)
create or replace function public.projeto_da_conversa(p_conversa uuid, p_projeto uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_projeto is null or exists (
    select 1 from public.conversas c join public.projetos p on p.cliente_id = c.cliente_id
     where c.id = p_conversa and c.tipo = 'cliente' and p.id = p_projeto
  );
$$;
revoke all on function public.projeto_da_conversa(uuid, uuid) from public, anon;
grant execute on function public.projeto_da_conversa(uuid, uuid) to authenticated;

drop policy if exists "mensagens_insert" on public.mensagens;
create policy "mensagens_insert" on public.mensagens for insert with check (
  autor_id = auth.uid()
  and public.pode_ver_conversa(conversa_id)
  and public.projeto_da_conversa(conversa_id, projeto_id)
  and (not interna or (public.is_admin() and exists (
        select 1 from public.conversas c where c.id = conversa_id and c.tipo = 'cliente')))
  and (anexo_path is null or (
        split_part(anexo_path, '/', 1) = conversa_id::text
        and split_part(anexo_path, '/', 2) = case when interna then 'interno' else 'publico' end))
);

grant insert (projeto_id, assunto) on public.mensagens to authenticated;

-- aviso do sino com o assunto/projeto na frente: "[Prazo · COG-2026-100] Quando fica pronto?"
create or replace function public.notificar_mensagem()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv    public.conversas%rowtype;
  v_previa  text;
  v_titulo  text;
  v_dest    uuid;
  v_ctx     text;
  v_link    text := 'mensagens.html?c=' || new.conversa_id;
begin
  if new.interna then return new; end if;
  select * into v_conv from public.conversas where id = new.conversa_id;
  v_previa := case new.tipo
    when 'audio'   then 'Mensagem de áudio'
    when 'arquivo' then 'Arquivo: ' || coalesce(new.anexo_nome, 'anexo')
    else left(regexp_replace(new.corpo, '\s+', ' ', 'g'), 140) end;
  select nullif(concat_ws(' · ',
           case new.assunto when 'duvida' then 'Dúvida' when 'prazo' then 'Prazo' when 'alteracao' then 'Alteração'
                            when 'material' then 'Material' when 'pagamento' then 'Pagamento' when 'outro' then 'Outro' end,
           (select coalesce(p.codigo, p.nome) from public.projetos p where p.id = new.projeto_id)), '')
    into v_ctx;
  if v_ctx is not null then v_previa := '[' || v_ctx || '] ' || v_previa; end if;

  for v_dest in
    select d from (
      select v_conv.cliente_id as d where v_conv.tipo = 'cliente' and new.autor_papel = 'admin'
      union
      select p.id from public.profiles p
       where p.role = 'admin'
         and ((v_conv.tipo = 'cliente' and new.autor_papel <> 'admin')
              or (v_conv.tipo = 'equipe' and (v_conv.membros is null or p.id = any (v_conv.membros))))
    ) x
    where d is not null and d is distinct from new.autor_id
  loop
    v_titulo := case
      when v_conv.tipo = 'cliente' and new.autor_papel = 'admin' then 'Nova mensagem da equipe CMKCOGIT'
      when v_conv.tipo = 'equipe' and v_conv.membros is null then new.autor_nome || ' no grupo da equipe'
      else 'Nova mensagem de ' || new.autor_nome end;
    update public.notificacoes
       set titulo = v_titulo, mensagem = v_previa, created_at = now(), projeto_id = coalesce(new.projeto_id, projeto_id)
     where usuario_id = v_dest and tipo = 'mensagem' and not lida
       and metadados->>'conversa_id' = new.conversa_id::text;
    if not found then
      insert into public.notificacoes (usuario_id, projeto_id, tipo, titulo, mensagem, link, metadados)
      values (v_dest, new.projeto_id, 'mensagem', v_titulo, v_previa, v_link, jsonb_build_object('conversa_id', new.conversa_id));
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.notificar_mensagem() from public, anon, authenticated;
