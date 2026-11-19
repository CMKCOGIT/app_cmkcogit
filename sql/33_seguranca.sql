-- =====================================================================
-- 33_seguranca.sql — Fase 3 da auditoria (segurança). Rode depois do 32.
-- Pode rodar mais de uma vez. Não apaga dados e não muda nenhuma tela.
--
--  1. Limite de requisições (rate limit) das rotas /api: tabela rate_limits + consumir_limite
--     (já existiam no banco de produção, mas não no repositório).
--  2. Pagamento só é confirmado pelo SERVIDOR (Mercado Pago): ninguém logado — nem admin —
--     marca cobrança como paga, troca o id do Mercado Pago ou põe solicitação em "paga" pela API.
--  3. Registro de auditoria das alterações feitas por administradores (admin_auditoria).
--  4. Avisos do Supabase (advisors): search_path fixo nas funções e funções de gatilho
--     fora da API pública; preparar_quadro só pelo gatilho.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Rate limit (usado por lib/limite.js, sempre pelo servidor / service_role)
-- ---------------------------------------------------------------------
create table if not exists public.rate_limits (
  chave         text        not null,
  janela_inicio timestamptz not null,
  contador      integer     not null default 0,
  primary key (chave, janela_inicio)
);
alter table public.rate_limits enable row level security;   -- sem políticas: só o servidor acessa

create or replace function public.consumir_limite(p_chave text, p_max integer, p_janela_seg integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_janela timestamptz := to_timestamp(floor(extract(epoch from now()) / greatest(p_janela_seg, 1)) * greatest(p_janela_seg, 1));
  v_cont int;
begin
  if p_chave is null or char_length(p_chave) > 200 then raise exception 'chave inválida'; end if;
  insert into public.rate_limits as r (chave, janela_inicio, contador) values (p_chave, v_janela, 1)
  on conflict (chave, janela_inicio) do update set contador = r.contador + 1
  returning contador into v_cont;
  if random() < 0.02 then delete from public.rate_limits where janela_inicio < now() - interval '2 days'; end if;
  return v_cont <= p_max;
end;
$$;

revoke all on function public.consumir_limite(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consumir_limite(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------
-- 2. Confirmação de pagamento só pelo servidor
--    "Quem está logado" = papel authenticated/anon no token (API do Supabase pelo navegador).
--    O servidor (service_role: webhook, verificação, cron) e o SQL Editor continuam livres.
-- ---------------------------------------------------------------------
create or replace function public.papel_da_requisicao()
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '');
$$;

create or replace function public.proteger_confirmacao_pagamento()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.papel_da_requisicao() not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pendente' or new.mp_payment_id is not null or new.pago_em is not null then
      raise exception 'Cobrança nova começa pendente; a confirmação vem do Mercado Pago.' using errcode = '42501';
    end if;
  elsif (new.status is distinct from old.status and new.status in ('pago', 'reembolsado'))
     or (old.status in ('pago', 'reembolsado') and new.status is distinct from old.status)
     or new.mp_payment_id is distinct from old.mp_payment_id
     or new.pago_em is distinct from old.pago_em
     or (old.status = 'pago' and new.valor is distinct from old.valor) then
    raise exception 'Pagamento só é confirmado (ou desfeito) pelo Mercado Pago, no servidor.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_confirmacao_pagamento on public.pagamentos;
create trigger trg_proteger_confirmacao_pagamento
  before insert or update on public.pagamentos
  for each row execute function public.proteger_confirmacao_pagamento();

create or replace function public.proteger_solicitacao_paga()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.papel_da_requisicao() not in ('authenticated', 'anon') then return new; end if;
  if (tg_op = 'INSERT' and (new.status = 'paga' or new.projeto_id is not null))
     or (tg_op = 'UPDATE' and ((new.status is distinct from old.status and (new.status = 'paga' or old.status = 'paga'))
                               or new.projeto_id is distinct from old.projeto_id)) then
    raise exception 'A solicitação só vira "paga" pela confirmação do Mercado Pago.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_solicitacao_paga on public.solicitacoes;
create trigger trg_proteger_solicitacao_paga
  before insert or update on public.solicitacoes
  for each row execute function public.proteger_solicitacao_paga();

create or replace function public.proteger_status_pagamento_projeto()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.papel_da_requisicao() not in ('authenticated', 'anon') then return new; end if;
  if (tg_op = 'INSERT' and new.status_pagamento in ('pago', 'parcial', 'reembolsado'))
     or (tg_op = 'UPDATE' and new.status_pagamento is distinct from old.status_pagamento) then
    raise exception 'A situação do pagamento do projeto vem das cobranças (Mercado Pago).' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_status_pagamento_projeto on public.projetos;
create trigger trg_proteger_status_pagamento_projeto
  before insert or update on public.projetos
  for each row execute function public.proteger_status_pagamento_projeto();

-- ---------------------------------------------------------------------
-- 3. Auditoria do admin: toda alteração feita por um administrador logado
--    (telas do admin / RPCs admin_*) nas tabelas abaixo. O que passa pelas rotas
--    /api do admin já fica, com nome e data, em solicitacao_eventos.
--    CPF/CNPJ nunca é gravado aqui (só "alterado").
-- ---------------------------------------------------------------------
create table if not exists public.admin_auditoria (
  id          bigserial primary key,
  admin_id    uuid references public.profiles(id) on delete set null,
  tabela      text not null,
  operacao    text not null check (operacao in ('INSERT', 'UPDATE', 'DELETE')),
  registro_id text,
  alteracoes  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_admin_auditoria_data   on public.admin_auditoria(created_at desc);
create index if not exists idx_admin_auditoria_alvo   on public.admin_auditoria(tabela, registro_id, created_at desc);
create index if not exists idx_admin_auditoria_admin  on public.admin_auditoria(admin_id, created_at desc);

alter table public.admin_auditoria enable row level security;
drop policy if exists "admin_auditoria_ler" on public.admin_auditoria;
create policy "admin_auditoria_ler" on public.admin_auditoria for select using (public.is_admin());
revoke insert, update, delete on public.admin_auditoria from anon, authenticated;   -- ninguém apaga o rastro

create or replace function public.auditar_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_ant  jsonb;
  v_novo jsonb;
  v_dif  jsonb;
begin
  if v_uid is null or not public.is_admin() then return null; end if;
  v_ant  := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_novo := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, case when k = 'documento' then '"alterado"'::jsonb
                                    else jsonb_build_object('de', v_ant -> k, 'para', v_novo -> k) end)
      into v_dif
      from jsonb_object_keys(v_novo) as k
     where (v_ant -> k) is distinct from (v_novo -> k) and k not in ('updated_at');
    if v_dif is null then return null; end if;
  else
    v_dif := coalesce(v_novo, v_ant) - 'documento';
  end if;
  insert into public.admin_auditoria (admin_id, tabela, operacao, registro_id, alteracoes)
  values (v_uid, tg_table_name, tg_op, coalesce(v_novo ->> 'id', v_ant ->> 'id'), v_dif);
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['projetos', 'pagamentos', 'solicitacoes', 'pendencias', 'profiles', 'catalogo_precos',
                           'funcionalidades', 'projeto_funcionalidades', 'arquivos', 'assinaturas'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_auditar_admin on public.%I', t);
      execute format('create trigger trg_auditar_admin after insert or update or delete on public.%I
                        for each row execute function public.auditar_admin()', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Avisos do Supabase
-- ---------------------------------------------------------------------
-- 4a. search_path fixo (function_search_path_mutable)
do $$
declare f text;
begin
  foreach f in array array['public.touch_updated_at()', 'public.somar_dias_uteis(date, integer)', 'public.nome_inicial(jsonb, text)',
                           'public.prazo_estimado_dias(jsonb)', 'public.projetos_marcar_conclusao()', 'public.brl_texto(numeric)',
                           'public.documento_valido(text)', 'public.proximo_periodo(date, text)', 'public.texto_aceite_termos()',
                           'public.versao_termos_vigente()'] loop
    if to_regprocedure(f) is not null then
      execute format('alter function %s set search_path = public', f);
    end if;
  end loop;
end $$;

-- 4b. Funções de gatilho não são chamadas pela API (/rest/v1/rpc/...): o gatilho continua
--     funcionando, só some a porta pública (anon_/authenticated_security_definer_function_executable).
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prorettype = 'trigger'::regtype loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.f);
  end loop;
end $$;

-- 4c. preparar_quadro é chamada só pelos gatilhos de quadros (como dono da função)
do $$
begin
  if to_regprocedure('public.preparar_quadro(uuid)') is not null then
    revoke execute on function public.preparar_quadro(uuid) from public, anon, authenticated;
  end if;
end $$;

-- 4d. admin_decidir_solicitacao é o caminho ANTIGO de aprovação (antes do sql/32): aprova sem
--     histórico e sem encerrar o link antigo no Mercado Pago. Nenhuma tela usa mais; sai da API.
do $$
begin
  if to_regprocedure('public.admin_decidir_solicitacao(uuid, text, numeric, text)') is not null then
    revoke execute on function public.admin_decidir_solicitacao(uuid, text, numeric, text) from public, anon, authenticated;
  end if;
end $$;

-- 4e. A proteção contra senhas vazadas (HaveIBeenPwned) é ligada no painel:
--     Authentication -> Sign In / Providers -> Email -> "Prevent use of leaked passwords".

-- ---------------------------------------------------------------------
-- Conferência (só leitura)
-- ---------------------------------------------------------------------
select 'gatilhos de proteção' as item,
       count(*) filter (where tgname in ('trg_proteger_confirmacao_pagamento', 'trg_proteger_solicitacao_paga', 'trg_proteger_status_pagamento_projeto')) as total
  from pg_trigger
union all
select 'tabelas com auditoria do admin', count(*) from pg_trigger where tgname = 'trg_auditar_admin'
union all
select 'rate limit disponível', count(*) from pg_proc where proname = 'consumir_limite';
