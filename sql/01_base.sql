-- =====================================================================
-- 01_base.sql — perfis de usuário, papel (cliente/admin) e função is_admin()
-- Supabase > SQL Editor > New query > cole > Run. Pode rodar mais de uma vez.
-- =====================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------
-- PERFIS (1 por usuário do Supabase Auth)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text,
  email       text,
  telefone    text,
  role        text not null default 'cliente',
  created_at  timestamptz not null default now()
);

alter table public.profiles add column if not exists nome       text;
alter table public.profiles add column if not exists email      text;
alter table public.profiles add column if not exists telefone   text;
alter table public.profiles add column if not exists role       text not null default 'cliente';
alter table public.profiles add column if not exists created_at timestamptz not null default now();

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('cliente','admin'));

-- ---------------------------------------------------------------------
-- is_admin(): usada pelas regras de segurança (RLS) de todas as tabelas
-- security definer = lê profiles sem cair em recursão de RLS
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Cria o perfil automaticamente quando alguém se cadastra no app.
-- O "role" NUNCA vem do cadastro (ninguém vira admin por metadado).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nome, telefone)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data->>'nome'), ''), split_part(new.email, '@', 1)),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'telefone', ''), '\D', '', 'g'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- perfis de usuários que já existiam antes deste script
insert into public.profiles (id, email, nome)
select u.id, u.email, coalesce(nullif(trim(u.raw_user_meta_data->>'nome'), ''), split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Segurança: cada um vê o próprio perfil; admin vê todos.
-- O cliente só pode alterar nome e telefone (nunca o role).
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;      -- versão antiga (substituída abaixo)
drop policy if exists "profiles_update_proprio" on public.profiles;
create policy "profiles_update_proprio" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (nome, telefone) on public.profiles to authenticated;

-- trigger genérico de updated_at (usado pelas outras tabelas)
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
