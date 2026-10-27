-- =====================================================================
-- 11_repositorio_notificacoes_perfil.sql — rode DEPOIS do 01 → 09 (e do 10).
--   1. Repositório do projeto: a equipe e o cliente enviam arquivos
--      (código, entregas, documentação) pelo Supabase Storage, bucket "arquivos".
--   2. Notificações: avisos automáticos (etapa avançou, arquivo novo,
--      pendência criada...) mostrados no Início.
--   3. Perfil: o e-mail em profiles acompanha a troca de e-mail do login.
-- Pode rodar mais de uma vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. REPOSITÓRIO (tabela arquivos + Storage)
-- ---------------------------------------------------------------------
alter table public.arquivos add column if not exists origem      text not null default 'equipe';
alter table public.arquivos add column if not exists enviado_por uuid references public.profiles(id) on delete set null;
alter table public.arquivos add column if not exists descricao   text;
alter table public.arquivos add column if not exists tamanho     bigint;

alter table public.arquivos drop constraint if exists arquivos_origem_check;
alter table public.arquivos add constraint arquivos_origem_check check (origem in ('equipe', 'cliente'));

create index if not exists idx_arquivos_projeto on public.arquivos(projeto_id, created_at desc);

-- O cliente envia documentos para os próprios projetos (sempre como "cliente")
drop policy if exists "arquivos_insert_cliente" on public.arquivos;
create policy "arquivos_insert_cliente" on public.arquivos
  for insert with check (
    origem = 'cliente' and enviado_por = auth.uid() and exists (
      select 1 from public.projetos p where p.id = arquivos.projeto_id and p.cliente_id = auth.uid()
    )
  );

-- ...e pode apagar o que ele mesmo enviou
drop policy if exists "arquivos_delete_cliente" on public.arquivos;
create policy "arquivos_delete_cliente" on public.arquivos
  for delete using (origem = 'cliente' and enviado_por = auth.uid());

-- Bucket privado (até 50 MB por arquivo). Caminho: <projeto_id>/<equipe|cliente>/<arquivo>
insert into storage.buckets (id, name, public, file_size_limit)
values ('arquivos', 'arquivos', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- dono do projeto da pasta (primeiro nível do caminho)
create or replace function public.dono_pasta_projeto(p_nome text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.cliente_id from public.projetos p
   where p.id::text = (storage.foldername(p_nome))[1];
$$;
revoke all on function public.dono_pasta_projeto(text) from public, anon;
grant execute on function public.dono_pasta_projeto(text) to authenticated;

drop policy if exists "arquivos_storage_select" on storage.objects;
create policy "arquivos_storage_select" on storage.objects
  for select to authenticated using (
    bucket_id = 'arquivos' and (public.is_admin() or public.dono_pasta_projeto(name) = auth.uid())
  );

drop policy if exists "arquivos_storage_insert" on storage.objects;
create policy "arquivos_storage_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'arquivos' and (
      public.is_admin()
      or (public.dono_pasta_projeto(name) = auth.uid() and (storage.foldername(name))[2] = 'cliente')
    )
  );

drop policy if exists "arquivos_storage_delete" on storage.objects;
create policy "arquivos_storage_delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'arquivos' and (
      public.is_admin()
      or (owner_id = auth.uid()::text and (storage.foldername(name))[2] = 'cliente')
    )
  );

-- ---------------------------------------------------------------------
-- 2. NOTIFICAÇÕES
-- ---------------------------------------------------------------------
create table if not exists public.notificacoes (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.profiles(id) on delete cascade,
  projeto_id  uuid references public.projetos(id) on delete cascade,
  tipo        text not null default 'info',
  titulo      text not null,
  mensagem    text,
  link        text,
  lida        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notificacoes_usuario on public.notificacoes(usuario_id, created_at desc);

alter table public.notificacoes enable row level security;

drop policy if exists "notificacoes_select" on public.notificacoes;
create policy "notificacoes_select" on public.notificacoes
  for select using (usuario_id = auth.uid());

drop policy if exists "notificacoes_marcar_lida" on public.notificacoes;
create policy "notificacoes_marcar_lida" on public.notificacoes
  for update using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- só os triggers abaixo criam notificações; o usuário só marca como lida
revoke insert, update, delete on public.notificacoes from anon, authenticated;
grant update (lida) on public.notificacoes to authenticated;

create or replace function public.notificar(
  p_usuario uuid, p_projeto uuid, p_tipo text, p_titulo text, p_mensagem text, p_link text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notificacoes (usuario_id, projeto_id, tipo, titulo, mensagem, link)
  values (p_usuario, p_projeto, p_tipo, p_titulo, p_mensagem, p_link);
$$;
revoke all on function public.notificar(uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- Projeto criado / etapa avançou / status mudou
create or replace function public.notificar_projeto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link  text := 'projeto.html?id=' || new.id;
  v_etapa text;
begin
  if tg_op = 'INSERT' then
    perform public.notificar(new.cliente_id, new.id, 'projeto', 'Projeto iniciado: ' || new.nome,
      'Pagamento confirmado. Acompanhe as etapas e a previsão de entrega por aqui.', v_link);
    return new;
  end if;

  if new.status_projeto is distinct from old.status_projeto then
    perform public.notificar(new.cliente_id, new.id, 'status',
      case new.status_projeto
        when 'concluido'          then 'Projeto concluído: ' || new.nome
        when 'aguardando_cliente' then 'Precisamos de você: ' || new.nome
        when 'pausado'            then 'Projeto pausado: ' || new.nome
        when 'cancelado'          then 'Projeto cancelado: ' || new.nome
        else 'Projeto em andamento: ' || new.nome end,
      case new.status_projeto
        when 'concluido'          then 'Seu projeto foi publicado. Veja o endereço e os arquivos finais.'
        when 'aguardando_cliente' then 'A equipe aguarda uma decisão ou um material seu para continuar.'
        else null end,
      v_link);
  elsif new.etapa_atual is distinct from old.etapa_atual and new.status_projeto <> 'concluido' then
    select nome into v_etapa from public.projeto_etapas where projeto_id = new.id and ordem = new.etapa_atual;
    perform public.notificar(new.cliente_id, new.id, 'etapa',
      new.nome || ' avançou para a etapa ' || new.etapa_atual || ' de 8',
      'Etapa atual: ' || v_etapa || '.', v_link);
  end if;

  if new.previsao_entrega is distinct from old.previsao_entrega and new.previsao_entrega is not null
     and new.status_projeto not in ('concluido', 'cancelado') then
    perform public.notificar(new.cliente_id, new.id, 'prazo', 'Nova previsão de entrega: ' || new.nome,
      'Entrega prevista para ' || to_char(new.previsao_entrega, 'DD/MM/YYYY') || '.', v_link);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notificar_projeto on public.projetos;
create trigger trg_notificar_projeto
  after insert or update of etapa_atual, status_projeto, previsao_entrega on public.projetos
  for each row execute function public.notificar_projeto();

-- Pendência nova para o cliente decidir
create or replace function public.notificar_pendencia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid;
begin
  select cliente_id into v_cliente from public.projetos where id = new.projeto_id;
  perform public.notificar(v_cliente, new.projeto_id, 'pendencia', 'Aguardando sua decisão: ' || new.titulo,
    case when new.prazo is not null then 'Prazo: ' || to_char(new.prazo, 'DD/MM/YYYY') || '.' end,
    'projeto.html?id=' || new.projeto_id);
  return new;
end;
$$;

drop trigger if exists trg_notificar_pendencia on public.pendencias;
create trigger trg_notificar_pendencia
  after insert on public.pendencias
  for each row execute function public.notificar_pendencia();

-- Arquivo novo no repositório: da equipe avisa o cliente; do cliente avisa os admins
create or replace function public.notificar_arquivo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proj public.projetos%rowtype;
  v_link text := 'projeto.html?id=' || new.projeto_id || '#repositorio';
begin
  select * into v_proj from public.projetos where id = new.projeto_id;
  if new.origem = 'equipe' then
    perform public.notificar(v_proj.cliente_id, new.projeto_id, 'arquivo',
      'Arquivo novo no repositório: ' || new.nome, 'Projeto ' || v_proj.nome || '.', v_link);
  else
    insert into public.notificacoes (usuario_id, projeto_id, tipo, titulo, mensagem, link)
    select a.id, new.projeto_id, 'arquivo', 'Cliente enviou: ' || new.nome,
           'Projeto ' || coalesce(v_proj.codigo || ' · ', '') || v_proj.nome || '.', v_link
      from public.profiles a where a.role = 'admin';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notificar_arquivo on public.arquivos;
create trigger trg_notificar_arquivo
  after insert on public.arquivos
  for each row execute function public.notificar_arquivo();

-- Funcionalidade extra: pagamento confirmado e entrega
create or replace function public.notificar_funcionalidade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid;
  v_nome    text;
begin
  if new.status is not distinct from old.status or new.status not in ('paga', 'em_andamento', 'entregue') then
    return new;
  end if;
  select cliente_id into v_cliente from public.projetos where id = new.projeto_id;
  select nome into v_nome from public.funcionalidades where id = new.funcionalidade_id;
  perform public.notificar(v_cliente, new.projeto_id, 'funcionalidade',
    case new.status
      when 'paga'         then 'Pagamento confirmado: ' || v_nome
      when 'em_andamento' then 'Em desenvolvimento: ' || v_nome
      else 'Funcionalidade entregue: ' || v_nome end,
    null, 'projeto.html?id=' || new.projeto_id);
  return new;
end;
$$;

drop trigger if exists trg_notificar_funcionalidade on public.projeto_funcionalidades;
create trigger trg_notificar_funcionalidade
  after update of status on public.projeto_funcionalidades
  for each row execute function public.notificar_funcionalidade();

-- ---------------------------------------------------------------------
-- 3. PERFIL: e-mail confirmado no login atualiza o profiles
-- ---------------------------------------------------------------------
create or replace function public.sincronizar_email_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id and email is distinct from new.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_alterado on auth.users;
create trigger on_auth_user_email_alterado
  after update of email on auth.users
  for each row execute function public.sincronizar_email_perfil();
