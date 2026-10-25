-- =====================================================================
-- 09_aplicar_pagamento_mp.sql — aplica o que o Mercado Pago informou.
-- Chamada SÓ pelo servidor (service_role): webhook, volta do checkout e
-- botão "verificar pagamento". O servidor sempre consulta o pagamento na
-- API do Mercado Pago antes de chamar esta função.
--
--   approved + valor e moeda conferem + cobrança pendente:
--       solicitação do site -> cria o projeto (8 etapas) com previsão de entrega
--       funcionalidade      -> pedido vira "paga"
--   approved com valor diferente -> nada é liberado (valor_divergente)
--   refunded / charged_back      -> reembolsado
--   pending / rejected / ...     -> continua pendente (o cliente pode tentar de novo)
-- Idempotente: o mesmo aviso repetido não muda nada.
--
-- PRAZO: projetos maiores demoram mais. Dias úteis estimados por tipo
-- (ajuste à vontade na função prazo_estimado_dias) + 5 por complemento
-- + 10 por solução extra. O admin pode mudar a previsão depois.
-- =====================================================================

create or replace function public.prazo_estimado_dias(p_resumo jsonb)
returns int
language plpgsql
immutable
as $$
declare
  v_dias  int := 0;
  v_item  jsonb;
  v_base  int;
  v_qtd   int := 0;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_resumo->'itens', '[]'::jsonb)) loop
    v_base := case v_item->>'id'
      when 'landing-page'         then 10
      when 'portfolio'            then 12
      when 'site-institucional'   then 15
      when 'identidade-essencial' then 10
      when 'identidade-completa'  then 20
      when 'consultoria'          then 7
      when 'diagnostico'          then 5
      when 'automacao'            then 20
      when 'integracao'           then 20
      when 'loja-virtual'         then 35
      when 'sistema'              then 45
      when 'mvp'                  then 50
      when 'plataforma'           then 60
      else 20 end;
    if v_item->>'modelo' = 'sob-medida' then v_base := v_base + 10; end if;
    v_dias := greatest(v_dias, v_base);   -- a maior solução define a base
    v_qtd := v_qtd + 1;
  end loop;
  v_dias := v_dias + greatest(v_qtd - 1, 0) * 10
                   + jsonb_array_length(coalesce(p_resumo->'complementos', '[]'::jsonb)) * 5;
  return greatest(v_dias, 5);
end;
$$;

-- soma dias úteis (seg-sex) a uma data
create or replace function public.somar_dias_uteis(p_inicio date, p_dias int)
returns date
language sql
immutable
as $$
  select d::date from generate_series(p_inicio + 1, p_inicio + p_dias * 2 + 14, interval '1 day') d
   where extract(isodow from d) < 6
   order by d offset greatest(p_dias, 1) - 1 limit 1;
$$;


create or replace function public.aplicar_pagamento_mp(
  p_pagamento_id   uuid,
  p_mp_payment_id  text,
  p_status         text,
  p_status_detalhe text,
  p_metodo         text,
  p_valor          numeric,
  p_moeda          text,
  p_pago_em        timestamptz,
  p_origem         text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  pg       public.pagamentos%rowtype;
  s        public.solicitacoes%rowtype;
  v_res    text;
  v_proj   uuid;
  v_item   text;
  v_nome   text;
  v_tipo   text;
  v_metodo text := case when p_metodo in ('pix','cartao','boleto') then p_metodo else 'outro' end;
  v_logar  boolean := true;
begin
  select * into pg from public.pagamentos where id = p_pagamento_id for update;
  if not found then
    insert into public.pagamento_eventos (pagamento_id, mp_payment_id, origem, status_mp, status_detalhe, valor_mp, resultado)
    values (null, p_mp_payment_id, p_origem, p_status, p_status_detalhe, p_valor, 'pagamento_inexistente');
    return 'pagamento_inexistente';
  end if;

  if p_status = 'approved' then
    if coalesce(p_moeda, '') <> 'BRL' or p_valor is null or round(p_valor, 2) <> round(pg.valor, 2) then
      v_res := 'valor_divergente';
    elsif pg.status = 'pago' then
      v_res := case when pg.mp_payment_id = p_mp_payment_id then 'ja_processado' else 'pago_em_duplicidade' end;
      v_logar := v_res <> 'ja_processado';
    elsif pg.status <> 'pendente' then
      v_res := 'cobranca_' || pg.status;          -- ex.: pagou depois de a cobrança ser cancelada
    else
      update public.pagamentos
         set status = 'pago', metodo = v_metodo, pago_em = coalesce(p_pago_em, now()),
             mp_payment_id = p_mp_payment_id, gateway_id = p_mp_payment_id,
             mp_ultimo_status = p_status, mp_ultimo_payment_id = p_mp_payment_id, link_pagamento = null
       where id = pg.id;

      -- funcionalidade avulsa de um projeto que já existe
      if pg.projeto_funcionalidade_id is not null then
        update public.projeto_funcionalidades set status = 'paga'
         where id = pg.projeto_funcionalidade_id and status = 'aguardando_pagamento';
      end if;

      -- solicitação vinda do site: vira projeto (as 8 etapas são criadas pelo trigger)
      if pg.solicitacao_id is not null then
        select * into s from public.solicitacoes where id = pg.solicitacao_id for update;
        if found then
          v_proj := s.projeto_id;
          if v_proj is null then
            v_item := coalesce(s.resumo->'itens'->0->>'id', s.selecao->'servicos'->0->>'id');
            v_nome := coalesce(s.resumo->'itens'->0->>'nome', 'Projeto');
            v_tipo := case
              when v_item = 'site-institucional' then 'institucional'
              when v_item = 'landing-page' then 'landing_page'
              when v_item = 'portfolio' then 'portfolio'
              when v_item = 'loja-virtual' then 'loja'
              when v_item in ('plataforma','mvp') then 'saas'
              when v_item = 'sistema' then 'sistema'
              when v_item in ('automacao','integracao') then 'automacao'
              when v_item in ('consultoria','diagnostico') then 'consultoria'
              when v_item like 'identidade-%' then 'identidade'
              else 'outro' end;

            insert into public.projetos
              (cliente_id, solicitacao_id, codigo, nome, tipo, status_projeto, status_pagamento, valor_total, previsao_entrega)
            values (
              s.cliente_id, s.id,
              'COG-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.seq_codigo_projeto')::text, 3, '0'),
              v_nome || ' (' || s.codigo || ')',
              v_tipo, 'em_andamento', 'pago', coalesce(s.valor_final, pg.valor),
              public.somar_dias_uteis(current_date, public.prazo_estimado_dias(s.resumo))
            )
            returning id into v_proj;
          end if;
          update public.solicitacoes set status = 'paga', projeto_id = v_proj where id = s.id;
          update public.pagamentos set projeto_id = coalesce(projeto_id, v_proj) where id = pg.id;
        end if;
      end if;

      v_proj := coalesce(v_proj, pg.projeto_id);
      if v_proj is not null then
        update public.projetos
           set status_pagamento = case when exists (
                 select 1 from public.pagamentos where projeto_id = v_proj and status = 'pendente')
               then 'parcial' else 'pago' end
         where id = v_proj;
      end if;
      v_res := 'pago';
    end if;

  elsif p_status in ('refunded', 'charged_back') then
    if pg.status = 'pago' and pg.mp_payment_id = p_mp_payment_id then
      update public.pagamentos set status = 'reembolsado', mp_ultimo_status = p_status where id = pg.id;
      if pg.projeto_funcionalidade_id is not null then
        update public.projeto_funcionalidades set status = 'cancelada' where id = pg.projeto_funcionalidade_id;
      elsif pg.projeto_id is not null then
        update public.projetos set status_pagamento = 'reembolsado' where id = pg.projeto_id;
      end if;
      v_res := 'reembolsado';
    else
      v_res := 'ignorado';
    end if;

  else
    -- pending, in_process, authorized, rejected, cancelled...
    v_logar := not (pg.mp_ultimo_status is not distinct from p_status
                    and pg.mp_ultimo_payment_id is not distinct from p_mp_payment_id);
    if pg.status = 'pendente' then
      update public.pagamentos set mp_ultimo_status = p_status, mp_ultimo_payment_id = p_mp_payment_id
       where id = pg.id;
    end if;
    v_res := 'sem_alteracao';
  end if;

  if v_logar then
    insert into public.pagamento_eventos (pagamento_id, mp_payment_id, origem, status_mp, status_detalhe, valor_mp, resultado)
    values (pg.id, p_mp_payment_id, p_origem, p_status, p_status_detalhe, p_valor, v_res);
  end if;
  return v_res;
end;
$$;

revoke all on function public.aplicar_pagamento_mp(uuid, text, text, text, text, numeric, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.aplicar_pagamento_mp(uuid, text, text, text, text, numeric, text, timestamptz, text)
  to service_role;
