-- =====================================================================
-- 13_painel_admin.sql — rode DEPOIS do 01 → 12. Pode rodar mais de uma vez.
--   1. Projetos: % de progresso definida pelo admin e data de conclusão.
--   2. admin_atualizar_andamento(): admin muda % e status até concluir.
--   3. Dashboard do admin: admin_vendas_periodo() e admin_dashboard()
--      (tudo agregado no banco; faturamento = só pagamentos confirmados).
--   4. Notificações genéricas: metadados, lida_em e tempo real.
-- Rode ANTES de publicar a versão do app com o painel de gestão.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PROJETOS: progresso e conclusão
--    progresso NULL = calculado pelas etapas (comportamento antigo).
-- ---------------------------------------------------------------------
alter table public.projetos add column if not exists progresso    int;
alter table public.projetos add column if not exists concluido_em timestamptz;

alter table public.projetos drop constraint if exists projetos_progresso_check;
alter table public.projetos add constraint projetos_progresso_check check (progresso is null or progresso between 0 and 100);

-- Projetos já concluídos: a data de conclusão é a da última etapa fechada
-- (gravada por admin_atualizar_projeto); sem etapa datada, a última atualização.
update public.projetos p
   set concluido_em = coalesce(
         (select max(e.data_concluida)::timestamptz from public.projeto_etapas e where e.projeto_id = p.id),
         p.updated_at)
 where p.status_projeto = 'concluido' and p.concluido_em is null;

-- Concluído = 100% com data registrada; reabrir limpa a data.
create or replace function public.projetos_marcar_conclusao()
returns trigger
language plpgsql
as $$
begin
  if new.status_projeto = 'concluido' then
    new.progresso := 100;
    new.concluido_em := coalesce(new.concluido_em, now());
  else
    new.concluido_em := null;
    -- reaberto: o 100% manual não vale mais, volta a seguir as etapas
    if tg_op = 'UPDATE' and old.status_projeto = 'concluido' and new.progresso = 100 then
      new.progresso := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projetos_conclusao on public.projetos;
create trigger trg_projetos_conclusao before insert or update on public.projetos
  for each row execute function public.projetos_marcar_conclusao();

-- Mesma função do 08; agora mudar a etapa descarta o % manual (o % volta a seguir as etapas).
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
    progresso        = case when p_etapa is not null and p_etapa is distinct from etapa_atual then null else progresso end,
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

-- ---------------------------------------------------------------------
-- 2. admin_atualizar_andamento(): % e status (100% = concluído)
-- ---------------------------------------------------------------------
create or replace function public.admin_atualizar_andamento(
  p_id        uuid,
  p_progresso int  default null,
  p_status    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proj   public.projetos%rowtype;
  v_status text;
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  select * into v_proj from public.projetos where id = p_id for update;
  if not found then raise exception 'Projeto não encontrado'; end if;
  if p_progresso is not null and (p_progresso < 0 or p_progresso > 100) then raise exception 'Progresso deve ser de 0 a 100'; end if;
  if p_status is not null and p_status not in ('em_andamento','aguardando_cliente','concluido','pausado','cancelado') then
    raise exception 'Status inválido';
  end if;

  v_status := case
    when p_progresso = 100 or p_status = 'concluido' then 'concluido'
    when v_proj.status_projeto = 'concluido' and p_status is null and p_progresso is not null then 'em_andamento' -- reabrindo pela %
    else coalesce(p_status, v_proj.status_projeto) end;

  update public.projetos set
    status_projeto = v_status,
    progresso      = case when v_status = 'concluido' then 100 else coalesce(p_progresso, progresso) end,
    etapa_atual    = case when v_status = 'concluido' then 8 else etapa_atual end
  where id = p_id;

  -- etapas acompanham (concluir fecha as 8; reabrir volta a etapa atual para "em andamento")
  perform public.admin_atualizar_projeto(p_id);

  select * into v_proj from public.projetos where id = p_id;
  return jsonb_build_object('id', v_proj.id, 'progresso', v_proj.progresso, 'status_projeto', v_proj.status_projeto,
                            'concluido_em', v_proj.concluido_em, 'etapa_atual', v_proj.etapa_atual);
end;
$$;

revoke all on function public.admin_atualizar_andamento(uuid, int, text) from public, anon;
grant execute on function public.admin_atualizar_andamento(uuid, int, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. DASHBOARD — datas no fuso de Brasília. Venda = pagamento "pago".
--    Solução de cada venda: funcionalidade extra (nome do catálogo) ou o
--    item principal da solicitação do site (o mesmo que dá nome ao projeto).
-- ---------------------------------------------------------------------
-- R$ 1.234,56 (texto do feed de atividades)
create or replace function public.brl_texto(p_valor numeric)
returns text
language sql
immutable
as $$
  select 'R$ ' || replace(replace(replace(to_char(coalesce(p_valor, 0), 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.');
$$;

create or replace function public.admin_vendas_periodo(p_inicio date, p_fim date)
returns table (
  pagamento_id  uuid,
  pago_em       timestamptz,
  cliente_id    uuid,
  cliente_nome  text,
  cliente_email text,
  descricao     text,
  solucao       text,
  categoria     text,
  metodo        text,
  valor         numeric,
  projeto_id    uuid,
  projeto_codigo text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio then raise exception 'Período inválido'; end if;
  return query
    select pg.id, pg.pago_em, pg.cliente_id, pr.nome, pr.email, pg.descricao,
           case
             when pg.projeto_funcionalidade_id is not null then coalesce(f.nome, 'Funcionalidade extra')
             when s.id is not null then coalesce(s.resumo->'itens'->0->>'nome', 'Solução sob medida')
             else 'Outros' end,
           case when pg.projeto_funcionalidade_id is not null then 'funcionalidade' else 'solucao' end,
           pg.metodo, pg.valor, pg.projeto_id, pj.codigo
      from public.pagamentos pg
      left join public.profiles pr on pr.id = pg.cliente_id
      left join public.projeto_funcionalidades pf on pf.id = pg.projeto_funcionalidade_id
      left join public.funcionalidades f on f.id = pf.funcionalidade_id
      left join public.solicitacoes s on s.id = pg.solicitacao_id
      left join public.projetos pj on pj.id = pg.projeto_id
     where pg.status = 'pago'
       and pg.pago_em >= (p_inicio::timestamp at time zone 'America/Sao_Paulo')
       and pg.pago_em <  ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo')
     order by pg.pago_em desc;
end;
$$;

revoke all on function public.admin_vendas_periodo(date, date) from public, anon;
grant execute on function public.admin_vendas_periodo(date, date) to authenticated;


create or replace function public.admin_dashboard(p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz    constant text := 'America/Sao_Paulo';
  v_hoje  date := (now() at time zone 'America/Sao_Paulo')::date;
  v_dias  int;
  v_gran  text;
  v_ini   timestamptz;
  v_fim   timestamptz;
  v_res   jsonb;
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio then raise exception 'Período inválido'; end if;
  v_dias := p_fim - p_inicio + 1;
  if v_dias > 1831 then raise exception 'Escolha um período de até 5 anos'; end if;
  v_gran := case when v_dias <= 62 then 'day' when v_dias <= 210 then 'week' else 'month' end;
  v_ini  := p_inicio::timestamp at time zone v_tz;
  v_fim  := (p_fim + 1)::timestamp at time zone v_tz;

  with
  vendas   as (select * from public.admin_vendas_periodo(p_inicio, p_fim)),
  anterior as (select * from public.admin_vendas_periodo(p_inicio - v_dias, p_inicio - 1)),
  por_solucao as (
    select solucao, categoria, count(*) as quantidade, sum(valor) as valor
      from vendas group by solucao, categoria
  ),
  serie as (
    select g::date as periodo, coalesce(sum(v.valor), 0) as valor, count(v.pagamento_id) as vendas
      from generate_series(date_trunc(v_gran, p_inicio::timestamp), p_fim::timestamp, ('1 ' || v_gran)::interval) g
      left join vendas v on date_trunc(v_gran, v.pago_em at time zone v_tz) = g
     group by g
  ),
  top_clientes as (
    select cliente_id, max(cliente_nome) as nome, max(cliente_email) as email, count(*) as compras, sum(valor) as valor
      from vendas group by cliente_id order by sum(valor) desc limit 5
  ),
  sols as (
    select count(*) as criadas, count(*) filter (where status = 'paga') as pagas
      from public.solicitacoes where created_at >= v_ini and created_at < v_fim
  ),
  pendentes as (
    select valor from public.pagamentos where status = 'pendente'
    union all
    -- liberada para pagar, mas o cliente ainda não abriu o checkout (sem cobrança criada)
    select s.valor_final from public.solicitacoes s
     where s.status = 'aguardando_pagamento' and s.valor_final > 0
       and not exists (select 1 from public.pagamentos p where p.solicitacao_id = s.id and p.status = 'pendente')
  ),
  projs as (
    select
      count(*) filter (where status_projeto not in ('concluido','cancelado'))                                    as em_andamento,
      count(*) filter (where status_projeto = 'concluido')                                                       as concluidos,
      count(*) filter (where status_projeto = 'concluido' and concluido_em >= v_ini and concluido_em < v_fim)    as concluidos_periodo,
      count(*) filter (where status_projeto not in ('concluido','cancelado') and previsao_entrega < v_hoje)      as atrasados,
      count(*) filter (where status_projeto not in ('concluido','cancelado')
                         and previsao_entrega between v_hoje and v_hoje + 7)                                     as prazo_7_dias
      from public.projetos
  ),
  atividades as (
    select * from (
      select 'pagamento'::text as tipo, pg.pago_em as quando,
             'Pagamento confirmado: ' || public.brl_texto(pg.valor) as titulo,
             coalesce(pr.nome, pr.email, 'Cliente') || ' · ' || pg.descricao as detalhe,
             case when pg.projeto_id is not null then 'projeto.html?id=' || pg.projeto_id end as link
        from public.pagamentos pg left join public.profiles pr on pr.id = pg.cliente_id
       where pg.status = 'pago' and pg.pago_em is not null
       order by pg.pago_em desc limit 10
    ) a
    union all
    select * from (
      select 'arquivo', a.created_at, 'Cliente enviou: ' || a.nome,
             coalesce(p.codigo || ' · ', '') || p.nome,
             'projeto.html?id=' || a.projeto_id || '#repositorio'
        from public.arquivos a join public.projetos p on p.id = a.projeto_id
       where a.origem = 'cliente'
       order by a.created_at desc limit 10
    ) b
    union all
    select * from (
      select 'solicitacao', s.created_at, 'Nova solicitação ' || s.codigo,
             coalesce(pr.nome, pr.email, 'Cliente') || ' · ' || coalesce(s.resumo->'itens'->0->>'nome', 'Solução'),
             'admin.html'
        from public.solicitacoes s left join public.profiles pr on pr.id = s.cliente_id
       order by s.created_at desc limit 10
    ) c
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim, 'dias', v_dias, 'granularidade', v_gran,
                                  'anterior_inicio', p_inicio - v_dias, 'anterior_fim', p_inicio - 1),
    'faturamento',          (select coalesce(sum(valor), 0) from vendas),
    'faturamento_anterior', (select coalesce(sum(valor), 0) from anterior),
    'vendas',               (select count(*) from vendas),
    'vendas_anterior',      (select count(*) from anterior),
    'solicitacoes',         (select to_jsonb(sols) from sols),
    'pendentes',            (select jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(valor), 0)) from pendentes),
    'projetos',             (select to_jsonb(projs) from projs),
    'por_solucao',          coalesce((select jsonb_agg(to_jsonb(x) order by x.valor desc, x.quantidade desc) from por_solucao x), '[]'::jsonb),
    'mais_vendido',         (select to_jsonb(x) from por_solucao x order by x.quantidade desc, x.valor desc limit 1),
    'serie',                coalesce((select jsonb_agg(to_jsonb(x) order by x.periodo) from serie x), '[]'::jsonb),
    'top_clientes',         coalesce((select jsonb_agg(to_jsonb(x) order by x.valor desc) from top_clientes x), '[]'::jsonb),
    'atividades',           coalesce((select jsonb_agg(to_jsonb(x) order by x.quando desc)
                                        from (select * from atividades order by quando desc limit 12) x), '[]'::jsonb)
  ) into v_res;

  return v_res;
end;
$$;

revoke all on function public.admin_dashboard(date, date) from public, anon;
grant execute on function public.admin_dashboard(date, date) to authenticated;

create index if not exists idx_pagamentos_pago_em on public.pagamentos(pago_em) where status = 'pago';
create index if not exists idx_solicitacoes_created on public.solicitacoes(created_at);

-- ---------------------------------------------------------------------
-- 4. NOTIFICAÇÕES genéricas (a tabela nasceu no 11)
--    id · tipo (ex.: 'compra_oferta') · titulo · mensagem · usuario_id
--    (destinatário) · lida / lida_em · created_at · metadados (jsonb livre)
--    Quem cria: os triggers do 11 e o servidor (lib/notificacoes.js,
--    createNotification). O usuário só lê e marca como lida.
-- ---------------------------------------------------------------------
alter table public.notificacoes add column if not exists metadados jsonb not null default '{}'::jsonb;
alter table public.notificacoes add column if not exists lida_em   timestamptz;

create index if not exists idx_notificacoes_nao_lidas on public.notificacoes(usuario_id) where not lida;

revoke insert, update, delete on public.notificacoes from anon, authenticated;
grant update (lida, lida_em) on public.notificacoes to authenticated;

-- Tempo real (sino atualiza na hora; sem isso o app usa só o polling)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificacoes') then
    alter publication supabase_realtime add table public.notificacoes;
  end if;
end $$;

-- conferir
select count(*) filter (where progresso is not null) as com_progresso_manual,
       count(*) filter (where status_projeto = 'concluido') as concluidos,
       count(*) filter (where status_projeto = 'concluido' and concluido_em is null) as concluidos_sem_data
  from public.projetos;
