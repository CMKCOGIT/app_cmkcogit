-- =====================================================================
-- 00_opcional_remover_rascunhos_antigos.sql
--
-- RODE SE você já executou no Supabase os rascunhos de solicitações
-- (consultas salvas "solicitacao_site", "vincular_solicitacao", "envia_validacao",
-- "definir_valor", "pagamento_solicitacao", "confirmar_pagamento"...).
-- Ele apaga SÓ a tabela solicitacoes antiga (colunas diferentes) e as funções
-- daqueles rascunhos. Solicitações de teste antigas somem.
--
-- NÃO apaga profiles, projetos, etapas, pendências, arquivos, funcionalidades
-- nem pagamentos (os arquivos 01..09 ajustam essas sem perder dados).
-- Banco novo/vazio? Pule este arquivo.
-- =====================================================================

drop function if exists public.vincular_solicitacao(text);
drop function if exists public.enviar_para_validacao(text);
drop function if exists public.definir_valor_solicitacao(uuid, numeric);
drop function if exists public.iniciar_pagamento_solicitacao(uuid, numeric);
drop function if exists public.confirmar_pagamento_mp(uuid, text, text, text, numeric, timestamptz);
drop function if exists public.confirmar_pagamento(uuid, text, text, timestamptz);
drop function if exists public.admin_decidir_solicitacao(uuid, text, numeric, text);
drop function if exists public.touch_solicitacao();

drop table if exists public.solicitacoes cascade;
drop table if exists public.catalogo_site cascade;
drop sequence if exists public.seq_projeto_codigo;

-- pagamentos de teste com status que não existem mais (ex.: 'atrasado')
do $$
begin
  if to_regclass('public.pagamentos') is not null then
    update public.pagamentos set status = 'cancelado'
     where status not in ('pendente','pago','falhou','cancelado','reembolsado');
    -- cobranças que apontavam para a tabela antiga (apagada acima)
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'pagamentos' and column_name = 'solicitacao_id') then
      update public.pagamentos set solicitacao_id = null where solicitacao_id is not null;
    end if;
  end if;
end $$;
