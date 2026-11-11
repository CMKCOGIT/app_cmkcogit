-- =====================================================================
-- 31_mvp_orcamento_mentor.sql — orçamento detalhado pago (R$ 30), mentores e
-- o site mvp.cmkcogit.com.br (que usa este mesmo banco e NÃO tem migrations).
-- Rode depois do 30. Pode rodar mais de uma vez. Não apaga dados.
--
--   user_roles ............... permissões ADICIONAIS ao profiles.role (hoje: 'mentor').
--                              O profiles.role continua 'cliente' | 'admin', sem mudança.
--   mentor_requests .......... "Quero ser mentor" (só no mvp) -> admin aprova no app.
--   mvp_project_shares ....... o dono compartilha um projeto (jornada) com um mentor (LGPD:
--                              consentimento explícito, pode revogar). Sem linha aqui = sem acesso.
--   mvp_mentor_comments ...... comentários do mentor e do dono num projeto compartilhado.
--   mvp_pricing_config ....... preço do documento (R$ 30), cotação, teto de tokens, validade do crédito.
--   mvp_budget_orders ........ cada compra do documento detalhado (estados + PDF + crédito).
--   mvp_budget_generations ... custo real de IA de cada chamada (só registro; não muda preço).
--   rate_limits .............. limite por usuário/ação (consumir_limite).
--   admin_mvp_margem() ....... receita - custo por mês (para o futuro dashboard de vendas).
--
-- Mudanças no que já existe:
--   * jornadas: cada cliente pode ter VÁRIOS projetos (sai o índice único por cliente).
--   * revisão dos módulos: quem revisa é o MENTOR com quem o projeto foi compartilhado; sem
--     mentor, o módulo enviado completo já fica aprovado (o admin não revisa mais). Os módulos
--     que estavam "enviado" esperando o admin passam a "aprovado" aqui.
--   * leitura de jornadas / módulos / orçamento: + mentor com compartilhamento.
--   * solicitacoes.origem aceita 'jornada_mvp' ("Construir com a CMK Cogit").
--   * pagamentos: crédito do orçamento abatido na contratação (credito_mvp / credito_order_id).
--   * aplicar_pagamento_mp: confirma/estorna também o pedido do orçamento e consome o crédito.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Projetos (jornadas): vários por cliente
-- ---------------------------------------------------------------------
drop index if exists public.uq_jornadas_cliente;
create index if not exists idx_jornadas_cliente on public.jornadas(cliente_id, updated_at desc);

-- ---------------------------------------------------------------------
-- 1. Permissões adicionais (mentor)
-- ---------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role),
  constraint user_roles_role_check check (role in ('mentor'))
);

create or replace function public.is_mentor(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null and exists (select 1 from public.user_roles where user_id = p_user and role = 'mentor');
$$;
revoke all on function public.is_mentor(uuid) from public;
grant execute on function public.is_mentor(uuid) to authenticated, service_role;

alter table public.user_roles enable row level security;
drop policy if exists "user_roles_select" on public.user_roles;
create policy "user_roles_select" on public.user_roles
  for select using (user_id = auth.uid() or public.is_admin());
revoke all on public.user_roles from anon;
revoke insert, update, delete on public.user_roles from authenticated;
grant select on public.user_roles to authenticated;

-- ---------------------------------------------------------------------
-- 2. Limite por usuário/ação (sem Redis: janela fixa no próprio Postgres)
-- ---------------------------------------------------------------------
create table if not exists public.rate_limits (
  chave         text not null,
  janela_inicio timestamptz not null,
  contador      int not null default 0,
  primary key (chave, janela_inicio)
);
alter table public.rate_limits enable row level security;   -- sem política: só o servidor e as funções abaixo
revoke all on public.rate_limits from anon, authenticated;

-- true = pode seguir; false = passou do limite nesta janela
create or replace function public.consumir_limite(p_chave text, p_max int, p_janela_seg int)
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
revoke all on function public.consumir_limite(text, int, int) from public, anon, authenticated;
grant execute on function public.consumir_limite(text, int, int) to service_role;

-- ---------------------------------------------------------------------
-- 3. Pedidos para ser mentor (só o mvp oferece; o admin decide no app)
-- ---------------------------------------------------------------------
create table if not exists public.mentor_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'pending',
  message     text,
  created_at  timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  constraint mentor_requests_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint mentor_requests_message_check check (message is null or char_length(message) <= 1000)
);
create unique index if not exists uq_mentor_request_pendente on public.mentor_requests(user_id) where status = 'pending';
create index if not exists idx_mentor_requests_status on public.mentor_requests(status, created_at desc);

alter table public.mentor_requests enable row level security;
drop policy if exists "mentor_requests_select" on public.mentor_requests;
create policy "mentor_requests_select" on public.mentor_requests
  for select using (user_id = auth.uid() or public.is_admin());
revoke all on public.mentor_requests from anon;
revoke insert, update, delete on public.mentor_requests from authenticated;
grant select on public.mentor_requests to authenticated;

create or replace function public.pedir_mentoria(p_mensagem text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg text := nullif(trim(regexp_replace(coalesce(p_mensagem, ''), '\s+', ' ', 'g')), '');
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sua sessão expirou. Entre novamente.'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and cadastro_concluido_em is not null) then
    raise exception 'Conclua seu cadastro para continuar.';
  end if;
  if public.is_mentor(auth.uid()) then raise exception 'Você já é mentor.'; end if;
  if exists (select 1 from public.mentor_requests where user_id = auth.uid() and status = 'pending') then
    raise exception 'Seu pedido já está em análise.';
  end if;
  if not public.consumir_limite('mentor:' || auth.uid(), 3, 86400) then
    raise exception 'Muitos pedidos hoje. Tente amanhã.';
  end if;
  insert into public.mentor_requests (user_id, message) values (auth.uid(), left(v_msg, 1000)) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.pedir_mentoria(text) from public, anon;
grant execute on function public.pedir_mentoria(text) to authenticated;

-- Admin: lista com nome/e-mail (a tela "Mentores" do app)
create or replace function public.admin_listar_mentoria(p_status text default null)
returns table (id uuid, user_id uuid, nome text, email text, status text, message text,
               created_at timestamptz, reviewed_at timestamptz, revisor text, mentor_ativo boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  return query
    select r.id, r.user_id, p.nome, p.email, r.status, r.message, r.created_at, r.reviewed_at, a.nome,
           public.is_mentor(r.user_id)
      from public.mentor_requests r
      join public.profiles p on p.id = r.user_id
      left join public.profiles a on a.id = r.reviewed_by
     where p_status is null or r.status = p_status
     order by (r.status = 'pending') desc, r.created_at desc
     limit 300;
end;
$$;
revoke all on function public.admin_listar_mentoria(text) from public, anon;
grant execute on function public.admin_listar_mentoria(text) to authenticated;

-- Admin aprova (concede a permissão de mentor) ou recusa
create or replace function public.admin_decidir_mentoria(p_id uuid, p_aprovar boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.mentor_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  select * into r from public.mentor_requests where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if r.status <> 'pending' then raise exception 'Este pedido já foi decidido.'; end if;
  update public.mentor_requests
     set status = case when p_aprovar then 'approved' else 'rejected' end, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  if p_aprovar then
    insert into public.user_roles (user_id, role, granted_by) values (r.user_id, 'mentor', auth.uid())
    on conflict (user_id, role) do nothing;
  end if;
  return case when p_aprovar then 'approved' else 'rejected' end;
end;
$$;
revoke all on function public.admin_decidir_mentoria(uuid, boolean) from public, anon;
grant execute on function public.admin_decidir_mentoria(uuid, boolean) to authenticated;

-- Admin tira a permissão (os compartilhamentos ficam, mas param de valer: ver mentor_tem_acesso)
create or replace function public.admin_revogar_mentor(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  delete from public.user_roles where user_id = p_user and role = 'mentor';
end;
$$;
revoke all on function public.admin_revogar_mentor(uuid) from public, anon;
grant execute on function public.admin_revogar_mentor(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Compartilhamento de projeto com mentor (consentimento do dono)
-- ---------------------------------------------------------------------
create table if not exists public.mvp_project_shares (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.jornadas(id) on delete cascade,
  owner_user_id  uuid not null references public.profiles(id) on delete cascade,
  mentor_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  constraint mvp_project_shares_unico unique (project_id, mentor_user_id),
  constraint mvp_project_shares_outro check (owner_user_id <> mentor_user_id)
);
create index if not exists idx_shares_mentor on public.mvp_project_shares(mentor_user_id, created_at desc);

-- O mentor só acessa o projeto com compartilhamento E com a permissão de mentor ativa.
create or replace function public.mentor_tem_acesso(p_projeto uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null and public.is_mentor(p_user) and exists (
    select 1 from public.mvp_project_shares s where s.project_id = p_projeto and s.mentor_user_id = p_user);
$$;
revoke all on function public.mentor_tem_acesso(uuid, uuid) from public;
grant execute on function public.mentor_tem_acesso(uuid, uuid) to authenticated, service_role;

create or replace function public.dono_do_projeto(p_projeto uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null and exists (select 1 from public.jornadas j where j.id = p_projeto and j.cliente_id = p_user);
$$;
revoke all on function public.dono_do_projeto(uuid, uuid) from public;
grant execute on function public.dono_do_projeto(uuid, uuid) to authenticated, service_role;

alter table public.mvp_project_shares enable row level security;
drop policy if exists "shares_select" on public.mvp_project_shares;
create policy "shares_select" on public.mvp_project_shares
  for select using (owner_user_id = auth.uid() or (mentor_user_id = auth.uid() and public.is_mentor()) or public.is_admin());
revoke all on public.mvp_project_shares from anon;
revoke insert, update, delete on public.mvp_project_shares from authenticated;
grant select on public.mvp_project_shares to authenticated;

-- O dono compartilha pelo e-mail do mentor. Mensagem única para "não existe" e "não é mentor".
create or replace function public.compartilhar_projeto(p_projeto uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mentor uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sua sessão expirou. Entre novamente.'; end if;
  if not public.dono_do_projeto(p_projeto) then raise exception 'Projeto não encontrado.'; end if;
  if not public.consumir_limite('share:' || auth.uid(), 20, 3600) then
    raise exception 'Muitas tentativas. Aguarde um pouco e tente de novo.';
  end if;
  select p.id into v_mentor from public.profiles p
   where lower(p.email) = lower(trim(coalesce(p_email, ''))) and public.is_mentor(p.id) limit 1;
  if v_mentor is null or v_mentor = auth.uid() then
    raise exception 'Não encontramos um mentor com este e-mail. Confira com o seu mentor o e-mail da conta dele.';
  end if;
  insert into public.mvp_project_shares (project_id, owner_user_id, mentor_user_id)
  values (p_projeto, auth.uid(), v_mentor)
  on conflict (project_id, mentor_user_id) do update set created_at = public.mvp_project_shares.created_at
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.compartilhar_projeto(uuid, text) from public, anon;
grant execute on function public.compartilhar_projeto(uuid, text) to authenticated;

-- O dono revoga. Sem nenhum mentor, os módulos que esperavam revisão ficam aprovados.
create or replace function public.revogar_compartilhamento(p_projeto uuid, p_mentor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.dono_do_projeto(p_projeto) then raise exception 'Projeto não encontrado.'; end if;
  delete from public.mvp_project_shares where project_id = p_projeto and mentor_user_id = p_mentor;
  if not exists (select 1 from public.mvp_project_shares s where s.project_id = p_projeto and public.is_mentor(s.mentor_user_id)) then
    update public.jornada_modulos set status = 'aprovado', avaliado_em = now(), updated_at = now()
     where jornada_id = p_projeto and status = 'enviado';
  end if;
end;
$$;
revoke all on function public.revogar_compartilhamento(uuid, uuid) from public, anon;
grant execute on function public.revogar_compartilhamento(uuid, uuid) to authenticated;

-- Dono: com quem este projeto está compartilhado
create or replace function public.mentores_do_projeto(p_projeto uuid)
returns table (mentor_user_id uuid, nome text, email text, compartilhado_em timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.dono_do_projeto(p_projeto) then raise exception 'Projeto não encontrado.'; end if;
  return query
    select s.mentor_user_id, p.nome, p.email, s.created_at
      from public.mvp_project_shares s join public.profiles p on p.id = s.mentor_user_id
     where s.project_id = p_projeto order by s.created_at;
end;
$$;
revoke all on function public.mentores_do_projeto(uuid) from public, anon;
grant execute on function public.mentores_do_projeto(uuid) to authenticated;

-- Mentor: os projetos compartilhados com ele (vazio para quem não é mentor)
create or replace function public.mentor_projetos()
returns table (project_id uuid, titulo text, status text, updated_at timestamptz, dono_nome text,
               compartilhado_em timestamptz, total_modulos int, aprovados int, para_revisar int, tem_resumo boolean)
language sql
stable
security definer
set search_path = public
as $$
  select j.id, j.titulo, j.status, j.updated_at, p.nome, s.created_at,
         (select count(*)::int from public.jornada_modulos m where m.jornada_id = j.id),
         (select count(*)::int from public.jornada_modulos m where m.jornada_id = j.id and m.status = 'aprovado'),
         (select count(*)::int from public.jornada_modulos m where m.jornada_id = j.id and m.status = 'enviado'),
         exists (select 1 from public.jornada_orcamentos o where o.jornada_id = j.id)
    from public.mvp_project_shares s
    join public.jornadas j on j.id = s.project_id
    join public.profiles p on p.id = j.cliente_id
   where s.mentor_user_id = auth.uid() and public.is_mentor()
   order by j.updated_at desc;
$$;
revoke all on function public.mentor_projetos() from public, anon;
grant execute on function public.mentor_projetos() to authenticated;

-- Leitura de projetos: dono, admin e mentor com compartilhamento (substitui as do 30)
drop policy if exists "jornadas_select" on public.jornadas;
create policy "jornadas_select" on public.jornadas
  for select using (cliente_id = auth.uid() or public.is_admin() or public.mentor_tem_acesso(id));

drop policy if exists "jornada_modulos_select" on public.jornada_modulos;
create policy "jornada_modulos_select" on public.jornada_modulos
  for select using (public.dono_do_projeto(jornada_id) or public.is_admin() or public.mentor_tem_acesso(jornada_id));

drop policy if exists "jornada_orcamentos_select" on public.jornada_orcamentos;
create policy "jornada_orcamentos_select" on public.jornada_orcamentos
  for select using (public.dono_do_projeto(jornada_id) or public.is_admin() or public.mentor_tem_acesso(jornada_id));

-- Admin não revisa mais: o que esperava a equipe fica aprovado (projetos sem mentor)
update public.jornada_modulos m set status = 'aprovado', avaliado_em = now(), updated_at = now()
 where m.status = 'enviado'
   and not exists (select 1 from public.mvp_project_shares s where s.project_id = m.jornada_id);

-- ---------------------------------------------------------------------
-- 5. Comentários e acompanhamento (dono + mentor do projeto)
-- ---------------------------------------------------------------------
create table if not exists public.mvp_mentor_comments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.jornadas(id) on delete cascade,
  author_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  author_nome text,
  modulo      text,
  body        text not null,
  created_at  timestamptz not null default now(),
  constraint mvp_mentor_comments_body_check check (char_length(btrim(body)) between 1 and 2000),
  constraint mvp_mentor_comments_modulo_check check (modulo is null or modulo ~ '^[a-z0-9-]{1,60}$')
);
create index if not exists idx_mentor_comments on public.mvp_mentor_comments(project_id, created_at);

create or replace function public.preencher_autor_comentario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.author_id := auth.uid();
  new.author_nome := (select split_part(coalesce(nome, 'Usuário'), ' ', 1) from public.profiles where id = auth.uid());
  new.created_at := now();
  return new;
end; $$;
drop trigger if exists trg_autor_comentario on public.mvp_mentor_comments;
create trigger trg_autor_comentario before insert on public.mvp_mentor_comments
  for each row execute function public.preencher_autor_comentario();

alter table public.mvp_mentor_comments enable row level security;
drop policy if exists "comments_select" on public.mvp_mentor_comments;
create policy "comments_select" on public.mvp_mentor_comments
  for select using (public.dono_do_projeto(project_id) or public.mentor_tem_acesso(project_id) or public.is_admin());
drop policy if exists "comments_insert" on public.mvp_mentor_comments;
create policy "comments_insert" on public.mvp_mentor_comments
  for insert with check (
    author_id = auth.uid()
    and (public.dono_do_projeto(project_id) or public.mentor_tem_acesso(project_id))
    and exists (select 1 from public.mvp_project_shares s where s.project_id = mvp_mentor_comments.project_id));
drop policy if exists "comments_delete" on public.mvp_mentor_comments;
create policy "comments_delete" on public.mvp_mentor_comments
  for delete using (author_id = auth.uid());
revoke all on public.mvp_mentor_comments from anon;
revoke insert, update on public.mvp_mentor_comments from authenticated;
grant select, delete on public.mvp_mentor_comments to authenticated;
grant insert (project_id, modulo, body) on public.mvp_mentor_comments to authenticated;

-- ---------------------------------------------------------------------
-- 6. Configuração de preço do documento (uma linha)
-- ---------------------------------------------------------------------
create table if not exists public.mvp_pricing_config (
  id                      int primary key default 1,
  price_brl               numeric(10,2) not null default 30.00,
  usd_brl                 numeric(10,4) not null default 5.40,
  max_output_tokens       int not null default 16000,
  credit_valid_days       int not null default 90,
  max_tentativas          int not null default 3,
  validade_orcamento_dias int not null default 30,
  updated_at              timestamptz not null default now(),
  constraint mvp_pricing_config_um check (id = 1),
  constraint mvp_pricing_config_valores check (price_brl > 0 and usd_brl > 0 and max_output_tokens between 1000 and 64000
    and credit_valid_days between 0 and 730 and max_tentativas between 1 and 10 and validade_orcamento_dias between 1 and 365)
);
insert into public.mvp_pricing_config (id) values (1) on conflict (id) do nothing;

drop trigger if exists trg_touch_mvp_pricing on public.mvp_pricing_config;
create trigger trg_touch_mvp_pricing before update on public.mvp_pricing_config
  for each row execute function public.touch_updated_at();

alter table public.mvp_pricing_config enable row level security;
drop policy if exists "mvp_pricing_select" on public.mvp_pricing_config;
create policy "mvp_pricing_select" on public.mvp_pricing_config for select using (auth.uid() is not null);
drop policy if exists "mvp_pricing_admin" on public.mvp_pricing_config;
create policy "mvp_pricing_admin" on public.mvp_pricing_config for update using (public.is_admin()) with check (public.is_admin());
revoke all on public.mvp_pricing_config from anon;
revoke insert, delete on public.mvp_pricing_config from authenticated;
grant select, update on public.mvp_pricing_config to authenticated;

-- ---------------------------------------------------------------------
-- 7. Pedidos do documento detalhado
--    pending_payment -> paid -> generating -> ready
--                                 └-> paid (nova tentativa) ... -> failed -> paid (liberada) | refunded
-- ---------------------------------------------------------------------
create table if not exists public.mvp_budget_orders (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles(id) on delete cascade,
  project_id            uuid not null references public.jornadas(id) on delete cascade,
  orcamento_id          uuid references public.jornada_orcamentos(id) on delete set null,
  status                text not null default 'pending_payment',
  price_brl             numeric(10,2) not null,
  pagamento_id          uuid unique references public.pagamentos(id) on delete set null,
  mp_payment_id         text,
  document_path         text,
  tentativas            int not null default 0,
  tentativas_liberadas  int not null default 0,
  erro                  text,
  gerando_desde         timestamptz,
  paid_at               timestamptz,
  ready_at              timestamptz,
  refunded_at           timestamptz,
  valid_until           date,
  credito_pagamento_id  uuid references public.pagamentos(id) on delete set null,
  credito_usado_em      timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint mvp_budget_orders_status_check check (status in ('pending_payment','paid','generating','ready','failed','refunded')),
  constraint mvp_budget_orders_preco_check check (price_brl > 0)
);
create index if not exists idx_mvp_orders_user on public.mvp_budget_orders(user_id, created_at desc);
create index if not exists idx_mvp_orders_projeto on public.mvp_budget_orders(project_id, created_at desc);
create index if not exists idx_mvp_orders_status on public.mvp_budget_orders(status) where status in ('paid','generating');
-- um pedido em aberto por projeto (dois cliques em "Pagar" não duplicam)
create unique index if not exists uq_mvp_order_aberto on public.mvp_budget_orders(project_id)
  where status in ('pending_payment','paid','generating');

drop trigger if exists trg_touch_mvp_orders on public.mvp_budget_orders;
create trigger trg_touch_mvp_orders before update on public.mvp_budget_orders
  for each row execute function public.touch_updated_at();

alter table public.mvp_budget_orders enable row level security;
drop policy if exists "mvp_orders_select" on public.mvp_budget_orders;
create policy "mvp_orders_select" on public.mvp_budget_orders
  for select using (user_id = auth.uid() or public.is_admin());   -- o mentor NÃO vê pedido nem PDF
revoke all on public.mvp_budget_orders from anon;
revoke insert, update, delete on public.mvp_budget_orders from authenticated;
grant select on public.mvp_budget_orders to authenticated;

-- ---------------------------------------------------------------------
-- 8. Custo real de cada chamada de IA (só registro)
-- ---------------------------------------------------------------------
create table if not exists public.mvp_budget_generations (
  id                 bigserial primary key,
  order_id           uuid references public.mvp_budget_orders(id) on delete set null,
  provider           text not null,
  model              text not null,
  input_tokens       int not null default 0,
  output_tokens      int not null default 0,
  cache_read_tokens  int not null default 0,
  cache_write_tokens int not null default 0,
  cost_usd           numeric(12,6) not null default 0,
  cost_brl           numeric(12,4) not null default 0,
  usd_brl            numeric(10,4),
  sucesso            boolean not null default true,
  created_at         timestamptz not null default now()
);
create index if not exists idx_mvp_generations_order on public.mvp_budget_generations(order_id);
create index if not exists idx_mvp_generations_data on public.mvp_budget_generations(created_at);

alter table public.mvp_budget_generations enable row level security;
drop policy if exists "mvp_generations_admin" on public.mvp_budget_generations;
create policy "mvp_generations_admin" on public.mvp_budget_generations for select using (public.is_admin());
revoke all on public.mvp_budget_generations from anon;
revoke insert, update, delete on public.mvp_budget_generations from authenticated;
grant select on public.mvp_budget_generations to authenticated;

-- Margem: receita (pedidos pagos e não estornados) - custo de IA. Taxa do Mercado Pago não entra.
create or replace view public.vw_mvp_margem with (security_invoker = true) as
select o.id as order_id, o.user_id, o.project_id, o.status, o.created_at, o.paid_at,
       case when o.paid_at is not null and o.status <> 'refunded' then o.price_brl else 0 end as receita_brl,
       coalesce(g.custo_brl, 0) as custo_brl,
       coalesce(g.custo_usd, 0) as custo_usd,
       coalesce(g.chamadas, 0) as chamadas,
       (case when o.paid_at is not null and o.status <> 'refunded' then o.price_brl else 0 end) - coalesce(g.custo_brl, 0) as margem_brl
  from public.mvp_budget_orders o
  left join (select order_id, sum(cost_brl) custo_brl, sum(cost_usd) custo_usd, count(*) chamadas
               from public.mvp_budget_generations group by order_id) g on g.order_id = o.id;
revoke all on public.vw_mvp_margem from anon, authenticated;
grant select on public.vw_mvp_margem to service_role;

create or replace function public.admin_mvp_margem(p_inicio date default null, p_fim date default null)
returns table (mes date, pedidos_pagos int, receita_brl numeric, custo_brl numeric, margem_brl numeric, margem_pct numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  return query
    select date_trunc('month', coalesce(v.paid_at, v.created_at) at time zone 'America/Sao_Paulo')::date,
           count(*) filter (where v.receita_brl > 0)::int,
           sum(v.receita_brl), sum(v.custo_brl), sum(v.margem_brl),
           case when sum(v.receita_brl) > 0 then round(sum(v.margem_brl) / sum(v.receita_brl) * 100, 1) end
      from public.vw_mvp_margem v
     where (p_inicio is null or coalesce(v.paid_at, v.created_at) >= p_inicio)
       and (p_fim is null or coalesce(v.paid_at, v.created_at) < p_fim + 1)
       and (v.paid_at is not null or v.custo_brl > 0)
     group by 1 order by 1 desc;
end;
$$;
revoke all on function public.admin_mvp_margem(date, date) from public, anon;
grant execute on function public.admin_mvp_margem(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Transições da geração (só o servidor). Atômicas: duas chamadas ao mesmo tempo
--    não geram o mesmo documento duas vezes.
-- ---------------------------------------------------------------------
create or replace function public.mvp_reservar_geracao(p_order uuid)
returns setof public.mvp_budget_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max int := coalesce((select max_tentativas from public.mvp_pricing_config where id = 1), 3);
begin
  return query
    update public.mvp_budget_orders
       set status = 'generating', tentativas = tentativas + 1, gerando_desde = now(), erro = null
     where id = p_order
       and tentativas < v_max + tentativas_liberadas
       and (status = 'paid' or (status = 'generating' and gerando_desde < now() - interval '6 minutes'))
    returning *;
end;
$$;

create or replace function public.mvp_concluir_geracao(p_order uuid, p_path text)
returns setof public.mvp_budget_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_validade int := coalesce((select validade_orcamento_dias from public.mvp_pricing_config where id = 1), 30);
begin
  return query
    update public.mvp_budget_orders
       set status = 'ready', document_path = p_path, ready_at = now(), gerando_desde = null, erro = null,
           valid_until = (now() at time zone 'America/Sao_Paulo')::date + v_validade
     where id = p_order and status = 'generating'
    returning *;
end;
$$;

-- Falhou: volta para "paid" (nova tentativa automática) até o máximo; depois, "failed".
create or replace function public.mvp_falhar_geracao(p_order uuid, p_erro text)
returns setof public.mvp_budget_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max int := coalesce((select max_tentativas from public.mvp_pricing_config where id = 1), 3);
begin
  return query
    update public.mvp_budget_orders
       set status = case when tentativas >= v_max + tentativas_liberadas then 'failed' else 'paid' end,
           erro = left(p_erro, 300), gerando_desde = null
     where id = p_order and status = 'generating'
    returning *;
end;
$$;

-- Depois de "failed": libera mais uma tentativa. O cliente pode fazer isso 1 vez; o admin, quantas quiser.
create or replace function public.mvp_liberar_tentativa(p_order uuid, p_admin boolean default false)
returns setof public.mvp_budget_orders
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update public.mvp_budget_orders
       set status = 'paid', tentativas_liberadas = tentativas_liberadas + 1, erro = null
     where id = p_order and status = 'failed'
       and (p_admin or tentativas_liberadas = 0)
    returning *;
end;
$$;

revoke all on function public.mvp_reservar_geracao(uuid), public.mvp_concluir_geracao(uuid, text),
  public.mvp_falhar_geracao(uuid, text), public.mvp_liberar_tentativa(uuid, boolean) from public, anon, authenticated;
grant execute on function public.mvp_reservar_geracao(uuid), public.mvp_concluir_geracao(uuid, text),
  public.mvp_falhar_geracao(uuid, text), public.mvp_liberar_tentativa(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------
-- 10. Solicitação criada a partir do orçamento + crédito no pagamento
-- ---------------------------------------------------------------------
alter table public.solicitacoes drop constraint if exists solicitacoes_origem_check;
alter table public.solicitacoes add constraint solicitacoes_origem_check
  check (origem in ('configurador','diagnostico','jornada_mvp'));
alter table public.solicitacoes add column if not exists jornada_id uuid references public.jornadas(id) on delete set null;

alter table public.pagamentos add column if not exists credito_mvp      numeric(12,2) not null default 0;
alter table public.pagamentos add column if not exists credito_order_id uuid references public.mvp_budget_orders(id) on delete set null;

-- ---------------------------------------------------------------------
-- 11. Bucket privado dos PDFs (sem política: só o servidor lê e grava; o
--     cliente baixa por URL assinada, gerada depois de conferir o dono)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('orcamentos-mvp', 'orcamentos-mvp', false, 10485760)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------
-- 12. aplicar_pagamento_mp (versão do 09 + pedido do orçamento + crédito)
-- ---------------------------------------------------------------------
create or replace function public.aplicar_pagamento_mp(
  p_pagamento_id   uuid,
  p_mp_payment_id  text,
  p_status         text,
  p_status_detalhe text,
  p_metodo         text,
  p_valor          numeric,
  p_moeda          text,
  p_pago_em        timestamptz,
  p_origem         text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  pg       public.pagamentos%rowtype;
  s        public.solicitacoes%rowtype;
  v_res    text;
  v_proj   uuid;
  v_item   text;
  v_nome   text;
  v_tipo   text;
  v_metodo text := case when p_metodo in ('pix','cartao','boleto') then p_metodo else 'outro' end;
  v_logar  boolean := true;
begin
  select * into pg from public.pagamentos where id = p_pagamento_id for update;
  if not found then
    insert into public.pagamento_eventos (pagamento_id, mp_payment_id, origem, status_mp, status_detalhe, valor_mp, resultado)
    values (null, p_mp_payment_id, p_origem, p_status, p_status_detalhe, p_valor, 'pagamento_inexistente');
    return 'pagamento_inexistente';
  end if;

  if p_status = 'approved' then
    if coalesce(p_moeda, '') <> 'BRL' or p_valor is null or round(p_valor, 2) <> round(pg.valor, 2) then
      v_res := 'valor_divergente';
    elsif pg.status = 'pago' then
      v_res := case when pg.mp_payment_id = p_mp_payment_id then 'ja_processado' else 'pago_em_duplicidade' end;
      v_logar := v_res <> 'ja_processado';
    elsif pg.status <> 'pendente' then
      v_res := 'cobranca_' || pg.status;
    else
      update public.pagamentos
         set status = 'pago', metodo = v_metodo, pago_em = coalesce(p_pago_em, now()),
             mp_payment_id = p_mp_payment_id, gateway_id = p_mp_payment_id,
             mp_ultimo_status = p_status, mp_ultimo_payment_id = p_mp_payment_id, link_pagamento = null
       where id = pg.id;

      if pg.projeto_funcionalidade_id is not null then
        update public.projeto_funcionalidades set status = 'paga'
         where id = pg.projeto_funcionalidade_id and status = 'aguardando_pagamento';
      end if;

      if pg.solicitacao_id is not null then
        select * into s from public.solicitacoes where id = pg.solicitacao_id for update;
        if found then
          v_proj := s.projeto_id;
          if v_proj is null then
            v_item := coalesce(s.resumo->'itens'->0->>'id', s.selecao->'servicos'->0->>'id');
            v_nome := coalesce(s.resumo->'itens'->0->>'nome', 'Projeto');
            v_tipo := case
              when v_item = 'site-institucional' then 'institucional'
              when v_item = 'landing-page' then 'landing_page'
              when v_item = 'portfolio' then 'portfolio'
              when v_item = 'loja-virtual' then 'loja'
              when v_item in ('plataforma','mvp') then 'saas'
              when v_item = 'sistema' then 'sistema'
              when v_item in ('automacao','integracao') then 'automacao'
              when v_item in ('consultoria','diagnostico') then 'consultoria'
              when v_item like 'identidade-%' then 'identidade'
              else 'outro' end;

            insert into public.projetos
              (cliente_id, solicitacao_id, codigo, nome, tipo, status_projeto, status_pagamento, valor_total, previsao_entrega)
            values (
              s.cliente_id, s.id,
              'COG-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.seq_codigo_projeto')::text, 3, '0'),
              v_nome || ' (' || s.codigo || ')',
              v_tipo, 'em_andamento', 'pago', coalesce(s.valor_final, pg.valor),
              public.somar_dias_uteis(current_date, public.prazo_estimado_dias(s.resumo))
            )
            returning id into v_proj;
          end if;
          update public.solicitacoes set status = 'paga', projeto_id = v_proj where id = s.id;
          update public.pagamentos set projeto_id = coalesce(projeto_id, v_proj) where id = pg.id;
        end if;
      end if;

      -- orçamento detalhado do MVP: libera a geração (que começa no servidor depois deste ponto)
      update public.mvp_budget_orders
         set status = 'paid', mp_payment_id = p_mp_payment_id, paid_at = coalesce(p_pago_em, now())
       where pagamento_id = pg.id and status = 'pending_payment';

      -- contratação com crédito do orçamento: o crédito é consumido agora
      if pg.credito_order_id is not null then
        update public.mvp_budget_orders set credito_usado_em = now(), credito_pagamento_id = pg.id
         where id = pg.credito_order_id and credito_usado_em is null;
      end if;

      v_proj := coalesce(v_proj, pg.projeto_id);
      if v_proj is not null then
        update public.projetos
           set status_pagamento = case when exists (
                 select 1 from public.pagamentos where projeto_id = v_proj and status = 'pendente')
               then 'parcial' else 'pago' end
         where id = v_proj;
      end if;
      v_res := 'pago';
    end if;

  elsif p_status in ('refunded', 'charged_back') then
    if pg.status = 'pago' and pg.mp_payment_id = p_mp_payment_id then
      update public.pagamentos set status = 'reembolsado', mp_ultimo_status = p_status where id = pg.id;
      if pg.projeto_funcionalidade_id is not null then
        update public.projeto_funcionalidades set status = 'cancelada' where id = pg.projeto_funcionalidade_id;
      elsif pg.projeto_id is not null then
        update public.projetos set status_pagamento = 'reembolsado' where id = pg.projeto_id;
      end if;
      update public.mvp_budget_orders set status = 'refunded', refunded_at = now()
       where pagamento_id = pg.id and status <> 'refunded';
      if pg.credito_order_id is not null then   -- contratação estornada: o crédito volta
        update public.mvp_budget_orders set credito_usado_em = null, credito_pagamento_id = null
         where id = pg.credito_order_id and credito_pagamento_id = pg.id;
      end if;
      v_res := 'reembolsado';
    else
      v_res := 'ignorado';
    end if;

  else
    v_logar := not (pg.mp_ultimo_status is not distinct from p_status
                    and pg.mp_ultimo_payment_id is not distinct from p_mp_payment_id);
    if pg.status = 'pendente' then
      update public.pagamentos set mp_ultimo_status = p_status, mp_ultimo_payment_id = p_mp_payment_id
       where id = pg.id;
    end if;
    v_res := 'sem_alteracao';
  end if;

  if v_logar then
    insert into public.pagamento_eventos (pagamento_id, mp_payment_id, origem, status_mp, status_detalhe, valor_mp, resultado)
    values (pg.id, p_mp_payment_id, p_origem, p_status, p_status_detalhe, p_valor, v_res);
  end if;
  return v_res;
end;
$$;

revoke all on function public.aplicar_pagamento_mp(uuid, text, text, text, text, numeric, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.aplicar_pagamento_mp(uuid, text, text, text, text, numeric, text, timestamptz, text)
  to service_role;

-- Conferir
select 'user_roles' as tabela, count(*) from public.user_roles
union all select 'mentor_requests', count(*) from public.mentor_requests
union all select 'mvp_project_shares', count(*) from public.mvp_project_shares
union all select 'mvp_budget_orders', count(*) from public.mvp_budget_orders
union all select 'mvp_pricing_config', count(*) from public.mvp_pricing_config;
