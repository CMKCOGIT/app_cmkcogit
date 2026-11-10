-- =====================================================================
-- 29_jornada_mvp.sql — Jornada MVP (ferramenta em teste).
-- Rode depois do 28. Pode rodar mais de uma vez. Só cria tabelas novas: não mexe em nada que já existe.
--   jornadas ............ uma por cliente: o produto/ideia que ele está estruturando
--   jornada_modulos ..... respostas de cada módulo da trilha + revisão da equipe
--                         (aberto -> enviado -> aprovado, ou ajustes -> enviado ...)
--   jornada_orcamentos .. cada orçamento do MVP gerado (vale o mais recente)
-- A trilha (módulos, perguntas) e os parâmetros de preço ficam no código: lib/jornada.js.
-- Leitura: o cliente vê o que é dele; o admin vê tudo. Escrita: só o servidor (lib/jornada-rota.js),
-- por isso não há política de insert/update/delete.
-- =====================================================================

create table if not exists public.jornadas (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.profiles(id) on delete cascade,
  titulo     text not null,
  status     text not null default 'em_andamento',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jornadas_status_check check (status in ('em_andamento', 'concluida')),
  constraint jornadas_titulo_check check (char_length(btrim(titulo)) between 2 and 80)
);
create unique index if not exists uq_jornadas_cliente on public.jornadas(cliente_id);

create table if not exists public.jornada_modulos (
  id           uuid primary key default gen_random_uuid(),
  jornada_id   uuid not null references public.jornadas(id) on delete cascade,
  modulo       text not null,
  respostas    jsonb not null default '{}'::jsonb,
  status       text not null default 'aberto',
  comentario   text,
  enviado_em   timestamptz,
  avaliado_em  timestamptz,
  avaliado_por uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint jornada_modulos_status_check check (status in ('aberto', 'enviado', 'ajustes', 'aprovado')),
  constraint jornada_modulos_modulo_check check (modulo ~ '^[a-z0-9-]{1,60}$')
);
create unique index if not exists uq_jornada_modulo on public.jornada_modulos(jornada_id, modulo);

create table if not exists public.jornada_orcamentos (
  id         uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references public.jornadas(id) on delete cascade,
  dados      jsonb not null,
  valor_min  numeric(12,2) not null,
  valor_max  numeric(12,2) not null,
  horas      int not null default 0,
  gerado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_jornada_orcamentos on public.jornada_orcamentos(jornada_id, created_at desc);

alter table public.jornadas enable row level security;
alter table public.jornada_modulos enable row level security;
alter table public.jornada_orcamentos enable row level security;

drop policy if exists "jornadas_select" on public.jornadas;
create policy "jornadas_select" on public.jornadas
  for select using (cliente_id = auth.uid() or public.is_admin());

drop policy if exists "jornada_modulos_select" on public.jornada_modulos;
create policy "jornada_modulos_select" on public.jornada_modulos
  for select using (exists (select 1 from public.jornadas j where j.id = jornada_id and (j.cliente_id = auth.uid() or public.is_admin())));

drop policy if exists "jornada_orcamentos_select" on public.jornada_orcamentos;
create policy "jornada_orcamentos_select" on public.jornada_orcamentos
  for select using (exists (select 1 from public.jornadas j where j.id = jornada_id and (j.cliente_id = auth.uid() or public.is_admin())));

revoke insert, update, delete on public.jornadas, public.jornada_modulos, public.jornada_orcamentos from anon, authenticated;

-- Conferir
select 'jornadas' as tabela, count(*) from public.jornadas
union all select 'jornada_modulos', count(*) from public.jornada_modulos
union all select 'jornada_orcamentos', count(*) from public.jornada_orcamentos;
