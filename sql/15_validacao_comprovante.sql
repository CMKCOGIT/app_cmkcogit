-- =====================================================================
-- 15_validacao_comprovante.sql — rode DEPOIS do 13. Pode rodar mais de uma vez.
-- Modal de validação das solicitações (admin):
--   aprovação   -> aprovado_em / aprovado_por (quem liberou o pagamento)
--   comprovante -> comprovante_token (link público único) + comprovante
--                  (cópia do pedido no momento da aprovação: itens, valor,
--                   mensagem ao cliente). Lido só pela rota /api/comprovante.
--   cancelamento-> motivo_cancelamento / cancelado_em / cancelado_por
-- Quem grava é o servidor (api/admin-solicitacao.js, service_role).
-- O status continua o mesmo de antes: aprovar = "aguardando_pagamento".
-- =====================================================================

alter table public.solicitacoes add column if not exists aprovado_em         timestamptz;
alter table public.solicitacoes add column if not exists aprovado_por        uuid references public.profiles(id) on delete set null;
alter table public.solicitacoes add column if not exists comprovante_token   text;
alter table public.solicitacoes add column if not exists comprovante         jsonb;
alter table public.solicitacoes add column if not exists motivo_cancelamento text;
alter table public.solicitacoes add column if not exists cancelado_em        timestamptz;
alter table public.solicitacoes add column if not exists cancelado_por       uuid references public.profiles(id) on delete set null;

create unique index if not exists uq_solicitacoes_comprovante_token
  on public.solicitacoes(comprovante_token) where comprovante_token is not null;

alter table public.solicitacoes drop constraint if exists solicitacoes_comprovante_token_check;
alter table public.solicitacoes add constraint solicitacoes_comprovante_token_check
  check (comprovante_token is null or comprovante_token ~ '^[A-Za-z0-9_-]{32}$');

-- conferir
select count(*) filter (where aprovado_em is not null) as aprovadas_pelo_modal,
       count(*) filter (where comprovante_token is not null) as com_comprovante
  from public.solicitacoes;
