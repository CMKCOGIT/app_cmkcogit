-- =====================================================================
-- 17_codigo_plano.sql — rode DEPOIS do 15 (e do 16, se for limpar antes).
-- Pode rodar mais de uma vez.
--
-- As solicitações passam de "SOL-00013" para "PLN-2026-0013".
-- PLN = Plano: é o "Pensar • Estruturar" da COGIT. Quando o plano é pago ele
-- vira projeto, que já usa o mesmo formato: COG-2026-100 (o "Construir").
--
--   · novas solicitações: PLN-<ano>-<número>, numeração contínua
--   · as que já existem (SOL-…) são renumeradas pela ordem de criação e o código
--     antigo é trocado onde ele aparece copiado: nome do projeto, descrição da
--     cobrança, notificações e o comprovante salvo
--   · o que já foi enviado ao Mercado Pago e ao WhatsApp continua com o código
--     antigo (não dá para alterar lá)
-- =====================================================================

-- Um bloco só (tudo ou nada; funciona no SQL Editor do Supabase).
do $$
declare
  r        record;
  v_ultimo int;
  v_novo   text;
begin
  -- 1) formato das próximas
  alter table public.solicitacoes alter column codigo
    set default ('PLN-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-'
                 || lpad(nextval('public.seq_solicitacao')::text, 4, '0'));

  -- 2) renumerar as que ainda estão no formato antigo (depois das que já são PLN)
  select coalesce(max(substring(codigo from '(\d+)$')::int), 0) into v_ultimo
    from public.solicitacoes where codigo like 'PLN-%';

  for r in select id, codigo as antigo, created_at from public.solicitacoes
            where codigo like 'SOL-%' order by created_at, codigo loop
    v_ultimo := v_ultimo + 1;
    v_novo := 'PLN-' || to_char(r.created_at at time zone 'America/Sao_Paulo', 'YYYY') || '-' || lpad(v_ultimo::text, 4, '0');

    -- 3) trocar o código onde ele foi copiado
    update public.projetos    set nome      = replace(nome, r.antigo, v_novo)      where nome like '%' || r.antigo || '%';
    update public.pagamentos  set descricao = replace(descricao, r.antigo, v_novo) where descricao like '%' || r.antigo || '%';
    update public.notificacoes set titulo   = replace(titulo, r.antigo, v_novo)    where titulo like '%' || r.antigo || '%';
    update public.notificacoes set mensagem = replace(mensagem, r.antigo, v_novo)  where mensagem like '%' || r.antigo || '%';
    update public.solicitacoes
       set codigo = v_novo,
           comprovante = case when comprovante is null then null
                              else replace(comprovante::text, r.antigo, v_novo)::jsonb end
     where id = r.id;
  end loop;

  -- 4) a próxima continua a numeração (PLN-AAAA-0001 se não sobrou nenhuma)
  perform setval('public.seq_solicitacao', greatest(v_ultimo, 1), v_ultimo > 0);
  raise notice 'Pronto. Última numeração usada: %', v_ultimo;
end $$;

-- conferência
select codigo, status, created_at::date from public.solicitacoes order by created_at;
