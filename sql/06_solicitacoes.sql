-- =====================================================================
-- 06_solicitacoes.sql — o que o cliente montou no site (diagnóstico da
-- página inicial ou "Monte sua solução"), já ligado à conta dele.
--
--   preço fechado (ex.: modelo pronto)   -> aguardando_pagamento
--   sob medida / "a partir de"           -> em_validacao -> admin define valor -> aguardando_pagamento
--   pagamento aprovado                   -> paga (o projeto é criado com as 8 etapas)
--
-- Quem cria a linha é o servidor (api/solicitacoes.js), depois do login,
-- recalculando o preço pelo catálogo. Pode rodar mais de uma vez.
-- Se você rodou os rascunhos antigos (sql-separado), rode o 00 antes.
-- =====================================================================

create sequence if not exists public.seq_solicitacao start 1;

create table if not exists public.solicitacoes (
  id               uuid primary key default gen_random_uuid(),
  codigo           text unique not null
                   default ('PLN-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-' || lpad(nextval('public.seq_solicitacao')::text, 4, '0')),
  cliente_id       uuid not null references public.profiles(id) on delete cascade,
  ref_site         text not null,                 -- id aleatório gerado no site (evita duplicar ao recarregar)
  origem           text not null default 'configurador',
  selecao          jsonb not null,                -- objetivos, serviços, complementos (só ids)
  resumo           jsonb not null default '{}'::jsonb,  -- itens e valores calculados pelo servidor
  notas            text,                          -- contexto que o cliente escreveu no site
  estruturado      boolean not null default false,
  tipo_preco       text not null default 'custom',
  valor_calculado  numeric(12,2) not null default 0,
  valor_final      numeric(12,2),                 -- valor que será cobrado
  observacao_admin text,
  status           text not null default 'em_validacao',
  projeto_id       uuid references public.projetos(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint solicitacoes_ref_unica unique (cliente_id, ref_site)
);

alter table public.solicitacoes drop constraint if exists solicitacoes_origem_check;
alter table public.solicitacoes add constraint solicitacoes_origem_check
  check (origem in ('configurador','diagnostico'));
alter table public.solicitacoes drop constraint if exists solicitacoes_tipo_preco_check;
alter table public.solicitacoes add constraint solicitacoes_tipo_preco_check
  check (tipo_preco in ('fixed','from','free','custom'));
alter table public.solicitacoes drop constraint if exists solicitacoes_status_check;
alter table public.solicitacoes add constraint solicitacoes_status_check
  check (status in ('em_validacao','aguardando_pagamento','paga','cancelada'));

create index if not exists idx_solicitacoes_cliente on public.solicitacoes(cliente_id, created_at desc);
create index if not exists idx_solicitacoes_status  on public.solicitacoes(status);

drop trigger if exists trg_touch_solicitacoes on public.solicitacoes;
create trigger trg_touch_solicitacoes before update on public.solicitacoes
  for each row execute function public.touch_updated_at();

-- projeto -> solicitação de origem
alter table public.projetos drop constraint if exists projetos_solicitacao_fk;
alter table public.projetos add constraint projetos_solicitacao_fk
  foreign key (solicitacao_id) references public.solicitacoes(id) on delete set null;

alter table public.solicitacoes enable row level security;

drop policy if exists "solicitacoes_select" on public.solicitacoes;
create policy "solicitacoes_select" on public.solicitacoes
  for select using (cliente_id = auth.uid() or public.is_admin());

drop policy if exists "solicitacoes_admin_all" on public.solicitacoes;
create policy "solicitacoes_admin_all" on public.solicitacoes
  for all using (public.is_admin()) with check (public.is_admin());
-- cliente NÃO insere nem altera direto: criação pelo servidor, cancelamento pela função do 08.
