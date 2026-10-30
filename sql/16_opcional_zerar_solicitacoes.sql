-- =====================================================================
-- 16_opcional_zerar_solicitacoes.sql
--
-- Apaga as solicitações dos clientes (ex.: limpar os testes antes de abrir
-- para clientes de verdade). NÃO é migração: rode só quando quiser zerar.
--
-- O que acontece:
--   apaga  · todas as solicitações (SOL-xxxxx), inclusive comprovantes e itens
--          · as cobranças dessas solicitações que NÃO foram pagas
--            (pendente, falhou, cancelado)
--   mantém · cobranças pagas ou reembolsadas (histórico financeiro): só perdem o
--            vínculo com a solicitação (o banco faz isso sozinho, on delete set null)
--          · clientes, projetos, etapas, arquivos, funcionalidades e notificações
--   opcional · recomeçar a numeração em SOL-00001 (passo 3)
--
-- Como usar no Supabase (SQL Editor):
--   1) Rode só o bloco 1 (PRÉVIA) e confira os números.
--   2) Rode o bloco 2 (ZERAR). Ele está numa transação: se der erro, nada muda.
-- Não tem como desfazer depois: se tiver dúvida, faça um backup antes
-- (Supabase > Database > Backups).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) PRÉVIA: o que vai sair (não altera nada)
-- ---------------------------------------------------------------------
select 'solicitações' as o_que, status, count(*) as quantidade, null::numeric as valor
  from public.solicitacoes
 group by status
union all
select 'cobranças das solicitações', status, count(*), sum(valor)
  from public.pagamentos
 where solicitacao_id is not null
 group by status
order by 1, 2;


-- ---------------------------------------------------------------------
-- 2) ZERAR
-- ---------------------------------------------------------------------
begin;

-- cobranças das solicitações que não foram pagas
delete from public.pagamentos
 where solicitacao_id is not null
   and status in ('pendente', 'falhou', 'cancelado');

-- as solicitações (pagas/reembolsadas ficam e perdem só o vínculo)
delete from public.solicitacoes;

-- 3) OPCIONAL: próxima solicitação volta a ser SOL-00001.
--    Se já existem projetos com nome "... (SOL-00002)", o código vai se repetir
--    no texto (não quebra nada, mas pode confundir). Para manter a numeração,
--    apague a linha abaixo.
alter sequence public.seq_solicitacao restart with 1;

commit;


-- ---------------------------------------------------------------------
-- VARIANTE: zerar só de UM cliente (troque o e-mail e rode no lugar do bloco 2)
-- ---------------------------------------------------------------------
-- begin;
-- delete from public.pagamentos
--  where status in ('pendente', 'falhou', 'cancelado')
--    and solicitacao_id in (select s.id from public.solicitacoes s
--                             join public.profiles p on p.id = s.cliente_id
--                            where p.email = 'cliente@exemplo.com');
-- delete from public.solicitacoes
--  where cliente_id = (select id from public.profiles where email = 'cliente@exemplo.com');
-- commit;
