-- =====================================================================
-- 34 · Tela Pagamentos do admin: problemas de pagamento com "resolvido"
--
-- Os pagamentos que precisam de revisão (sql/33: valor divergente, duplicidade,
-- cobrança cancelada, solicitação não aprovada) ficam em pagamento_eventos.
-- Aqui a equipe registra quem resolveu e quando (ex.: estornou no Mercado Pago),
-- e eles saem da lista "Com problema" e da caixa de pendências do Início.
-- Rode depois do 33. Pode rodar de novo sem problema.
-- =====================================================================

alter table public.pagamento_eventos add column if not exists revisado_em  timestamptz;
alter table public.pagamento_eventos add column if not exists revisado_por uuid references public.profiles(id) on delete set null;
alter table public.pagamento_eventos add column if not exists revisao_nota text;

create index if not exists idx_pagamento_eventos_problemas on public.pagamento_eventos(created_at desc)
  where revisado_em is null and resultado in ('valor_divergente', 'pago_em_duplicidade', 'solicitacao_nao_liberada', 'cobranca_cancelado', 'cobranca_reembolsado', 'cobranca_falhou');

create or replace function public.admin_resolver_problema_pagamento(p_evento_id bigint, p_nota text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev public.pagamento_eventos%rowtype;
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  select * into v_ev from public.pagamento_eventos where id = p_evento_id for update;
  if not found then raise exception 'Registro não encontrado'; end if;
  -- todos os avisos do mesmo pagamento do Mercado Pago saem juntos
  update public.pagamento_eventos
     set revisado_em = now(), revisado_por = auth.uid(), revisao_nota = nullif(left(trim(coalesce(p_nota, '')), 500), '')
   where revisado_em is null
     and (id = v_ev.id or (v_ev.mp_payment_id is not null and mp_payment_id = v_ev.mp_payment_id and resultado = v_ev.resultado));
end;
$$;

revoke all on function public.admin_resolver_problema_pagamento(bigint, text) from public, anon;
grant execute on function public.admin_resolver_problema_pagamento(bigint, text) to authenticated;
