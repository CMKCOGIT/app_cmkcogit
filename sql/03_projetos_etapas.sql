-- =====================================================================
-- 03_projetos_etapas.sql — projetos (o que o cliente comprou) e as 8 etapas
-- da metodologia. Mesma estrutura do seu SQL original (status_projeto,
-- etapa_atual, dominio...) + ligação com a solicitação vinda do site.
-- Pode rodar mais de uma vez.
-- =====================================================================

create sequence if not exists public.seq_codigo_projeto start 100;

create table if not exists public.projetos (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references public.profiles(id) on delete cascade,
  codigo            text unique,
  nome              text not null,
  tipo              text not null default 'institucional',
  dominio           text,
  etapa_atual       int  not null default 1,
  status_projeto    text not null default 'em_andamento',
  status_pagamento  text not null default 'pendente',
  valor_total       numeric(12,2) not null default 0,
  previsao_entrega  date,
  created_at        timestamptz not null default now()
);

alter table public.projetos add column if not exists dominio          text;
alter table public.projetos add column if not exists etapa_atual      int not null default 1;
alter table public.projetos add column if not exists status_projeto   text not null default 'em_andamento';
alter table public.projetos add column if not exists previsao_entrega date;
alter table public.projetos add column if not exists solicitacao_id   uuid;   -- FK no 06
alter table public.projetos add column if not exists updated_at       timestamptz not null default now();

-- tipos novos (loja, automação, consultoria, identidade) e status "reembolsado"
alter table public.projetos drop constraint if exists projetos_tipo_check;
alter table public.projetos add constraint projetos_tipo_check
  check (tipo in ('portfolio','landing_page','institucional','loja','saas','sistema','automacao','consultoria','identidade','outro'));
alter table public.projetos drop constraint if exists projetos_status_projeto_check;
alter table public.projetos add constraint projetos_status_projeto_check
  check (status_projeto in ('em_andamento','aguardando_cliente','concluido','pausado','cancelado'));
alter table public.projetos drop constraint if exists projetos_status_pagamento_check;
alter table public.projetos add constraint projetos_status_pagamento_check
  check (status_pagamento in ('pendente','parcial','pago','atrasado','reembolsado'));
alter table public.projetos drop constraint if exists projetos_etapa_atual_check;
alter table public.projetos add constraint projetos_etapa_atual_check check (etapa_atual between 1 and 8);

create index if not exists idx_projetos_cliente on public.projetos(cliente_id);

drop trigger if exists trg_touch_projetos on public.projetos;
create trigger trg_touch_projetos before update on public.projetos
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- ETAPAS (8 por projeto, criadas automaticamente)
-- ---------------------------------------------------------------------
create table if not exists public.projeto_etapas (
  id              uuid primary key default gen_random_uuid(),
  projeto_id      uuid not null references public.projetos(id) on delete cascade,
  ordem           int  not null check (ordem between 1 and 8),
  nome            text not null,
  status          text not null default 'pendente' check (status in ('pendente','em_andamento','concluida')),
  data_prevista   date,
  data_concluida  date,
  unique (projeto_id, ordem)
);

create or replace function public.criar_etapas_padrao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.projeto_etapas (projeto_id, ordem, nome, status) values
    (new.id, 1, 'Projeto Confirmado', 'em_andamento'),
    (new.id, 2, 'Preparação',         'pendente'),
    (new.id, 3, 'Estratégia',         'pendente'),
    (new.id, 4, 'Design',             'pendente'),
    (new.id, 5, 'Sua Aprovação',      'pendente'),
    (new.id, 6, 'Construção',         'pendente'),
    (new.id, 7, 'Revisão Final',      'pendente'),
    (new.id, 8, 'Publicado',          'pendente')
  on conflict (projeto_id, ordem) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_criar_etapas on public.projetos;
create trigger trg_criar_etapas
  after insert on public.projetos
  for each row execute function public.criar_etapas_padrao();

-- ---------------------------------------------------------------------
-- Segurança: cliente vê só os dele; admin vê e edita tudo
-- ---------------------------------------------------------------------
alter table public.projetos       enable row level security;
alter table public.projeto_etapas enable row level security;

drop policy if exists "projetos_select" on public.projetos;
create policy "projetos_select" on public.projetos
  for select using (cliente_id = auth.uid() or public.is_admin());

drop policy if exists "projetos_admin_all" on public.projetos;
create policy "projetos_admin_all" on public.projetos
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "etapas_select" on public.projeto_etapas;
create policy "etapas_select" on public.projeto_etapas
  for select using (
    public.is_admin() or exists (
      select 1 from public.projetos p where p.id = projeto_etapas.projeto_id and p.cliente_id = auth.uid()
    )
  );

drop policy if exists "etapas_admin_all" on public.projeto_etapas;
create policy "etapas_admin_all" on public.projeto_etapas
  for all using (public.is_admin()) with check (public.is_admin());
