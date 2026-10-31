-- =====================================================================
-- 19_assinaturas.sql — planos mensal e anual do modelo pronto (renovação)
--
-- Rode DEPOIS do 18. Pode rodar mais de uma vez.
--
-- Regra de renovação:
--   * Automática no cartão SÓ se o cliente pedir (renovacao_automatica, para
--     a integração com assinaturas do Mercado Pago; enquanto não houver, fica
--     desligada para todos).
--   * Caso contrário, antes do vencimento a plataforma cria a cobrança da
--     renovação em "Pagamentos pendentes" e avisa por e-mail e no sino
--     (rotina diária /api/renovacoes chama gerar_renovacoes()).
--
-- O que faz:
--   1. Tabela assinaturas (uma por item mensal/anual pago) e, em pagamentos,
--      assinatura_id + referente_a (período que a cobrança paga).
--   2. Quando uma cobrança vira "paga":
--      - da solicitação com plano mensal/anual -> nasce a assinatura;
--      - de renovação -> o próximo vencimento avança um período.
--   3. gerar_renovacoes(): cria as cobranças de renovação que vencem nos
--      próximos dias (uma por período, nunca duplica) e marca atrasadas.
--   4. cancelar_assinatura(): o cliente cancela a renovação; vale até o fim
--      do período pago e a cobrança de renovação pendente é cancelada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Estrutura
-- ---------------------------------------------------------------------
create table if not exists public.assinaturas (
  id                    uuid primary key default gen_random_uuid(),
  cliente_id            uuid not null references public.profiles(id) on delete cascade,
  solicitacao_id        uuid not null references public.solicitacoes(id) on delete cascade,
  item_id               text not null,                 -- ex.: landing-page
  nome                  text not null,
  plano                 text not null check (plano in ('mensal', 'anual')),
  valor                 numeric(12,2) not null check (valor > 0),
  status                text not null default 'ativa' check (status in ('ativa', 'atrasada', 'cancelada')),
  renovacao_automatica  boolean not null default false,  -- só no cartão, se o cliente pedir
  proximo_vencimento    date not null,
  created_at            timestamptz not null default now(),
  cancelada_em          timestamptz,
  unique (solicitacao_id, item_id)
);
create index if not exists idx_assinaturas_vencimento on public.assinaturas(status, proximo_vencimento);

alter table public.pagamentos add column if not exists assinatura_id uuid references public.assinaturas(id) on delete set null;
alter table public.pagamentos add column if not exists referente_a  date;
create unique index if not exists uq_pagamentos_renovacao
  on public.pagamentos(assinatura_id, referente_a) where assinatura_id is not null and status <> 'cancelado';

alter table public.assinaturas enable row level security;
drop policy if exists "assinaturas_select" on public.assinaturas;
create policy "assinaturas_select" on public.assinaturas
  for select using (cliente_id = auth.uid() or public.is_admin());
drop policy if exists "assinaturas_admin" on public.assinaturas;
create policy "assinaturas_admin" on public.assinaturas
  for all using (public.is_admin()) with check (public.is_admin());
revoke insert, update, delete on public.assinaturas from anon, authenticated;

-- um período depois de uma data
create or replace function public.proximo_periodo(p_data date, p_plano text)
returns date
language sql
immutable
as $$
  select (p_data + case when p_plano = 'anual' then interval '1 year' else interval '1 month' end)::date;
$$;

-- ---------------------------------------------------------------------
-- 2. Cobrança paga -> cria ou renova a assinatura
-- ---------------------------------------------------------------------
create or replace function public.assinatura_ao_pagar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := (coalesce(new.pago_em, now()) at time zone 'America/Sao_Paulo')::date;
  v_res  jsonb;
  v_item jsonb;
begin
  if new.status <> 'pago' or old.status = 'pago' then return new; end if;

  if new.assinatura_id is not null then
    update public.assinaturas
       set proximo_vencimento = public.proximo_periodo(greatest(proximo_vencimento, coalesce(new.referente_a, proximo_vencimento)), plano),
           status = case when status = 'cancelada' then status else 'ativa' end
     where id = new.assinatura_id;
    return new;
  end if;

  if new.solicitacao_id is not null then
    select resumo into v_res from public.solicitacoes where id = new.solicitacao_id;
    for v_item in select * from jsonb_array_elements(coalesce(v_res->'itens', '[]'::jsonb)) loop
      if v_item->>'plano' in ('mensal', 'anual') and (v_item->>'preco') ~ '^\d+(\.\d+)?$' then
        insert into public.assinaturas (cliente_id, solicitacao_id, item_id, nome, plano, valor, proximo_vencimento)
        values (new.cliente_id, new.solicitacao_id, v_item->>'id', split_part(coalesce(v_item->>'nome', 'Modelo pronto'), ' — ', 1),
                v_item->>'plano', (v_item->>'preco')::numeric, public.proximo_periodo(v_hoje, v_item->>'plano'))
        on conflict (solicitacao_id, item_id) do nothing;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assinatura_ao_pagar on public.pagamentos;
create trigger trg_assinatura_ao_pagar
  after update of status on public.pagamentos
  for each row execute function public.assinatura_ao_pagar();

-- ---------------------------------------------------------------------
-- 3. Renovações: cobrança pendente N dias antes do vencimento
--    (só o servidor chama: service_role na rotina /api/renovacoes)
-- ---------------------------------------------------------------------
create or replace function public.gerar_renovacoes(p_dias_antes int default 7)
returns table (pagamento_id uuid, cliente_id uuid, descricao text, valor numeric, vencimento date)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- renovação pendente há mais de 10 dias do vencimento: assinatura atrasada
  update public.assinaturas a set status = 'atrasada'
   where a.status = 'ativa'
     and exists (select 1 from public.pagamentos p
                  where p.assinatura_id = a.id and p.status = 'pendente' and p.vencimento < v_hoje - 10);

  return query
  insert into public.pagamentos (cliente_id, projeto_id, descricao, valor, vencimento, assinatura_id, referente_a)
  select a.cliente_id, s.projeto_id,
         left('Renovação ' || a.plano || ' — ' || a.nome, 160),
         a.valor, a.proximo_vencimento, a.id, a.proximo_vencimento
    from public.assinaturas a
    join public.solicitacoes s on s.id = a.solicitacao_id
   where a.status in ('ativa', 'atrasada')
     and not a.renovacao_automatica
     and a.proximo_vencimento <= v_hoje + greatest(p_dias_antes, 0)
     and not exists (select 1 from public.pagamentos p
                      where p.assinatura_id = a.id and p.referente_a = a.proximo_vencimento and p.status <> 'cancelado')
  on conflict do nothing
  returning pagamentos.id, pagamentos.cliente_id, pagamentos.descricao, pagamentos.valor, pagamentos.vencimento;
end;
$$;

revoke all on function public.gerar_renovacoes(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Cliente cancela a renovação (vale até o fim do período já pago)
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
  if auth.uid() is null then raise exception 'Sua sessão expirou. Entre novamente.'; end if;
  select * into a from public.assinaturas where id = p_assinatura_id for update;
  if not found or (a.cliente_id <> auth.uid() and not public.is_admin()) then raise exception 'Assinatura não encontrada.'; end if;
  if a.status = 'cancelada' then return a.proximo_vencimento; end if;

  update public.assinaturas set status = 'cancelada', cancelada_em = now(), renovacao_automatica = false where id = a.id;
  update public.pagamentos set status = 'cancelado', link_pagamento = null
   where assinatura_id = a.id and status = 'pendente';
  return a.proximo_vencimento;  -- o site fica no ar até esta data
end;
$$;

revoke all on function public.cancelar_assinatura(uuid) from public, anon;
grant execute on function public.cancelar_assinatura(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Conferir
-- ---------------------------------------------------------------------
select status, plano, count(*) from public.assinaturas group by 1, 2;
