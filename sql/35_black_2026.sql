-- =====================================================================
-- 35 · Black da Cogit 2026 (pedidos de 26/11 00h00 a 27/11 23h59, Brasília)
--
-- Marca o pedido feito durante a Black com o preço e a data registrados pelo SERVIDOR
-- (api/solicitacoes.js, lib/black-config.js). A aprovação recalcula o escopo validado com o
-- preço da Black até promo_pagar_ate; o checkout recusa pagar o preço da Black depois disso.
--   promo            'black-2026' (null = pedido normal)
--   promo_pedido_em  quando o pedido entrou (data do servidor)
--   promo_valor      valor calculado com a Black no pedido (referência para a equipe)
--   promo_pagar_ate  preço fechado: 27/11 23h59 · com validação de escopo: 04/12 23h59
--   promo_aplicada   a aprovação usou o preço da Black? (null até aprovar)
-- Só o servidor grava estes campos (o cliente só tem SELECT em solicitacoes).
-- RODE ANTES de publicar o app com a Black: sem as colunas, criar pedido na Black falha.
-- Pode rodar de novo sem problema.
-- =====================================================================

alter table public.solicitacoes add column if not exists promo           text;
alter table public.solicitacoes add column if not exists promo_pedido_em timestamptz;
alter table public.solicitacoes add column if not exists promo_valor     numeric(12,2);
alter table public.solicitacoes add column if not exists promo_pagar_ate timestamptz;
alter table public.solicitacoes add column if not exists promo_aplicada  boolean;

alter table public.solicitacoes drop constraint if exists solicitacoes_promo_check;
alter table public.solicitacoes add constraint solicitacoes_promo_check
  check (promo is null or (promo = 'black-2026' and promo_pedido_em is not null and promo_pagar_ate is not null));

-- lista da equipe: pedidos da Black ainda abertos, pelo prazo de pagamento
create index if not exists idx_solicitacoes_promo on public.solicitacoes(promo, promo_pagar_ate) where promo is not null;

-- o PostgREST (Supabase) passa a enxergar as colunas novas na hora
notify pgrst, 'reload schema';
