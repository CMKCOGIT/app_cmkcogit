-- =====================================================================
-- 33 · Pagamento só depois da aprovação da CMK (blindagem no banco)
--
-- Problema: a solicitação podia voltar para a análise (cliente pediu revisão da proposta,
-- equipe aprovou com alterações, análise reaberta) com a cobrança ainda "pendente", e um
-- link antigo do Mercado Pago continuava pagável. O pagamento criava o projeto sem aprovação.
--
--   1. Gatilho: saiu de "aguardando_pagamento" (sem ser paga) -> cobranças pendentes canceladas.
--   2. aplicar_pagamento_mp: solicitação fora de "aguardando_pagamento" não vira projeto
--      (resultado solicitacao_nao_liberada) e a equipe é avisada no sino.
--      Também avisa a equipe a cada pagamento confirmado e em valor divergente, duplicidade
--      e pagamento de cobrança cancelada.
--   3. pagamentos.link_criado_em: o app reaproveita o link só enquanto ele é válido
--      (o link do Mercado Pago passa a vencer em 72 h).
--   4. Remove admin_decidir_solicitacao (sql/08): aprovava sem histórico, comprovante nem aviso.
--      A aprovação é só pela rota /api/admin-solicitacao.
-- Rode depois do 32. Pode rodar de novo sem problema.
-- =====================================================================

alter table public.pagamentos add column if not exists link_criado_em timestamptz;

-- 1. cobrança pagável só em "aguardando_pagamento"
create or replace function public.cancelar_cobranca_fora_da_liberacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status not in ('aguardando_pagamento', 'paga') then
    update public.pagamentos
       set status = 'cancelado', link_pagamento = null, mp_preference_id = null
     where solicitacao_id = new.id and status = 'pendente';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cancelar_cobranca_fora_da_liberacao on public.solicitacoes;
create trigger trg_cancelar_cobranca_fora_da_liberacao
  after update of status on public.solicitacoes
  for each row execute function public.cancelar_cobranca_fora_da_liberacao();

-- limpa o que já existir nessa situação
update public.pagamentos p
   set status = 'cancelado', link_pagamento = null, mp_preference_id = null
  from public.solicitacoes s
 where s.id = p.solicitacao_id and p.status = 'pendente' and s.status not in ('aguardando_pagamento', 'paga');

-- 2. aplicar o pagamento (mesma função do sql/09, com a regra da aprovação e os avisos à equipe)
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
  v_link   text;
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
    elsif pg.solicitacao_id is not null and not exists (
            select 1 from public.solicitacoes x where x.id = pg.solicitacao_id and x.status = 'aguardando_pagamento') then
      -- REGRA: solicitação só vira projeto se a CMK aprovou (aguardando_pagamento). Pagamento fora disso
      -- (link antigo guardado, aba aberta) não libera nada e vai para a revisão da equipe.
      v_res := 'solicitacao_nao_liberada';
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

  -- avisa a equipe: pagamento confirmado e pagamento recebido que precisa de revisão (uma vez por pagamento)
  if v_res = 'pago' or (p_status = 'approved' and v_res <> 'ja_processado' and not exists (
       select 1 from public.pagamento_eventos e where e.mp_payment_id = p_mp_payment_id and e.resultado = v_res)) then
    v_link := case when pg.solicitacao_id is not null then 'admin-solicitacao.html?id=' || pg.solicitacao_id
                   when coalesce(v_proj, pg.projeto_id) is not null then 'projeto.html?id=' || coalesce(v_proj, pg.projeto_id)
                   else 'admin.html' end;
    insert into public.notificacoes (usuario_id, projeto_id, tipo, titulo, mensagem, link, metadados)
    select a.id, case when v_res = 'pago' then coalesce(v_proj, pg.projeto_id) end,
           case when v_res = 'pago' then 'pagamento_confirmado' else 'pagamento_revisar' end,
           case when v_res = 'pago' then 'Pagamento confirmado: ' || public.brl_texto(pg.valor)
                else 'Atenção: pagamento recebido precisa de revisão' end,
           pg.descricao || case v_res
             when 'pago' then ' · ' || coalesce(v_metodo, 'outro')
             when 'valor_divergente' then ' · o valor pago (' || coalesce(public.brl_texto(p_valor), '?') || ') não confere com a cobrança. Nada foi liberado.'
             when 'pago_em_duplicidade' then ' · esta cobrança já estava paga: pagamento em duplicidade, avalie o estorno.'
             when 'solicitacao_nao_liberada' then ' · a solicitação não estava aprovada para pagamento. Nada foi liberado: aprove ou estorne.'
             else ' · a cobrança estava ' || replace(v_res, 'cobranca_', '') || '. Nada foi liberado: avalie o estorno.' end,
           v_link,
           jsonb_build_object('pagamento_id', pg.id, 'mp_payment_id', p_mp_payment_id, 'resultado', v_res)
      from public.profiles a where a.role = 'admin';
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

-- 4. caminho antigo de aprovação (sem histórico/comprovante/aviso)
drop function if exists public.admin_decidir_solicitacao(uuid, text, numeric, text);
