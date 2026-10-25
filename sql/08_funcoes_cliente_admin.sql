-- =====================================================================
-- 08_funcoes_cliente_admin.sql
--   cliente_cancelar_solicitacao -> o cliente desiste antes de pagar
--   admin_decidir_solicitacao    -> admin valida o sob medida (define o valor) ou cancela
--   admin_atualizar_projeto      -> admin avança a etapa, muda status, previsão e domínio
-- Pode rodar mais de uma vez.
-- =====================================================================

create or replace function public.cliente_cancelar_solicitacao(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.solicitacoes%rowtype;
begin
  if auth.uid() is null then raise exception 'Faça login para continuar'; end if;

  select * into s from public.solicitacoes where id = p_id and cliente_id = auth.uid() for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if s.status not in ('em_validacao', 'aguardando_pagamento') then
    raise exception 'Esta solicitação não pode mais ser cancelada';
  end if;

  update public.solicitacoes set status = 'cancelada' where id = s.id;
  update public.pagamentos set status = 'cancelado', link_pagamento = null
   where solicitacao_id = s.id and status = 'pendente';
end;
$$;

revoke all on function public.cliente_cancelar_solicitacao(uuid) from public, anon;
grant execute on function public.cliente_cancelar_solicitacao(uuid) to authenticated;


create or replace function public.admin_decidir_solicitacao(
  p_id         uuid,
  p_acao       text,              -- 'aprovar' | 'cancelar'
  p_valor      numeric default null,
  p_observacao text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.solicitacoes%rowtype;
  v_obs text := nullif(left(trim(coalesce(p_observacao, '')), 500), '');
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;

  select * into s from public.solicitacoes where id = p_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;

  if p_acao = 'aprovar' then
    if s.status not in ('em_validacao', 'aguardando_pagamento') then
      raise exception 'Só é possível definir valor de solicitações em validação ou aguardando pagamento';
    end if;
    if p_valor is null or p_valor <= 0 or p_valor > 1000000 then
      raise exception 'Informe um valor válido';
    end if;

    update public.solicitacoes
       set valor_final = round(p_valor, 2),
           observacao_admin = coalesce(v_obs, observacao_admin),
           status = 'aguardando_pagamento'
     where id = s.id;

    -- cobrança pendente com valor antigo: atualiza e invalida o link antigo
    -- (se alguém pagar o link antigo, o valor não confere e nada é liberado)
    update public.pagamentos
       set valor = round(p_valor, 2), link_pagamento = null, mp_preference_id = null
     where solicitacao_id = s.id and status = 'pendente' and valor <> round(p_valor, 2);

  elsif p_acao = 'cancelar' then
    if s.status in ('paga', 'cancelada') then raise exception 'Solicitação já finalizada'; end if;
    update public.solicitacoes set status = 'cancelada', observacao_admin = coalesce(v_obs, observacao_admin)
     where id = s.id;
    update public.pagamentos set status = 'cancelado', link_pagamento = null
     where solicitacao_id = s.id and status = 'pendente';
  else
    raise exception 'Ação inválida';
  end if;
end;
$$;

revoke all on function public.admin_decidir_solicitacao(uuid, text, numeric, text) from public, anon;
grant execute on function public.admin_decidir_solicitacao(uuid, text, numeric, text) to authenticated;


-- Avança o projeto: etapas anteriores ficam "concluída", a atual "em andamento".
-- Status "concluido" fecha todas as 8 etapas.
create or replace function public.admin_atualizar_projeto(
  p_id       uuid,
  p_etapa    int  default null,
  p_status   text default null,
  p_previsao date default null,
  p_dominio  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_etapa int;
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  if not exists (select 1 from public.projetos where id = p_id) then raise exception 'Projeto não encontrado'; end if;
  if p_etapa is not null and (p_etapa < 1 or p_etapa > 8) then raise exception 'Etapa deve ser de 1 a 8'; end if;

  update public.projetos set
    status_projeto   = coalesce(p_status, status_projeto),
    etapa_atual      = case when p_status = 'concluido' then 8 else coalesce(p_etapa, etapa_atual) end,
    previsao_entrega = coalesce(p_previsao, previsao_entrega),
    dominio          = coalesce(nullif(trim(p_dominio), ''), dominio)
  where id = p_id
  returning etapa_atual into v_etapa;

  update public.projeto_etapas set
    status = case
      when ordem < v_etapa or (select status_projeto from public.projetos where id = p_id) = 'concluido' then 'concluida'
      when ordem = v_etapa then 'em_andamento'
      else 'pendente' end,
    data_concluida = case
      when ordem < v_etapa or (select status_projeto from public.projetos where id = p_id) = 'concluido'
        then coalesce(data_concluida, current_date)
      else null end
  where projeto_id = p_id;
end;
$$;

revoke all on function public.admin_atualizar_projeto(uuid, int, text, date, text) from public, anon;
grant execute on function public.admin_atualizar_projeto(uuid, int, text, date, text) to authenticated;
