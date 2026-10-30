-- =====================================================================
-- 16_opcional_zerar_solicitacoes.sql
--
-- Limpa as solicitações e MANTÉM SÓ AS PAGAS DE VERDADE: status "paga" E com
-- pelo menos uma cobrança confirmada ("pago") pelo Mercado Pago. Todo o resto
-- (em validação, aguardando pagamento, canceladas, testes) é apagado.
-- NÃO é migração: rode só quando quiser limpar. Depois rode o 17 (código PLN).
--
-- O que acontece:
--   apaga  · as solicitações que não foram pagas de verdade
--          · as cobranças delas que não foram pagas (pendente, falhou, cancelado)
--          · as notificações que citam o código dessas solicitações
--   mantém · as solicitações pagas, os projetos e as cobranças pagas/reembolsadas
--          · clientes, etapas, arquivos e funcionalidades
--
-- Como usar no Supabase (SQL Editor):
--   1) Rode só o bloco 1 (PRÉVIA) e confira: "fica" x "sai".
--   2) Rode o bloco 2 (LIMPAR). Está numa transação: se der erro, nada muda.
-- Não tem como desfazer: se tiver dúvida, faça um backup antes
-- (Supabase > Database > Backups).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) PRÉVIA: o que fica e o que sai (não altera nada)
-- ---------------------------------------------------------------------
select case when s.status = 'paga'
             and exists (select 1 from public.pagamentos p where p.solicitacao_id = s.id and p.status = 'pago')
            then 'fica' else 'sai' end as destino,
       s.codigo, s.status, c.nome as cliente, s.created_at::date as criada_em
  from public.solicitacoes s
  left join public.profiles c on c.id = s.cliente_id
 order by destino, s.created_at;


-- ---------------------------------------------------------------------
-- 2) LIMPAR — um bloco só (tudo ou nada; funciona no SQL Editor do Supabase,
--    que pode rodar cada comando numa conexão diferente)
-- ---------------------------------------------------------------------
do $$
declare
  v_ids   uuid[];
  v_cods  text[];
  v_pag   int;
  v_not   int;
begin
  select array_agg(s.id), array_agg(s.codigo) into v_ids, v_cods
    from public.solicitacoes s
   where not (s.status = 'paga'
              and exists (select 1 from public.pagamentos p where p.solicitacao_id = s.id and p.status = 'pago'));

  if v_ids is null then
    raise notice 'Nada para apagar: só há solicitações pagas.';
    return;
  end if;

  -- cobranças não pagas dessas solicitações
  delete from public.pagamentos
   where solicitacao_id = any(v_ids)
     and status in ('pendente', 'falhou', 'cancelado');
  get diagnostics v_pag = row_count;

  -- notificações que falam delas (ex.: "Pedido SOL-00013 aprovado")
  delete from public.notificacoes n
   where exists (select 1 from unnest(v_cods) c
                  where n.titulo like '%' || c || '%' or coalesce(n.mensagem, '') like '%' || c || '%');
  get diagnostics v_not = row_count;

  -- as solicitações (cobrança reembolsada que sobrar perde só o vínculo)
  delete from public.solicitacoes where id = any(v_ids);

  raise notice 'Apagadas: % solicitações, % cobranças não pagas, % notificações.', array_length(v_ids, 1), v_pag, v_not;
end $$;

-- conferência: o que ficou
select codigo, status, created_at::date from public.solicitacoes order by created_at;
