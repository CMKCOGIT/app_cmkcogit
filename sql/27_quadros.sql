-- =====================================================================
-- 27_quadros.sql — Quadros de tarefas da equipe (estilo Trello) + Empresas.
-- Rode depois do 26. Pode rodar mais de uma vez. SÓ ADMIN vê e mexe (RLS).
--   empresas ............ cadastro de empresas; clientes (profiles) e projetos podem ser ligados a uma
--   quadros ............. um por projeto (criado sozinho), por empresa ou por tema interno
--   quadro_listas ....... colunas (posição, limite de cartões, "conclui" marca o cartão como feito)
--   quadro_etiquetas .... etiquetas coloridas do quadro
--   cartoes ............. tarefas: descrição, prazo, prioridade, capa, ligações (cliente, projeto,
--                         solicitação, conversa), arquivar
--   cartao_responsaveis, cartao_etiquetas, cartao_checklists (+ itens), cartao_comentarios,
--   cartao_anexos (Storage, bucket privado "quadros"), cartao_atividade (histórico automático)
-- Avisos no sino: responsável marcado, comentário novo e prazo (lembrar_prazos_cartoes, rotina diária).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. EMPRESAS
-- ---------------------------------------------------------------------
create table if not exists public.empresas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  documento   text,
  site        text,
  observacoes text,
  cor         text not null default '#1A2C52',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint empresas_nome_check check (char_length(btrim(nome)) between 1 and 120)
);
create unique index if not exists uq_empresas_nome on public.empresas(lower(btrim(nome)));

alter table public.profiles add column if not exists empresa_id uuid references public.empresas(id) on delete set null;
alter table public.projetos add column if not exists empresa_id uuid references public.empresas(id) on delete set null;
create index if not exists idx_profiles_empresa on public.profiles(empresa_id) where empresa_id is not null;
create index if not exists idx_projetos_empresa on public.projetos(empresa_id) where empresa_id is not null;

-- ---------------------------------------------------------------------
-- 2. QUADROS, LISTAS, ETIQUETAS
-- ---------------------------------------------------------------------
create table if not exists public.quadros (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  descricao    text,
  tipo         text not null default 'interno',
  projeto_id   uuid references public.projetos(id) on delete cascade,
  empresa_id   uuid references public.empresas(id) on delete cascade,
  cor          text not null default '#1A2C52',
  fixado       boolean not null default false,
  arquivado_em timestamptz,
  criado_por   uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint quadros_tipo_check check (tipo in ('projeto', 'empresa', 'interno')),
  constraint quadros_forma_check check (
    (tipo = 'projeto' and projeto_id is not null) or (tipo = 'empresa' and empresa_id is not null) or tipo = 'interno'),
  constraint quadros_nome_check check (char_length(btrim(nome)) between 1 and 120)
);
create unique index if not exists uq_quadro_projeto on public.quadros(projeto_id) where tipo = 'projeto';

create table if not exists public.quadro_listas (
  id           uuid primary key default gen_random_uuid(),
  quadro_id    uuid not null references public.quadros(id) on delete cascade,
  nome         text not null,
  posicao      double precision not null default 0,
  limite       int,
  conclui      boolean not null default false,
  arquivada_em timestamptz,
  created_at   timestamptz not null default now(),
  constraint quadro_listas_nome_check check (char_length(btrim(nome)) between 1 and 80),
  constraint quadro_listas_limite_check check (limite is null or limite between 1 and 999)
);
create index if not exists idx_quadro_listas on public.quadro_listas(quadro_id, posicao);

create table if not exists public.quadro_etiquetas (
  id         uuid primary key default gen_random_uuid(),
  quadro_id  uuid not null references public.quadros(id) on delete cascade,
  nome       text not null default '',
  cor        text not null default 'azul',
  created_at timestamptz not null default now(),
  constraint quadro_etiquetas_cor_check check (cor in ('verde', 'amarelo', 'laranja', 'vermelho', 'roxo', 'azul', 'ceu', 'cinza', 'grafite'))
);
create index if not exists idx_quadro_etiquetas on public.quadro_etiquetas(quadro_id);

-- ---------------------------------------------------------------------
-- 3. CARTÕES
-- ---------------------------------------------------------------------
create table if not exists public.cartoes (
  id             uuid primary key default gen_random_uuid(),
  quadro_id      uuid not null references public.quadros(id) on delete cascade,
  lista_id       uuid not null references public.quadro_listas(id) on delete cascade,
  titulo         text not null,
  descricao      text,
  posicao        double precision not null default 0,
  prioridade     text,
  inicio         date,
  prazo          timestamptz,
  concluido_em   timestamptz,
  capa_cor       text,
  cliente_id     uuid references public.profiles(id) on delete set null,
  projeto_id     uuid references public.projetos(id) on delete set null,
  solicitacao_id uuid references public.solicitacoes(id) on delete set null,
  conversa_id    uuid references public.conversas(id) on delete set null,
  arquivado_em   timestamptz,
  criado_por     uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint cartoes_titulo_check check (char_length(btrim(titulo)) between 1 and 300),
  constraint cartoes_descricao_check check (descricao is null or char_length(descricao) <= 20000),
  constraint cartoes_prioridade_check check (prioridade is null or prioridade in ('baixa', 'media', 'alta', 'urgente')),
  constraint cartoes_capa_check check (capa_cor is null or capa_cor in ('verde', 'amarelo', 'laranja', 'vermelho', 'roxo', 'azul', 'ceu', 'cinza', 'grafite'))
);
create index if not exists idx_cartoes_lista on public.cartoes(lista_id, posicao) where arquivado_em is null;
create index if not exists idx_cartoes_quadro on public.cartoes(quadro_id);
create index if not exists idx_cartoes_prazo on public.cartoes(prazo) where concluido_em is null and arquivado_em is null and prazo is not null;
create index if not exists idx_cartoes_projeto on public.cartoes(projeto_id) where projeto_id is not null;

create table if not exists public.cartao_responsaveis (
  cartao_id  uuid not null references public.cartoes(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cartao_id, usuario_id)
);
create index if not exists idx_cartao_responsaveis_usuario on public.cartao_responsaveis(usuario_id);

create table if not exists public.cartao_etiquetas (
  cartao_id   uuid not null references public.cartoes(id) on delete cascade,
  etiqueta_id uuid not null references public.quadro_etiquetas(id) on delete cascade,
  primary key (cartao_id, etiqueta_id)
);

create table if not exists public.cartao_checklists (
  id         uuid primary key default gen_random_uuid(),
  cartao_id  uuid not null references public.cartoes(id) on delete cascade,
  titulo     text not null default 'Checklist',
  posicao    double precision not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_cartao_checklists on public.cartao_checklists(cartao_id);

create table if not exists public.cartao_checklist_itens (
  id             uuid primary key default gen_random_uuid(),
  checklist_id   uuid not null references public.cartao_checklists(id) on delete cascade,
  texto          text not null,
  feito          boolean not null default false,
  feito_em       timestamptz,
  posicao        double precision not null default 0,
  responsavel_id uuid references public.profiles(id) on delete set null,
  prazo          date,
  created_at     timestamptz not null default now(),
  constraint checklist_itens_texto_check check (char_length(btrim(texto)) between 1 and 500)
);
create index if not exists idx_checklist_itens on public.cartao_checklist_itens(checklist_id, posicao);

create table if not exists public.cartao_comentarios (
  id         uuid primary key default gen_random_uuid(),
  cartao_id  uuid not null references public.cartoes(id) on delete cascade,
  autor_id   uuid references public.profiles(id) on delete set null default auth.uid(),
  corpo      text not null,
  editado_em timestamptz,
  created_at timestamptz not null default now(),
  constraint comentarios_corpo_check check (char_length(btrim(corpo)) between 1 and 5000)
);
create index if not exists idx_cartao_comentarios on public.cartao_comentarios(cartao_id, created_at);

create table if not exists public.cartao_anexos (
  id          uuid primary key default gen_random_uuid(),
  cartao_id   uuid not null references public.cartoes(id) on delete cascade,
  nome        text not null,
  path        text not null,
  mime        text,
  tamanho     bigint,
  enviado_por uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists idx_cartao_anexos on public.cartao_anexos(cartao_id);

create table if not exists public.cartao_atividade (
  id         uuid primary key default gen_random_uuid(),
  cartao_id  uuid references public.cartoes(id) on delete cascade,
  quadro_id  uuid references public.quadros(id) on delete cascade,
  autor_id   uuid references public.profiles(id) on delete set null,
  acao       text not null,
  detalhe    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_cartao_atividade on public.cartao_atividade(cartao_id, created_at desc);

-- ---------------------------------------------------------------------
-- 4. updated_at
-- ---------------------------------------------------------------------
drop trigger if exists trg_empresas_updated_at on public.empresas;
create trigger trg_empresas_updated_at before update on public.empresas for each row execute function public.touch_updated_at();
drop trigger if exists trg_quadros_updated_at on public.quadros;
create trigger trg_quadros_updated_at before update on public.quadros for each row execute function public.touch_updated_at();
drop trigger if exists trg_cartoes_updated_at on public.cartoes;
create trigger trg_cartoes_updated_at before update on public.cartoes for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 5. SEGURANÇA: tudo só para admin
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['empresas', 'quadros', 'quadro_listas', 'quadro_etiquetas', 'cartoes', 'cartao_responsaveis',
                           'cartao_etiquetas', 'cartao_checklists', 'cartao_checklist_itens', 'cartao_comentarios',
                           'cartao_anexos', 'cartao_atividade'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
-- o histórico é escrito só pelos gatilhos (ninguém edita ou apaga pela API)
revoke insert, update, delete on public.cartao_atividade from authenticated;
-- comentário: só o autor edita ou apaga
drop policy if exists "cartao_comentarios_admin" on public.cartao_comentarios;
drop policy if exists "cartao_comentarios_ler" on public.cartao_comentarios;
drop policy if exists "cartao_comentarios_criar" on public.cartao_comentarios;
drop policy if exists "cartao_comentarios_autor" on public.cartao_comentarios;
drop policy if exists "cartao_comentarios_apagar" on public.cartao_comentarios;
create policy "cartao_comentarios_ler" on public.cartao_comentarios for select using (public.is_admin());
create policy "cartao_comentarios_criar" on public.cartao_comentarios for insert with check (public.is_admin() and autor_id = auth.uid());
create policy "cartao_comentarios_autor" on public.cartao_comentarios for update using (public.is_admin() and autor_id = auth.uid()) with check (autor_id = auth.uid());
create policy "cartao_comentarios_apagar" on public.cartao_comentarios for delete using (public.is_admin() and autor_id = auth.uid());

-- ---------------------------------------------------------------------
-- 6. GATILHOS: concluir pela lista, histórico, avisos
-- ---------------------------------------------------------------------
-- Cartão entrou numa lista que "conclui" (ex.: Feito): marca concluído; saiu dela: desmarca.
create or replace function public.cartao_antes_salvar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_conclui_nova boolean;
  v_conclui_velha boolean;
begin
  select conclui into v_conclui_nova from public.quadro_listas where id = new.lista_id;
  if tg_op = 'INSERT' then
    if v_conclui_nova then new.concluido_em := coalesce(new.concluido_em, now()); end if;
    new.titulo := btrim(new.titulo);
    return new;
  end if;
  if new.lista_id is distinct from old.lista_id then
    select conclui into v_conclui_velha from public.quadro_listas where id = old.lista_id;
    -- a lista nova precisa ser do mesmo quadro (mudar de quadro: o app troca quadro_id junto)
    if not exists (select 1 from public.quadro_listas where id = new.lista_id and quadro_id = new.quadro_id) then
      raise exception 'A lista não é deste quadro.';
    end if;
    if v_conclui_nova and old.concluido_em is not distinct from new.concluido_em then new.concluido_em := coalesce(new.concluido_em, now());
    elsif v_conclui_velha and not v_conclui_nova and old.concluido_em is not distinct from new.concluido_em then new.concluido_em := null;
    end if;
  end if;
  new.titulo := btrim(new.titulo);
  return new;
end;
$$;
drop trigger if exists trg_cartao_antes_salvar on public.cartoes;
create trigger trg_cartao_antes_salvar before insert or update of lista_id, quadro_id, titulo on public.cartoes
  for each row execute function public.cartao_antes_salvar();

create or replace function public.registrar_atividade(p_cartao uuid, p_quadro uuid, p_acao text, p_detalhe jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.cartao_atividade (cartao_id, quadro_id, autor_id, acao, detalhe)
  values (p_cartao, p_quadro, auth.uid(), p_acao, coalesce(p_detalhe, '{}'::jsonb));
$$;
revoke all on function public.registrar_atividade(uuid, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.cartao_historico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.registrar_atividade(new.id, new.quadro_id, 'criou',
      jsonb_build_object('lista', (select nome from public.quadro_listas where id = new.lista_id)));
    return new;
  end if;
  if new.quadro_id is distinct from old.quadro_id then
    perform public.registrar_atividade(new.id, new.quadro_id, 'mudou_quadro', jsonb_build_object(
      'de', (select nome from public.quadros where id = old.quadro_id), 'para', (select nome from public.quadros where id = new.quadro_id)));
  elsif new.lista_id is distinct from old.lista_id then
    perform public.registrar_atividade(new.id, new.quadro_id, 'moveu', jsonb_build_object(
      'de', (select nome from public.quadro_listas where id = old.lista_id), 'para', (select nome from public.quadro_listas where id = new.lista_id)));
  end if;
  if new.titulo is distinct from old.titulo then
    perform public.registrar_atividade(new.id, new.quadro_id, 'renomeou', jsonb_build_object('de', old.titulo, 'para', new.titulo));
  end if;
  if new.prazo is distinct from old.prazo then
    perform public.registrar_atividade(new.id, new.quadro_id, case when new.prazo is null then 'tirou_prazo' else 'prazo' end,
      jsonb_build_object('prazo', new.prazo));
  end if;
  if new.concluido_em is distinct from old.concluido_em then
    perform public.registrar_atividade(new.id, new.quadro_id, case when new.concluido_em is null then 'reabriu' else 'concluiu' end, '{}'::jsonb);
  end if;
  if new.arquivado_em is distinct from old.arquivado_em then
    perform public.registrar_atividade(new.id, new.quadro_id, case when new.arquivado_em is null then 'restaurou' else 'arquivou' end, '{}'::jsonb);
  end if;
  if new.prioridade is distinct from old.prioridade then
    perform public.registrar_atividade(new.id, new.quadro_id, 'prioridade', jsonb_build_object('para', new.prioridade));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cartao_historico on public.cartoes;
create trigger trg_cartao_historico after insert or update on public.cartoes
  for each row execute function public.cartao_historico();

-- Responsável marcado: histórico + aviso no sino (se não marcou a si mesmo)
create or replace function public.cartao_responsavel_marcado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.cartoes%rowtype;
  v_q public.quadros%rowtype;
begin
  select * into v_c from public.cartoes where id = coalesce(new.cartao_id, old.cartao_id);
  if v_c.id is null then return coalesce(new, old); end if;
  select * into v_q from public.quadros where id = v_c.quadro_id;
  if tg_op = 'DELETE' then
    perform public.registrar_atividade(v_c.id, v_c.quadro_id, 'tirou_responsavel', jsonb_build_object('nome', (select nome from public.profiles where id = old.usuario_id)));
    return old;
  end if;
  perform public.registrar_atividade(v_c.id, v_c.quadro_id, 'marcou_responsavel', jsonb_build_object('nome', (select nome from public.profiles where id = new.usuario_id)));
  if new.usuario_id is distinct from auth.uid() then
    insert into public.notificacoes (usuario_id, projeto_id, tipo, titulo, mensagem, link, metadados)
    values (new.usuario_id, v_c.projeto_id, 'tarefa', 'Nova tarefa para você: ' || left(v_c.titulo, 120),
            'Quadro ' || v_q.nome || coalesce(' · prazo ' || to_char(v_c.prazo at time zone 'America/Sao_Paulo', 'DD/MM'), '') || '.',
            'admin-quadros.html?quadro=' || v_c.quadro_id || '&cartao=' || v_c.id,
            jsonb_build_object('cartao_id', v_c.id));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cartao_responsavel on public.cartao_responsaveis;
create trigger trg_cartao_responsavel after insert or delete on public.cartao_responsaveis
  for each row execute function public.cartao_responsavel_marcado();

-- Comentário novo: histórico + aviso aos responsáveis (menos quem comentou)
create or replace function public.cartao_comentario_novo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.cartoes%rowtype;
  v_autor text;
begin
  select * into v_c from public.cartoes where id = new.cartao_id;
  select coalesce(nullif(btrim(nome), ''), email) into v_autor from public.profiles where id = new.autor_id;
  perform public.registrar_atividade(v_c.id, v_c.quadro_id, 'comentou', jsonb_build_object('trecho', left(new.corpo, 120)));
  insert into public.notificacoes (usuario_id, projeto_id, tipo, titulo, mensagem, link, metadados)
  select r.usuario_id, v_c.projeto_id, 'tarefa', v_autor || ' comentou em: ' || left(v_c.titulo, 100), left(new.corpo, 200),
         'admin-quadros.html?quadro=' || v_c.quadro_id || '&cartao=' || v_c.id, jsonb_build_object('cartao_id', v_c.id)
    from public.cartao_responsaveis r
   where r.cartao_id = v_c.id and r.usuario_id is distinct from new.autor_id;
  return new;
end;
$$;
drop trigger if exists trg_cartao_comentario on public.cartao_comentarios;
create trigger trg_cartao_comentario after insert on public.cartao_comentarios
  for each row execute function public.cartao_comentario_novo();

-- Histórico de etiquetas, checklist e anexos (resumido)
create or replace function public.cartao_historico_extra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cartao uuid;
  v_quadro uuid;
begin
  if tg_table_name = 'cartao_anexos' then
    v_cartao := coalesce(new.cartao_id, old.cartao_id);
    select quadro_id into v_quadro from public.cartoes where id = v_cartao;
    if v_quadro is null then return coalesce(new, old); end if;
    perform public.registrar_atividade(v_cartao, v_quadro, case when tg_op = 'INSERT' then 'anexou' else 'tirou_anexo' end,
      jsonb_build_object('nome', coalesce(new.nome, old.nome)));
  elsif tg_table_name = 'cartao_checklist_itens' and tg_op = 'UPDATE' and new.feito is distinct from old.feito then
    select c.id, c.quadro_id into v_cartao, v_quadro from public.cartao_checklists k join public.cartoes c on c.id = k.cartao_id where k.id = new.checklist_id;
    perform public.registrar_atividade(v_cartao, v_quadro, case when new.feito then 'item_feito' else 'item_reaberto' end, jsonb_build_object('item', left(new.texto, 120)));
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_anexo_historico on public.cartao_anexos;
create trigger trg_anexo_historico after insert or delete on public.cartao_anexos for each row execute function public.cartao_historico_extra();
drop trigger if exists trg_item_historico on public.cartao_checklist_itens;
create trigger trg_item_historico after update of feito on public.cartao_checklist_itens for each row execute function public.cartao_historico_extra();

create or replace function public.item_checklist_feito_em()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.feito and not coalesce(old.feito, false) then new.feito_em := now(); elsif not new.feito then new.feito_em := null; end if;
  return new;
end; $$;
drop trigger if exists trg_item_feito_em on public.cartao_checklist_itens;
create trigger trg_item_feito_em before insert or update of feito on public.cartao_checklist_itens for each row execute function public.item_checklist_feito_em();

revoke all on function public.cartao_historico() from public, anon, authenticated;
revoke all on function public.cartao_responsavel_marcado() from public, anon, authenticated;
revoke all on function public.cartao_comentario_novo() from public, anon, authenticated;
revoke all on function public.cartao_historico_extra() from public, anon, authenticated;
revoke all on function public.cartao_antes_salvar() from public, anon, authenticated;
revoke all on function public.item_checklist_feito_em() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. QUADRO PADRÃO (listas + etiquetas) e um quadro por projeto
-- ---------------------------------------------------------------------
create or replace function public.preparar_quadro(p_quadro uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.quadro_listas where quadro_id = p_quadro) then return; end if;
  insert into public.quadro_listas (quadro_id, nome, posicao, conclui) values
    (p_quadro, 'A fazer', 1000, false), (p_quadro, 'Fazendo', 2000, false),
    (p_quadro, 'Revisão', 3000, false), (p_quadro, 'Feito', 4000, true);
  insert into public.quadro_etiquetas (quadro_id, nome, cor) values
    (p_quadro, 'Design', 'roxo'), (p_quadro, 'Desenvolvimento', 'azul'), (p_quadro, 'Conteúdo', 'verde'),
    (p_quadro, 'Aguardando cliente', 'amarelo'), (p_quadro, 'Bug', 'vermelho'), (p_quadro, 'Melhoria', 'ceu');
end;
$$;
revoke all on function public.preparar_quadro(uuid) from public, anon;
grant execute on function public.preparar_quadro(uuid) to authenticated;

create or replace function public.quadro_novo_padrao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.preparar_quadro(new.id);
  return new;
end; $$;
revoke all on function public.quadro_novo_padrao() from public, anon, authenticated;
drop trigger if exists trg_quadro_novo on public.quadros;
create trigger trg_quadro_novo after insert on public.quadros for each row execute function public.quadro_novo_padrao();

create or replace function public.criar_quadro_do_projeto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.quadros (tipo, projeto_id, empresa_id, nome, criado_por)
  values ('projeto', new.id, new.empresa_id, coalesce(new.codigo || ' · ', '') || new.nome, null)
  on conflict (projeto_id) where tipo = 'projeto' do nothing;
  return new;
end; $$;
revoke all on function public.criar_quadro_do_projeto() from public, anon, authenticated;
drop trigger if exists trg_quadro_do_projeto on public.projetos;
create trigger trg_quadro_do_projeto after insert on public.projetos for each row execute function public.criar_quadro_do_projeto();

-- projetos que já existem ganham o quadro deles
insert into public.quadros (tipo, projeto_id, empresa_id, nome, criado_por)
select 'projeto', p.id, p.empresa_id, coalesce(p.codigo || ' · ', '') || p.nome, null from public.projetos p
on conflict (projeto_id) where tipo = 'projeto' do nothing;

-- quadro interno inicial da equipe (só se ainda não houver nenhum interno)
insert into public.quadros (tipo, nome, descricao, fixado, criado_por)
select 'interno', 'Equipe CMKCOGIT', 'Tarefas gerais da equipe: comercial, marketing, financeiro e operação.', true, null
where not exists (select 1 from public.quadros where tipo = 'interno');

-- ---------------------------------------------------------------------
-- 8. LEMBRETE DE PRAZO (chamado pela rotina diária /api/renovacoes)
--    Avisa cada responsável uma vez por dia: cartões que vencem hoje/amanhã ou atrasados.
-- ---------------------------------------------------------------------
create or replace function public.lembrar_prazos_cartoes()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_total int := 0;
begin
  insert into public.notificacoes (usuario_id, projeto_id, tipo, titulo, mensagem, link, metadados)
  select r.usuario_id, c.projeto_id, 'tarefa',
         case when (c.prazo at time zone 'America/Sao_Paulo')::date < v_hoje then 'Tarefa atrasada: '
              when (c.prazo at time zone 'America/Sao_Paulo')::date = v_hoje then 'Vence hoje: '
              else 'Vence amanhã: ' end || left(c.titulo, 120),
         'Quadro ' || q.nome || ' · prazo ' || to_char(c.prazo at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || '.',
         'admin-quadros.html?quadro=' || c.quadro_id || '&cartao=' || c.id,
         jsonb_build_object('cartao_id', c.id, 'lembrete', v_hoje)
    from public.cartoes c
    join public.quadros q on q.id = c.quadro_id and q.arquivado_em is null
    join public.cartao_responsaveis r on r.cartao_id = c.id
   where c.concluido_em is null and c.arquivado_em is null and c.prazo is not null
     and (c.prazo at time zone 'America/Sao_Paulo')::date <= v_hoje + 1
     and not exists (select 1 from public.notificacoes n where n.usuario_id = r.usuario_id and n.tipo = 'tarefa'
                      and n.metadados->>'cartao_id' = c.id::text and n.metadados->>'lembrete' = v_hoje::text);
  get diagnostics v_total = row_count;
  return v_total;
end;
$$;
revoke all on function public.lembrar_prazos_cartoes() from public, anon, authenticated;
grant execute on function public.lembrar_prazos_cartoes() to service_role;

-- ---------------------------------------------------------------------
-- 9. STORAGE (anexos dos cartões, só admin) e TEMPO REAL
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('quadros', 'quadros', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "quadros_storage_admin" on storage.objects;
create policy "quadros_storage_admin" on storage.objects for all to authenticated
  using (bucket_id = 'quadros' and public.is_admin()) with check (bucket_id = 'quadros' and public.is_admin());

do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  foreach t in array array['cartoes', 'quadro_listas', 'cartao_comentarios'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- conferir
select (select count(*) from public.quadros) as quadros, (select count(*) from public.quadro_listas) as listas,
       (select count(*) from public.empresas) as empresas;
