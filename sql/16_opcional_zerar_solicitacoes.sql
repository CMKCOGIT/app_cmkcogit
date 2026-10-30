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
-- 2) LIMPAR
-- ---------------------------------------------------------------------
begin;

create temporary table _sai on commit drop as
select s.id, s.codigo
  from public.solicitacoes s
 where not (s.status = 'paga'
            and exists (select 1 from public.pagamentos p where p.solicitacao_id = s.id and p.status = 'pago'));

-- cobranças não pagas dessas solicitações
delete from public.pagamentos
 where solicitacao_id in (select id from _sai)
   and status in ('pendente', 'falhou', 'cancelado');

-- notificações que falam delas (ex.: "Pedido SOL-00013 aprovado")
delete from public.notificacoes n
 using _sai
 where n.titulo like '%' || _sai.codigo || '%'
    or coalesce(n.mensagem, '') like '%' || _sai.codigo || '%';

-- as solicitações (cobrança reembolsada que sobrar perde só o vínculo)
delete from public.solicitacoes where id in (select id from _sai);

commit;
