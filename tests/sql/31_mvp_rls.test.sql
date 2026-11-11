-- Testes do sql/31 (RLS de mentor, pedidos do orçamento, crédito, limites).
-- Roda com `npm run test:sql` (tools/testar-sql.mjs) num Postgres local descartável.
-- Cada bloco "como(...)" troca para o papel authenticated com o usuário do token, igual ao Supabase.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'FALHOU: %', msg; end if; end $$;

-- espera que o comando dê erro (e, se informado, que a mensagem contenha o trecho)
create function pg_temp.falha(cmd text, trecho text, msg text) returns void language plpgsql as $$
declare v_erro text;
begin
  begin execute cmd; exception when others then v_erro := sqlerrm; end;
  if v_erro is null then raise exception 'FALHOU (deveria dar erro): %', msg; end if;
  if trecho is not null and position(lower(trecho) in lower(v_erro)) = 0 then
    raise exception 'FALHOU: % — erro inesperado: %', msg, v_erro;
  end if;
end $$;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- ---------------------------------------------------------------- cenário
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000001', 'ana@ex.com',  '{"nome":"Ana Dona","aceite_termos_em":"x"}'),
  ('b0000000-0000-4000-8000-000000000002', 'bia@ex.com',  '{"nome":"Bia Mentora","aceite_termos_em":"x"}'),
  ('c0000000-0000-4000-8000-000000000003', 'caio@ex.com', '{"nome":"Caio Mentor","aceite_termos_em":"x"}'),
  ('d0000000-0000-4000-8000-000000000004', 'dani@ex.com', '{"nome":"Dani Cliente","aceite_termos_em":"x"}'),
  ('e0000000-0000-4000-8000-000000000005', 'adm@ex.com',  '{"nome":"Adm","aceite_termos_em":"x"}');
update public.profiles set role = 'admin' where email = 'adm@ex.com';

select pg_temp.ok((select count(*) from public.profiles where cadastro_concluido_em is not null) = 5, 'cadastro cria 5 perfis concluídos');
select pg_temp.ok((select count(*) from public.profiles where role = 'cliente') = 4, 'o cadastro sempre cria cliente');

insert into public.jornadas (id, cliente_id, titulo) values
  ('11111111-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Agenda de salão'),
  ('11111111-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Segundo projeto da Ana');
insert into public.jornada_modulos (jornada_id, modulo, status, respostas) values
  ('11111111-0000-4000-8000-000000000001', 'bases-projeto', 'aprovado', '{"slogan":"x"}'),
  ('11111111-0000-4000-8000-000000000001', 'proposta-valor', 'enviado', '{"problema":"y"}');
insert into public.jornada_orcamentos (id, jornada_id, dados, valor_min, valor_max) values
  ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', '{"resumo":"r"}', 1000, 1300);

-- ---------------------------------------------------------------- mentor: pedido e aprovação
set role authenticated;
select pg_temp.como('b0000000-0000-4000-8000-000000000002');
select public.pedir_mentoria('Sou mentora de startups');
select pg_temp.falha($$select public.pedir_mentoria('de novo')$$, 'em análise', 'segundo pedido pendente é recusado');
select pg_temp.falha($$select public.admin_decidir_mentoria((select id from public.mentor_requests limit 1), true)$$, 'Apenas administradores', 'quem não é admin não aprova');
select pg_temp.falha($$insert into public.user_roles (user_id, role) values (auth.uid(), 'mentor')$$, 'permission denied', 'ninguém se dá a permissão de mentor');
select pg_temp.falha($$update public.profiles set role = 'admin' where id = auth.uid()$$, 'permission denied', 'cliente não muda o próprio papel');
select pg_temp.ok(not public.is_mentor(), 'pedido pendente ainda não é mentor');
select pg_temp.como('c0000000-0000-4000-8000-000000000003');
select public.pedir_mentoria(null);
select pg_temp.ok((select count(*) from public.mentor_requests) = 1, 'cada um só vê o próprio pedido');

select pg_temp.como('e0000000-0000-4000-8000-000000000005');
select pg_temp.ok((select count(*) from public.admin_listar_mentoria('pending')) = 2, 'admin lista os pedidos pendentes');
select public.admin_decidir_mentoria(id, true) from public.mentor_requests;
select pg_temp.falha($$select public.admin_decidir_mentoria((select id from public.mentor_requests limit 1), false)$$, 'já foi decidido', 'pedido decidido não muda');
select pg_temp.ok(public.is_mentor('b0000000-0000-4000-8000-000000000002') and public.is_mentor('c0000000-0000-4000-8000-000000000003'), 'aprovação concede a permissão');
select pg_temp.ok((select role from public.profiles where id = 'b0000000-0000-4000-8000-000000000002') = 'cliente', 'mentor continua cliente (profiles.role intacto)');

-- ---------------------------------------------------------------- compartilhamento (só Bia, no projeto 1)
select pg_temp.como('a0000000-0000-4000-8000-000000000001');
select pg_temp.falha($$select public.compartilhar_projeto('11111111-0000-4000-8000-000000000001', 'dani@ex.com')$$, 'Não encontramos um mentor', 'não compartilha com quem não é mentor');
select pg_temp.falha($$select public.compartilhar_projeto('11111111-0000-4000-8000-000000000001', 'naoexiste@ex.com')$$, 'Não encontramos um mentor', 'e-mail inexistente: mesma mensagem');
select public.compartilhar_projeto('11111111-0000-4000-8000-000000000001', ' BIA@ex.com ');
select public.compartilhar_projeto('11111111-0000-4000-8000-000000000001', 'bia@ex.com'); -- repetir não duplica
select pg_temp.ok((select count(*) from public.mvp_project_shares) = 1, 'compartilhar 2x não duplica');
select pg_temp.ok((select count(*) from public.mentores_do_projeto('11111111-0000-4000-8000-000000000001')) = 1, 'dono vê com quem compartilhou');
select pg_temp.falha($$insert into public.mvp_project_shares (project_id, owner_user_id, mentor_user_id) values ('11111111-0000-4000-8000-000000000002', auth.uid(), 'c0000000-0000-4000-8000-000000000003')$$, 'permission denied', 'compartilhamento só pela função');

select pg_temp.como('d0000000-0000-4000-8000-000000000004');
select pg_temp.falha($$select public.compartilhar_projeto('11111111-0000-4000-8000-000000000001', 'caio@ex.com')$$, 'Projeto não encontrado', 'só o dono compartilha');

-- ---------------------------------------------------------------- leitura: Bia (com compartilhamento)
select pg_temp.como('b0000000-0000-4000-8000-000000000002');
select pg_temp.ok((select count(*) from public.jornadas) = 1, 'mentor com compartilhamento lê só o projeto compartilhado');
select pg_temp.ok((select count(*) from public.jornada_modulos) = 2, 'mentor lê os módulos do projeto compartilhado');
select pg_temp.ok((select count(*) from public.jornada_orcamentos) = 1, 'mentor lê o resumo do projeto compartilhado');
select pg_temp.ok((select count(*) from public.mentor_projetos()) = 1, 'painel do mentor lista 1 projeto');
select pg_temp.ok((select para_revisar from public.mentor_projetos()) = 1, 'painel mostra o módulo para revisar');
select pg_temp.ok((select count(*) from public.profiles) = 1, 'mentor não lê o perfil do dono');

-- ---------------------------------------------------------------- leitura: Caio (mentor SEM compartilhamento) = nada
select pg_temp.como('c0000000-0000-4000-8000-000000000003');
select pg_temp.ok((select count(*) from public.jornadas) = 0, 'mentor sem compartilhamento não lê projetos');
select pg_temp.ok((select count(*) from public.jornada_modulos) = 0, 'mentor sem compartilhamento não lê módulos');
select pg_temp.ok((select count(*) from public.jornada_orcamentos) = 0, 'mentor sem compartilhamento não lê orçamento');
select pg_temp.ok((select count(*) from public.mvp_project_shares) = 0, 'mentor sem compartilhamento não vê compartilhamentos');
select pg_temp.ok((select count(*) from public.mentor_projetos()) = 0, 'painel do mentor vazio sem compartilhamento');
select pg_temp.falha($$insert into public.mvp_mentor_comments (project_id, body) values ('11111111-0000-4000-8000-000000000001', 'oi')$$, 'row-level security', 'mentor sem compartilhamento não comenta');
select pg_temp.falha($$select public.mentores_do_projeto('11111111-0000-4000-8000-000000000001')$$, 'Projeto não encontrado', 'mentor não lista mentores de projeto alheio');

-- cliente comum (Dani) também não vê nada da Ana
select pg_temp.como('d0000000-0000-4000-8000-000000000004');
select pg_temp.ok((select count(*) from public.jornadas) = 0 and (select count(*) from public.jornada_orcamentos) = 0, 'cliente não lê projeto de outro');
select pg_temp.ok((select count(*) from public.mentor_projetos()) = 0, 'cliente sem permissão: painel do mentor vazio');

-- ---------------------------------------------------------------- comentários
select pg_temp.como('b0000000-0000-4000-8000-000000000002');
insert into public.mvp_mentor_comments (project_id, modulo, body) values ('11111111-0000-4000-8000-000000000001', 'proposta-valor', 'Detalhe melhor o problema.');
select pg_temp.falha($$insert into public.mvp_mentor_comments (project_id, author_id, body) values ('11111111-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'falso')$$, 'permission denied', 'não dá para comentar em nome de outro');
select pg_temp.falha($$update public.mvp_mentor_comments set body = 'mudado'$$, 'permission denied', 'comentário não é editável');
select pg_temp.como('a0000000-0000-4000-8000-000000000001');
insert into public.mvp_mentor_comments (project_id, body) values ('11111111-0000-4000-8000-000000000001', 'Obrigada!');
select pg_temp.falha($$insert into public.mvp_mentor_comments (project_id, body) values ('11111111-0000-4000-8000-000000000002', 'sem mentor')$$, 'row-level security', 'sem compartilhamento não há conversa');
select pg_temp.ok((select count(*) from public.mvp_mentor_comments) = 2, 'dono lê os comentários do projeto');
select pg_temp.ok((select author_nome from public.mvp_mentor_comments where body = 'Obrigada!') = 'Ana', 'autor preenchido pelo banco');
select pg_temp.como('c0000000-0000-4000-8000-000000000003');
select pg_temp.ok((select count(*) from public.mvp_mentor_comments) = 0, 'mentor sem compartilhamento não lê comentários');

-- ---------------------------------------------------------------- pedidos do orçamento: dono vê, mentor não
reset role;
insert into public.pagamentos (id, cliente_id, descricao, valor) values
  ('33333333-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Orçamento detalhado do MVP', 30);
insert into public.mvp_budget_orders (id, user_id, project_id, orcamento_id, price_brl, pagamento_id) values
  ('44444444-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
   '22222222-0000-4000-8000-000000000001', 30, '33333333-0000-4000-8000-000000000001');
select pg_temp.falha($$insert into public.mvp_budget_orders (user_id, project_id, price_brl) values ('a0000000-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 30)$$, 'uq_mvp_order_aberto', 'um pedido em aberto por projeto');
insert into public.mvp_budget_generations (order_id, provider, model, input_tokens, output_tokens, cost_usd, cost_brl)
values ('44444444-0000-4000-8000-000000000001', 'anthropic', 'modelo-x', 1000, 2000, 0.044, 0.24);

set role authenticated;
select pg_temp.como('a0000000-0000-4000-8000-000000000001');
select pg_temp.ok((select count(*) from public.mvp_budget_orders) = 1, 'dono vê o próprio pedido');
select pg_temp.ok((select count(*) from public.mvp_budget_generations) = 0, 'cliente não vê custo de IA');
select pg_temp.falha($$select * from public.vw_mvp_margem$$, 'permission denied', 'cliente não lê a margem');
select pg_temp.falha($$select * from public.admin_mvp_margem()$$, 'Apenas administradores', 'só admin consulta a margem');
select pg_temp.falha($$update public.mvp_budget_orders set status = 'paid'$$, 'permission denied', 'cliente não altera o pedido');
update public.mvp_pricing_config set price_brl = 1; -- RLS: 0 linhas para quem não é admin
reset role;
select pg_temp.ok((select price_brl from public.mvp_pricing_config) = 30, 'preço continua 30');
set role authenticated;
select pg_temp.ok((select price_brl from public.mvp_pricing_config) = 30, 'logado lê o preço (R$ 30)');
select pg_temp.falha($$select public.aplicar_pagamento_mp('33333333-0000-4000-8000-000000000001', '1', 'approved', null, 'pix', 30, 'BRL', now(), 'teste')$$, 'permission denied', 'cliente não confirma pagamento');
select pg_temp.falha($$select * from public.mvp_reservar_geracao('44444444-0000-4000-8000-000000000001')$$, 'permission denied', 'cliente não dispara geração direto no banco');
select pg_temp.falha($$select public.consumir_limite('x', 1, 60)$$, 'permission denied', 'cliente não mexe no limite');

select pg_temp.como('b0000000-0000-4000-8000-000000000002');
select pg_temp.ok((select count(*) from public.mvp_budget_orders) = 0, 'mentor não vê pedido nem PDF do projeto compartilhado');

select pg_temp.como('e0000000-0000-4000-8000-000000000005');
select pg_temp.ok((select count(*) from public.mvp_budget_orders) = 1 and (select count(*) from public.mvp_budget_generations) = 1, 'admin vê pedidos e custos');

reset role;
set role anon;
select pg_temp.como(null);
select pg_temp.ok((select count(*) from public.jornadas) = 0, 'anônimo não lê projetos');
select pg_temp.falha($$select * from public.mvp_budget_orders$$, 'permission denied', 'anônimo não lê pedidos');
select pg_temp.falha($$select * from public.mvp_pricing_config$$, 'permission denied', 'anônimo não lê a configuração');

-- ---------------------------------------------------------------- pagamento -> pedido (service_role, igual ao webhook)
reset role;
set role service_role;
select pg_temp.ok(public.aplicar_pagamento_mp('33333333-0000-4000-8000-000000000001', '9001', 'pending', null, 'pix', 30, 'BRL', null, 'webhook') = 'sem_alteracao', 'pix pendente não libera');
select pg_temp.ok((select status from public.mvp_budget_orders) = 'pending_payment', 'pedido segue aguardando');
select pg_temp.ok(public.aplicar_pagamento_mp('33333333-0000-4000-8000-000000000001', '9001', 'approved', null, 'pix', 29.99, 'BRL', now(), 'webhook') = 'valor_divergente', 'valor diferente não libera');
select pg_temp.ok((select status from public.mvp_budget_orders) = 'pending_payment', 'valor divergente mantém o pedido');
select pg_temp.ok(public.aplicar_pagamento_mp('33333333-0000-4000-8000-000000000001', '9001', 'approved', null, 'pix', 30, 'BRL', now(), 'webhook') = 'pago', 'aprovado libera');
select pg_temp.ok((select status = 'paid' and mp_payment_id = '9001' and paid_at is not null from public.mvp_budget_orders), 'pedido vira paid');
select pg_temp.ok(public.aplicar_pagamento_mp('33333333-0000-4000-8000-000000000001', '9001', 'approved', null, 'pix', 30, 'BRL', now(), 'webhook') = 'ja_processado', 'aviso repetido é idempotente');

-- geração: reserva atômica, falhas e tentativas
select pg_temp.ok((select count(*) from public.mvp_reservar_geracao('44444444-0000-4000-8000-000000000001')) = 1, 'primeira reserva pega o pedido');
select pg_temp.ok((select count(*) from public.mvp_reservar_geracao('44444444-0000-4000-8000-000000000001')) = 0, 'segunda reserva simultânea não pega');
select pg_temp.ok((select status from public.mvp_falhar_geracao('44444444-0000-4000-8000-000000000001', 'timeout')) = 'paid', 'falha 1: volta para nova tentativa');
select public.mvp_reservar_geracao('44444444-0000-4000-8000-000000000001');
select public.mvp_falhar_geracao('44444444-0000-4000-8000-000000000001', 'timeout');
select public.mvp_reservar_geracao('44444444-0000-4000-8000-000000000001');
select pg_temp.ok((select status from public.mvp_falhar_geracao('44444444-0000-4000-8000-000000000001', 'timeout')) = 'failed', 'falha 3: failed');
select pg_temp.ok((select count(*) from public.mvp_reservar_geracao('44444444-0000-4000-8000-000000000001')) = 0, 'failed não é reservado');
select pg_temp.ok((select count(*) from public.mvp_liberar_tentativa('44444444-0000-4000-8000-000000000001', false)) = 1, 'cliente libera uma nova tentativa');
select pg_temp.ok((select count(*) from public.mvp_reservar_geracao('44444444-0000-4000-8000-000000000001')) = 1, 'nova tentativa reservada');
select public.mvp_falhar_geracao('44444444-0000-4000-8000-000000000001', 'timeout');
select pg_temp.ok((select status from public.mvp_budget_orders) = 'failed', 'falhou de novo');
select pg_temp.ok((select count(*) from public.mvp_liberar_tentativa('44444444-0000-4000-8000-000000000001', false)) = 0, 'cliente só libera 1 vez');
select pg_temp.ok((select count(*) from public.mvp_liberar_tentativa('44444444-0000-4000-8000-000000000001', true)) = 1, 'admin libera de novo');
select public.mvp_reservar_geracao('44444444-0000-4000-8000-000000000001');
select pg_temp.ok((select status = 'ready' and valid_until is not null from public.mvp_concluir_geracao('44444444-0000-4000-8000-000000000001', 'a/b.pdf')), 'concluído: ready com validade');
select pg_temp.ok((select count(*) from public.mvp_concluir_geracao('44444444-0000-4000-8000-000000000001', 'outro.pdf')) = 0, 'concluir de novo não muda nada');

-- crédito: contratação abate o valor do orçamento e consome o crédito no pagamento
insert into public.pagamentos (id, cliente_id, descricao, valor, credito_mvp, credito_order_id) values
  ('33333333-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Projeto', 3960, 30, '44444444-0000-4000-8000-000000000001');
select pg_temp.ok(public.aplicar_pagamento_mp('33333333-0000-4000-8000-000000000002', '9002', 'approved', null, 'cartao', 3960, 'BRL', now(), 'webhook') = 'pago', 'contratação paga');
select pg_temp.ok((select credito_usado_em is not null and credito_pagamento_id = '33333333-0000-4000-8000-000000000002' from public.mvp_budget_orders), 'crédito consumido');
select pg_temp.ok(public.aplicar_pagamento_mp('33333333-0000-4000-8000-000000000002', '9002', 'refunded', null, 'cartao', 3960, 'BRL', null, 'webhook') = 'reembolsado', 'contratação estornada');
select pg_temp.ok((select credito_usado_em is null from public.mvp_budget_orders), 'estorno devolve o crédito');

-- estorno do próprio orçamento
select pg_temp.ok(public.aplicar_pagamento_mp('33333333-0000-4000-8000-000000000001', '9001', 'refunded', null, 'pix', 30, 'BRL', null, 'webhook') = 'reembolsado', 'orçamento estornado');
select pg_temp.ok((select status = 'refunded' and refunded_at is not null from public.mvp_budget_orders), 'pedido vira refunded');
select pg_temp.ok((select receita_brl = 0 and custo_brl = 0.24 from public.vw_mvp_margem), 'margem: estornado não conta receita, custo fica');

-- limite
select pg_temp.ok(public.consumir_limite('teste', 2, 60) and public.consumir_limite('teste', 2, 60) and not public.consumir_limite('teste', 2, 60), 'limite: 2 passam, o 3º não');

-- ---------------------------------------------------------------- revogar
reset role;
set role authenticated;
select pg_temp.como('a0000000-0000-4000-8000-000000000001');
select public.revogar_compartilhamento('11111111-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002');
select pg_temp.ok((select status from public.jornada_modulos where modulo = 'proposta-valor') = 'aprovado', 'sem mentor, o que esperava revisão fica aprovado');
select pg_temp.como('b0000000-0000-4000-8000-000000000002');
select pg_temp.ok((select count(*) from public.jornadas) = 0 and (select count(*) from public.mvp_mentor_comments) = 0, 'depois de revogado, o mentor perde o acesso');

-- admin tira a permissão: o compartilhamento existe mas não vale mais
select pg_temp.como('a0000000-0000-4000-8000-000000000001');
select public.compartilhar_projeto('11111111-0000-4000-8000-000000000001', 'bia@ex.com');
select pg_temp.como('e0000000-0000-4000-8000-000000000005');
select public.admin_revogar_mentor('b0000000-0000-4000-8000-000000000002');
select pg_temp.como('b0000000-0000-4000-8000-000000000002');
select pg_temp.ok((select count(*) from public.jornadas) = 0, 'sem a permissão de mentor, o compartilhamento não dá acesso');
reset role;

select 'ok: ' || 'todas as verificações do sql/31 passaram' as resultado;
