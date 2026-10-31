-- =====================================================================
-- 20_renovacao_cartao.sql — renovação automática no cartão (opcional)
--
-- Rode DEPOIS do 19. Pode rodar mais de uma vez.
--
-- Como funciona:
--   * Em Pagamentos o cliente clica "Ativar renovação automática no cartão".
--     O servidor cria uma assinatura no Mercado Pago (preapproval) e o
--     cliente cadastra o cartão lá. Autorizada, renovacao_automatica = true
--     e a renovação deixa de ir para "Pagamentos pendentes".
--   * A rotina diária (/api/renovacoes) consulta a assinatura no Mercado
--     Pago: cada cobrança nova no cartão vira uma cobrança "paga" aqui e o
--     vencimento avança. Se a assinatura for cancelada lá, ou o cartão não
--     for cobrado em até 5 dias do vencimento, volta para a cobrança manual
--     (e-mail + Pagamentos).
-- =====================================================================

alter table public.assinaturas add column if not exists mp_preapproval_id text;
alter table public.assinaturas add column if not exists mp_status        text;      -- pending | authorized | paused | cancelled
alter table public.assinaturas add column if not exists mp_cobrancas     int not null default 0; -- cobranças do cartão já registradas
alter table public.assinaturas add column if not exists mp_inicio        date;      -- data da 1ª cobrança no cartão

-- ---------------------------------------------------------------------
-- O servidor grava o estado da assinatura do Mercado Pago (service_role)
-- ---------------------------------------------------------------------
create or replace function public.atualizar_renovacao_cartao(
  p_assinatura_id uuid,
  p_preapproval_id text,
  p_status text,
  p_inicio date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.assinaturas%rowtype;
begin
  select * into a from public.assinaturas where id = p_assinatura_id for update;
  if not found then raise exception 'Assinatura não encontrada.'; end if;

  if a.mp_preapproval_id is distinct from p_preapproval_id then
    -- assinatura nova no Mercado Pago: a contagem de cobranças recomeça
    update public.assinaturas set mp_preapproval_id = p_preapproval_id, mp_cobrancas = 0, mp_inicio = p_inicio
     where id = a.id;
  end if;

  update public.assinaturas
     set mp_status = p_status,
         renovacao_automatica = (p_status = 'authorized' and status <> 'cancelada'),
         mp_inicio = coalesce(p_inicio, mp_inicio)
   where id = a.id;

  -- autorizada: o cartão cobra o período em aberto, então a cobrança manual pendente sai
  if p_status = 'authorized' then
    update public.pagamentos set status = 'cancelado', link_pagamento = null
     where assinatura_id = a.id and status = 'pendente';
  end if;
end;
$$;
revoke all on function public.atualizar_renovacao_cartao(uuid, text, text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Cobranças feitas no cartão: registra cada uma como paga (o trigger do 19
-- avança o vencimento). Nunca registra a mesma cobrança duas vezes.
-- ---------------------------------------------------------------------
create or replace function public.registrar_cobrancas_cartao(
  p_assinatura_id uuid,
  p_total_cobrado int,
  p_ultima_cobranca timestamptz default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  a      public.assinaturas%rowtype;
  v_pag  uuid;
  v_novas int := 0;
begin
  select * into a from public.assinaturas where id = p_assinatura_id for update;
  if not found or p_total_cobrado is null then return 0; end if;

  while a.mp_cobrancas < p_total_cobrado loop
    v_pag := null;
    insert into public.pagamentos (cliente_id, projeto_id, descricao, valor, vencimento, assinatura_id, referente_a, metodo)
    select a.cliente_id, s.projeto_id, left('Renovação automática ' || a.plano || ' — ' || a.nome, 160),
           a.valor, a.proximo_vencimento, a.id, a.proximo_vencimento, 'cartao'
      from public.solicitacoes s where s.id = a.solicitacao_id
    on conflict do nothing
    returning id into v_pag;

    -- já existia cobrança deste período (ex.: renovação manual pendente): ela é a que foi paga
    if v_pag is null then
      select id into v_pag from public.pagamentos
       where assinatura_id = a.id and referente_a = a.proximo_vencimento and status <> 'cancelado' limit 1;
    end if;

    update public.pagamentos
       set status = 'pago', metodo = 'cartao', pago_em = coalesce(p_ultima_cobranca, now()), link_pagamento = null
     where id = v_pag and status <> 'pago';

    update public.assinaturas set mp_cobrancas = mp_cobrancas + 1 where id = a.id;
    select * into a from public.assinaturas where id = a.id;  -- vencimento já avançou (trigger)
    v_novas := v_novas + 1;
    exit when v_novas >= 24;  -- trava de segurança
  end loop;
  return v_novas;
end;
$$;
revoke all on function public.registrar_cobrancas_cartao(uuid, int, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Cancelar a renovação também desliga o cartão (o servidor cancela no
-- Mercado Pago antes de chamar esta função)
-- ---------------------------------------------------------------------
create or replace function public.cancelar_assinatura(p_assinatura_id uuid)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.assinaturas%rowtype;
begin
  select * into a from public.assinaturas where id = p_assinatura_id for update;
  if not found then raise exception 'Assinatura não encontrada.'; end if;
  if a.status = 'cancelada' then return a.proximo_vencimento; end if;

  update public.assinaturas set status = 'cancelada', cancelada_em = now(), renovacao_automatica = false where id = a.id;
  update public.pagamentos set status = 'cancelado', link_pagamento = null
   where assinatura_id = a.id and status = 'pendente';
  return a.proximo_vencimento;  -- o site fica no ar até esta data
end;
$$;
-- agora só pelo servidor (/api/assinatura), que cancela no Mercado Pago antes
revoke all on function public.cancelar_assinatura(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Conferir
-- ---------------------------------------------------------------------
select renovacao_automatica, mp_status, count(*) from public.assinaturas group by 1, 2;
