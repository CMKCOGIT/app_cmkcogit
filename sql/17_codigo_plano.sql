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

begin;

-- 1) formato das próximas
alter table public.solicitacoes alter column codigo
  set default ('PLN-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-'
               || lpad(nextval('public.seq_solicitacao')::text, 4, '0'));

-- 2) renumerar as que ainda estão no formato antigo (depois das que já são PLN)
create temporary table _codigo on commit drop as
with base as (
  select coalesce(max(substring(codigo from '(\d+)$')::int), 0) as ultimo
    from public.solicitacoes where codigo like 'PLN-%'
)
select s.id, s.codigo as antigo,
       'PLN-' || to_char(s.created_at at time zone 'America/Sao_Paulo', 'YYYY') || '-'
       || lpad((base.ultimo + row_number() over (order by s.created_at, s.codigo))::text, 4, '0') as novo
  from public.solicitacoes s, base
 where s.codigo like 'SOL-%';

-- 3) trocar o código onde ele foi copiado
update public.projetos p set nome = replace(p.nome, c.antigo, c.novo)
  from _codigo c where p.nome like '%' || c.antigo || '%';

update public.pagamentos p set descricao = replace(p.descricao, c.antigo, c.novo)
  from _codigo c where p.descricao like '%' || c.antigo || '%';

update public.notificacoes n set titulo = replace(n.titulo, c.antigo, c.novo)
  from _codigo c where n.titulo like '%' || c.antigo || '%';

update public.notificacoes n set mensagem = replace(n.mensagem, c.antigo, c.novo)
  from _codigo c where n.mensagem like '%' || c.antigo || '%';

update public.solicitacoes s
   set codigo = c.novo,
       comprovante = case when s.comprovante is null then null
                          else replace(s.comprovante::text, c.antigo, c.novo)::jsonb end
  from _codigo c where s.id = c.id;

-- 4) a próxima continua a numeração (PLN-AAAA-0001 se não sobrou nenhuma)
select setval('public.seq_solicitacao', greatest(x.ultimo, 1), x.ultimo > 0)
  from (select coalesce(max(substring(codigo from '(\d+)$')::int), 0) as ultimo
          from public.solicitacoes where codigo like 'PLN-%') x;

commit;

-- conferência
select codigo, status, created_at::date from public.solicitacoes order by created_at;
