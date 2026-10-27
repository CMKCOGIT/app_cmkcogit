-- =====================================================================
-- 12_cadastro_google.sql — login com Google e "cadastro concluído"
--
-- Rode DEPOIS do 01..11 e ANTES de publicar a versão do app com o botão
-- "Continuar com Google". Pode rodar mais de uma vez.
--
-- O que faz:
--   1. profiles ganha aceite_termos_em e cadastro_concluido_em.
--   2. Contas que JÁ existiam (cadastro por e-mail e admins) são marcadas
--      como concluídas UMA vez — ninguém antigo fica bloqueado.
--   3. O cadastro automático (trigger) passa a usar o nome vindo do Google e
--      só marca "concluído" quem preencheu o formulário de e-mail (nome + aceite).
--   4. garantir_perfil(): cria o perfil de quem está logado e não tem perfil.
--   5. concluir_cadastro(): valida e salva os dados obrigatórios e só então
--      grava cadastro_concluido_em. O cliente não consegue marcar isso sozinho.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 e 2. Colunas + marcação única das contas existentes
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists aceite_termos_em timestamptz;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'cadastro_concluido_em'
  ) then
    alter table public.profiles add column cadastro_concluido_em timestamptz;

    -- Só na primeira vez (quando a coluna nasce). Quem se cadastrou pelo formulário
    -- de e-mail (ou é admin) já passou pelo cadastro atual. Contas só-Google criadas
    -- antes deste script ficam pendentes e vão para "Concluir cadastro".
    update public.profiles p
       set cadastro_concluido_em = p.created_at
     where p.role = 'admin'
        or exists (select 1 from auth.identities i where i.user_id = p.id and i.provider = 'email');
  end if;
end $$;

-- aceite já registrado no cadastro por e-mail (ficava só nos metadados do Auth)
update public.profiles p
   set aceite_termos_em = (u.raw_user_meta_data->>'aceite_termos_em')::timestamptz
  from auth.users u
 where u.id = p.id
   and p.aceite_termos_em is null
   and u.raw_user_meta_data->>'aceite_termos_em' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$';

-- ---------------------------------------------------------------------
-- 3. Cadastro automático (substitui a versão do 01_base.sql)
-- ---------------------------------------------------------------------
-- Nome inicial: o do formulário ("nome"); no Google, full_name/name; senão o início do e-mail.
create or replace function public.nome_inicial(meta jsonb, email text)
returns text
language sql
immutable
as $$
  select left(coalesce(
    nullif(trim(meta->>'nome'), ''),
    nullif(trim(meta->>'full_name'), ''),
    nullif(trim(meta->>'name'), ''),
    split_part(coalesce(email, ''), '@', 1)
  ), 120);
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- "nome" e "aceite_termos_em" só vêm do formulário de e-mail do app (o Google não manda)
  v_nome_form text := nullif(trim(new.raw_user_meta_data->>'nome'), '');
  v_aceite    timestamptz := case when nullif(trim(new.raw_user_meta_data->>'aceite_termos_em'), '') is not null then now() end;
begin
  insert into public.profiles (id, email, nome, telefone, aceite_termos_em, cadastro_concluido_em)
  values (
    new.id,
    new.email,
    public.nome_inicial(new.raw_user_meta_data, new.email),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'telefone', ''), '\D', '', 'g'), ''),
    v_aceite,
    case when v_aceite is not null and char_length(coalesce(v_nome_form, '')) >= 2 then now() end
  )
  on conflict (id) do nothing;   -- a mesma pessoa nunca ganha dois perfis
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- O cliente continua podendo alterar só nome e telefone (aceite/conclusão só pela função abaixo)
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (nome, telefone) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 4. garantir_perfil(): logado sem perfil (ex.: trigger falhou) -> cria
-- ---------------------------------------------------------------------
create or replace function public.garantir_perfil()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Faça login para continuar'; end if;
  insert into public.profiles (id, email, nome)
  select u.id, u.email, public.nome_inicial(u.raw_user_meta_data, u.email)
    from auth.users u
   where u.id = auth.uid()
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.garantir_perfil() from public, anon;
grant execute on function public.garantir_perfil() to authenticated;

-- ---------------------------------------------------------------------
-- 5. concluir_cadastro(): obrigatórios = nome e aceite dos termos
--    (os mesmos do formulário de e-mail; WhatsApp continua opcional)
-- ---------------------------------------------------------------------
create or replace function public.concluir_cadastro(
  p_nome     text,
  p_telefone text    default null,
  p_aceite   boolean default false
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome  text := trim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_fone  text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_perfil public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Sua sessão expirou. Entre novamente.'; end if;
  if char_length(v_nome) < 2 or char_length(v_nome) > 120 then raise exception 'Informe seu nome (de 2 a 120 caracteres).'; end if;
  if v_fone <> '' and v_fone !~ '^\d{10,11}$' then raise exception 'WhatsApp com DDD: 10 ou 11 números.'; end if;

  perform public.garantir_perfil();
  select * into v_perfil from public.profiles where id = auth.uid() for update;

  if v_perfil.aceite_termos_em is null and not coalesce(p_aceite, false) then
    raise exception 'Para continuar, aceite os Termos de Uso e a Política de Privacidade.';
  end if;

  -- tudo numa só atualização: ou salva tudo e conclui, ou não salva nada
  update public.profiles set
    nome                  = v_nome,
    telefone              = nullif(v_fone, ''),
    aceite_termos_em      = coalesce(aceite_termos_em, now()),
    cadastro_concluido_em = coalesce(cadastro_concluido_em, now())
  where id = auth.uid()
  returning cadastro_concluido_em into v_perfil.cadastro_concluido_em;

  return v_perfil.cadastro_concluido_em;
end;
$$;

revoke all on function public.concluir_cadastro(text, text, boolean) from public, anon;
grant execute on function public.concluir_cadastro(text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Conferir: quantos perfis concluídos e pendentes
-- ---------------------------------------------------------------------
select (cadastro_concluido_em is not null) as concluido, count(*) from public.profiles group by 1;
