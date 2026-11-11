-- Testes do sql/32: origem do projeto e revogação do mentor.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'FALHOU: %', msg; end if; end $$;
create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false); end $$;
grant execute on all functions in schema pg_temp to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a2000000-0000-4000-8000-000000000001', 'dono32@ex.com', '{"nome":"Dono","aceite_termos_em":"x"}'),
  ('b2000000-0000-4000-8000-000000000002', 'mentor32@ex.com', '{"nome":"Mentor","aceite_termos_em":"x"}');
insert into public.user_roles (user_id, role) values ('b2000000-0000-4000-8000-000000000002', 'mentor');
insert into public.jornadas (id, cliente_id, titulo) values ('31000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Sem origem');
select pg_temp.ok((select origem from public.jornadas where id = '31000000-0000-4000-8000-000000000001') = 'app', 'projeto antigo/sem origem = app');
insert into public.jornadas (id, cliente_id, titulo, origem) values ('31000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'Do mvp', 'mvp');
do $$ begin
  insert into public.jornadas (cliente_id, titulo, origem) values ('a2000000-0000-4000-8000-000000000001', 'x', 'outra');
  raise exception 'FALHOU: origem inválida aceita';
exception when check_violation then null; end $$;

insert into public.mvp_project_shares (project_id, owner_user_id, mentor_user_id) values
  ('31000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002');
insert into public.jornada_modulos (jornada_id, modulo, status) values ('31000000-0000-4000-8000-000000000002', 'bases-projeto', 'enviado');

set role authenticated;
select pg_temp.como('a2000000-0000-4000-8000-000000000001');
select public.revogar_compartilhamento('31000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002');
select pg_temp.ok((select status from public.jornada_modulos where jornada_id = '31000000-0000-4000-8000-000000000002') = 'enviado',
  'projeto do mvp: sem mentor, o módulo continua esperando a liberação de um mentor');
reset role;
select 'ok: todas as verificações do sql/32 passaram';
