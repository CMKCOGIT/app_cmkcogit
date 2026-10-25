-- =====================================================================
-- 04_pendencias_arquivos.sql — o que o cliente precisa decidir/aprovar e
-- os arquivos do projeto. Igual ao seu SQL original. Pode rodar mais de uma vez.
-- =====================================================================

create table if not exists public.pendencias (
  id          uuid primary key default gen_random_uuid(),
  projeto_id  uuid not null references public.projetos(id) on delete cascade,
  titulo      text not null,
  descricao   text,
  prazo       timestamptz,
  resolvida   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.arquivos (
  id            uuid primary key default gen_random_uuid(),
  projeto_id    uuid not null references public.projetos(id) on delete cascade,
  nome          text not null,
  url           text,                 -- link externo OU
  storage_path  text,                 -- caminho no Supabase Storage (bucket "arquivos")
  created_at    timestamptz not null default now()
);

alter table public.pendencias enable row level security;
alter table public.arquivos   enable row level security;

drop policy if exists "pendencias_select" on public.pendencias;
create policy "pendencias_select" on public.pendencias
  for select using (
    public.is_admin() or exists (
      select 1 from public.projetos p where p.id = pendencias.projeto_id and p.cliente_id = auth.uid()
    )
  );

drop policy if exists "pendencias_admin_all" on public.pendencias;
create policy "pendencias_admin_all" on public.pendencias
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "arquivos_select" on public.arquivos;
create policy "arquivos_select" on public.arquivos
  for select using (
    public.is_admin() or exists (
      select 1 from public.projetos p where p.id = arquivos.projeto_id and p.cliente_id = auth.uid()
    )
  );

drop policy if exists "arquivos_admin_all" on public.arquivos;
create policy "arquivos_admin_all" on public.arquivos
  for all using (public.is_admin()) with check (public.is_admin());
