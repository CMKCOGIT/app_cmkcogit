-- Arquivo único com 01..09 na ordem (mesmo conteúdo dos arquivos separados). Depois rode o 10 trocando o e-mail.
-- =====================================================================
-- 01_base.sql — perfis de usuário, papel (cliente/admin) e função is_admin()
-- Supabase > SQL Editor > New query > cole > Run. Pode rodar mais de uma vez.
-- =====================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------
-- PERFIS (1 por usuário do Supabase Auth)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text,
  email       text,
  telefone    text,
  role        text not null default 'cliente',
  created_at  timestamptz not null default now()
);

alter table public.profiles add column if not exists nome       text;
alter table public.profiles add column if not exists email      text;
alter table public.profiles add column if not exists telefone   text;
alter table public.profiles add column if not exists role       text not null default 'cliente';
alter table public.profiles add column if not exists created_at timestamptz not null default now();

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('cliente','admin'));

-- ---------------------------------------------------------------------
-- is_admin(): usada pelas regras de segurança (RLS) de todas as tabelas
-- security definer = lê profiles sem cair em recursão de RLS
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Cria o perfil automaticamente quando alguém se cadastra no app.
-- O "role" NUNCA vem do cadastro (ninguém vira admin por metadado).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nome, telefone)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data->>'nome'), ''), split_part(new.email, '@', 1)),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'telefone', ''), '\D', '', 'g'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- perfis de usuários que já existiam antes deste script
insert into public.profiles (id, email, nome)
select u.id, u.email, coalesce(nullif(trim(u.raw_user_meta_data->>'nome'), ''), split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Segurança: cada um vê o próprio perfil; admin vê todos.
-- O cliente só pode alterar nome e telefone (nunca o role).
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;      -- versão antiga (substituída abaixo)
drop policy if exists "profiles_update_proprio" on public.profiles;
create policy "profiles_update_proprio" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (nome, telefone) on public.profiles to authenticated;

-- trigger genérico de updated_at (usado pelas outras tabelas)
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- =====================================================================
-- 02_catalogo.sql — tabela de preços (cópia de js/data.js do site)
-- O SERVIDOR recalcula o valor a partir desta tabela; o preço que aparece
-- no navegador nunca é usado para cobrar. Se mudar preço no site, mude aqui.
-- Pode rodar mais de uma vez (atualiza os valores).
-- =====================================================================

create table if not exists public.catalogo_precos (
  id                      text primary key,           -- mesmo id do site (ex.: landing-page)
  tipo                    text not null,              -- servico | complemento
  nome                    text not null,
  preco                   numeric(12,2),
  preco_sob_medida        numeric(12,2),              -- "a partir de" do formato sob medida
  tipo_preco              text not null default 'fixed',
  mensal                  boolean not null default false,  -- mensalidade (fora do valor inicial)
  presenca_digital        boolean not null default false,  -- exige escolher modelo pronto / sob medida
  complementos_permitidos text[] not null default '{}',
  ativo                   boolean not null default true
);

alter table public.catalogo_precos add column if not exists preco_sob_medida        numeric(12,2);
alter table public.catalogo_precos add column if not exists mensal                  boolean not null default false;
alter table public.catalogo_precos add column if not exists presenca_digital        boolean not null default false;
alter table public.catalogo_precos add column if not exists complementos_permitidos text[] not null default '{}';
alter table public.catalogo_precos add column if not exists ativo                   boolean not null default true;

alter table public.catalogo_precos drop constraint if exists catalogo_precos_tipo_check;
alter table public.catalogo_precos add constraint catalogo_precos_tipo_check check (tipo in ('servico','complemento'));
alter table public.catalogo_precos drop constraint if exists catalogo_precos_tipo_preco_check;
alter table public.catalogo_precos add constraint catalogo_precos_tipo_preco_check check (tipo_preco in ('fixed','from','analysis','custom'));

alter table public.catalogo_precos enable row level security;

-- preços são públicos no site, então qualquer usuário logado pode ler
drop policy if exists "catalogo_select" on public.catalogo_precos;
create policy "catalogo_select" on public.catalogo_precos
  for select using (auth.uid() is not null);

drop policy if exists "catalogo_admin_all" on public.catalogo_precos;
create policy "catalogo_admin_all" on public.catalogo_precos
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.catalogo_precos
  (id, tipo, nome, preco, preco_sob_medida, tipo_preco, mensal, presenca_digital, complementos_permitidos)
values
  ('diagnostico',          'servico', 'Diagnóstico Inicial',                       0,    null, 'fixed', false, false, '{}'),
  ('consultoria',          'servico', 'Consultoria e Planejamento Digital',        350,  null, 'fixed', false, false, '{}'),
  ('identidade-essencial', 'servico', 'Identidade Visual Essencial',               500,  null, 'fixed', false, false, '{}'),
  ('identidade-completa',  'servico', 'Identidade Visual Completa',                990,  null, 'fixed', false, false, '{}'),
  ('landing-page',         'servico', 'Landing Page',                              500,  700,  'fixed', false, true,  array['automacao-extra','integracao-externa']),
  ('portfolio',            'servico', 'Portfólio Digital',                         600,  800,  'fixed', false, true,  array['automacao-extra','integracao-externa']),
  ('site-institucional',   'servico', 'Site Institucional',                        700,  900,  'fixed', false, true,  array['automacao-extra','integracao-externa']),
  ('loja-virtual',         'servico', 'E-commerce / Loja Virtual',                 2990, null, 'from',  false, false, array['automacao-extra','integracao-externa']),
  ('plataforma',           'servico', 'Plataforma Web Personalizada',              4990, null, 'from',  false, false, array['automacao-extra','integracao-externa']),
  ('sistema',              'servico', 'Sistemas de Gestão e CRM',                  2990, null, 'from',  false, false, array['automacao-extra','integracao-externa']),
  ('mvp',                  'servico', 'MVP e Produto Digital',                     3990, null, 'from',  false, false, array['automacao-extra','integracao-externa']),
  ('automacao',            'servico', 'Automação de Processos Administrativos',    990,  null, 'from',  false, false, array['integracao-externa']),
  ('integracao',           'servico', 'Integrações de Sistemas e Pagamentos',      990,  null, 'from',  false, false, '{}'),
  ('manutencao',           'servico', 'Manutenção Essencial',                      149,  null, 'fixed', true,  false, '{}'),
  ('suporte',              'servico', 'Suporte Técnico Contínuo',                  299,  null, 'fixed', true,  false, '{}'),
  ('evolucao',             'servico', 'Evolução Contínua',                         690,  null, 'from',  true,  false, '{}'),
  ('automacao-extra',      'complemento', 'Automação de Processos Administrativos', 990, null, 'from',  false, false, '{}'),
  ('integracao-externa',   'complemento', 'Integrações de Sistemas e Pagamentos',   990, null, 'from',  false, false, '{}')
on conflict (id) do update set
  tipo = excluded.tipo, nome = excluded.nome, preco = excluded.preco,
  preco_sob_medida = excluded.preco_sob_medida, tipo_preco = excluded.tipo_preco,
  mensal = excluded.mensal, presenca_digital = excluded.presenca_digital,
  complementos_permitidos = excluded.complementos_permitidos;

-- =====================================================================
-- 03_projetos_etapas.sql — projetos (o que o cliente comprou) e as 8 etapas
-- da metodologia. Mesma estrutura do seu SQL original (status_projeto,
-- etapa_atual, dominio...) + ligação com a solicitação vinda do site.
-- Pode rodar mais de uma vez.
-- =====================================================================

create sequence if not exists public.seq_codigo_projeto start 100;

create table if not exists public.projetos (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references public.profiles(id) on delete cascade,
  codigo            text unique,
  nome              text not null,
  tipo              text not null default 'institucional',
  dominio           text,
  etapa_atual       int  not null default 1,
  status_projeto    text not null default 'em_andamento',
  status_pagamento  text not null default 'pendente',
  valor_total       numeric(12,2) not null default 0,
  previsao_entrega  date,
  created_at        timestamptz not null default now()
);

alter table public.projetos add column if not exists dominio          text;
alter table public.projetos add column if not exists etapa_atual      int not null default 1;
alter table public.projetos add column if not exists status_projeto   text not null default 'em_andamento';
alter table public.projetos add column if not exists previsao_entrega date;
alter table public.projetos add column if not exists solicitacao_id   uuid;   -- FK no 06
alter table public.projetos add column if not exists updated_at       timestamptz not null default now();

-- tipos novos (loja, automação, consultoria, identidade) e status "reembolsado"
alter table public.projetos drop constraint if exists projetos_tipo_check;
alter table public.projetos add constraint projetos_tipo_check
  check (tipo in ('portfolio','landing_page','institucional','loja','saas','sistema','automacao','consultoria','identidade','outro'));
alter table public.projetos drop constraint if exists projetos_status_projeto_check;
alter table public.projetos add constraint projetos_status_projeto_check
  check (status_projeto in ('em_andamento','aguardando_cliente','concluido','pausado','cancelado'));
alter table public.projetos drop constraint if exists projetos_status_pagamento_check;
alter table public.projetos add constraint projetos_status_pagamento_check
  check (status_pagamento in ('pendente','parcial','pago','atrasado','reembolsado'));
alter table public.projetos drop constraint if exists projetos_etapa_atual_check;
alter table public.projetos add constraint projetos_etapa_atual_check check (etapa_atual between 1 and 8);

create index if not exists idx_projetos_cliente on public.projetos(cliente_id);

drop trigger if exists trg_touch_projetos on public.projetos;
create trigger trg_touch_projetos before update on public.projetos
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- ETAPAS (8 por projeto, criadas automaticamente)
-- ---------------------------------------------------------------------
create table if not exists public.projeto_etapas (
  id              uuid primary key default gen_random_uuid(),
  projeto_id      uuid not null references public.projetos(id) on delete cascade,
  ordem           int  not null check (ordem between 1 and 8),
  nome            text not null,
  status          text not null default 'pendente' check (status in ('pendente','em_andamento','concluida')),
  data_prevista   date,
  data_concluida  date,
  unique (projeto_id, ordem)
);

create or replace function public.criar_etapas_padrao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.projeto_etapas (projeto_id, ordem, nome, status) values
    (new.id, 1, 'Projeto Confirmado', 'em_andamento'),
    (new.id, 2, 'Preparação',         'pendente'),
    (new.id, 3, 'Estratégia',         'pendente'),
    (new.id, 4, 'Design',             'pendente'),
    (new.id, 5, 'Sua Aprovação',      'pendente'),
    (new.id, 6, 'Construção',         'pendente'),
    (new.id, 7, 'Revisão Final',      'pendente'),
    (new.id, 8, 'Publicado',          'pendente')
  on conflict (projeto_id, ordem) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_criar_etapas on public.projetos;
create trigger trg_criar_etapas
  after insert on public.projetos
  for each row execute function public.criar_etapas_padrao();

-- ---------------------------------------------------------------------
-- Segurança: cliente vê só os dele; admin vê e edita tudo
-- ---------------------------------------------------------------------
alter table public.projetos       enable row level security;
alter table public.projeto_etapas enable row level security;

drop policy if exists "projetos_select" on public.projetos;
create policy "projetos_select" on public.projetos
  for select using (cliente_id = auth.uid() or public.is_admin());

drop policy if exists "projetos_admin_all" on public.projetos;
create policy "projetos_admin_all" on public.projetos
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "etapas_select" on public.projeto_etapas;
create policy "etapas_select" on public.projeto_etapas
  for select using (
    public.is_admin() or exists (
      select 1 from public.projetos p where p.id = projeto_etapas.projeto_id and p.cliente_id = auth.uid()
    )
  );

drop policy if exists "etapas_admin_all" on public.projeto_etapas;
create policy "etapas_admin_all" on public.projeto_etapas
  for all using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
-- 04_pendencias_arquivos.sql — o que o cliente precisa decidir/aprovar e
-- os arquivos do projeto. Igual ao seu SQL original. Pode rodar mais de uma vez.
-- =====================================================================

create table if not exists public.pendencias (
  id          uuid primary key default gen_random_uuid(),
  projeto_id  uuid not null references public.projetos(id) on delete cascade,
  titulo      text not null,
  descricao   text,
  prazo       timestamptz,
  resolvida   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.arquivos (
  id            uuid primary key default gen_random_uuid(),
  projeto_id    uuid not null references public.projetos(id) on delete cascade,
  nome          text not null,
  url           text,                 -- link externo OU
  storage_path  text,                 -- caminho no Supabase Storage (bucket "arquivos")
  created_at    timestamptz not null default now()
);

alter table public.pendencias enable row level security;
alter table public.arquivos   enable row level security;

drop policy if exists "pendencias_select" on public.pendencias;
create policy "pendencias_select" on public.pendencias
  for select using (
    public.is_admin() or exists (
      select 1 from public.projetos p where p.id = pendencias.projeto_id and p.cliente_id = auth.uid()
    )
  );

drop policy if exists "pendencias_admin_all" on public.pendencias;
create policy "pendencias_admin_all" on public.pendencias
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "arquivos_select" on public.arquivos;
create policy "arquivos_select" on public.arquivos
  for select using (
    public.is_admin() or exists (
      select 1 from public.projetos p where p.id = arquivos.projeto_id and p.cliente_id = auth.uid()
    )
  );

drop policy if exists "arquivos_admin_all" on public.arquivos;
create policy "arquivos_admin_all" on public.arquivos
  for all using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
-- 05_funcionalidades.sql — catálogo de funcionalidades extras e os pedidos
-- por projeto (tela "Adquirir nova funcionalidade"). Igual ao seu SQL
-- original. A função que cria o pedido + cobrança fica no 07 (depende de
-- pagamentos). Pode rodar mais de uma vez.
-- =====================================================================

create table if not exists public.funcionalidades (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  nome       text not null,
  descricao  text,
  preco      numeric(12,2) not null default 0,
  ativo      boolean not null default true
);

create table if not exists public.projeto_funcionalidades (
  id                 uuid primary key default gen_random_uuid(),
  projeto_id         uuid not null references public.projetos(id) on delete cascade,
  funcionalidade_id  uuid not null references public.funcionalidades(id),
  valor              numeric(12,2) not null,
  status             text not null default 'aguardando_pagamento'
                     check (status in ('aguardando_pagamento','paga','em_andamento','entregue','cancelada')),
  created_at         timestamptz not null default now()
);

create index if not exists idx_projfunc_projeto on public.projeto_funcionalidades(projeto_id);

alter table public.funcionalidades         enable row level security;
alter table public.projeto_funcionalidades enable row level security;

drop policy if exists "func_select" on public.funcionalidades;
create policy "func_select" on public.funcionalidades
  for select using (auth.uid() is not null and (ativo or public.is_admin()));

drop policy if exists "func_admin_all" on public.funcionalidades;
create policy "func_admin_all" on public.funcionalidades
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "projfunc_select" on public.projeto_funcionalidades;
create policy "projfunc_select" on public.projeto_funcionalidades
  for select using (
    public.is_admin() or exists (
      select 1 from public.projetos p where p.id = projeto_funcionalidades.projeto_id and p.cliente_id = auth.uid()
    )
  );

drop policy if exists "projfunc_admin_all" on public.projeto_funcionalidades;
create policy "projfunc_admin_all" on public.projeto_funcionalidades
  for all using (public.is_admin()) with check (public.is_admin());

-- catálogo inicial (não sobrescreve o que você já editou)
insert into public.funcionalidades (slug, nome, descricao, preco) values
  ('portal-clientes',  'Portal Privado de Clientes', 'Área logada para clientes acessarem documentos, relatórios e aprovações.', 2500.00),
  ('whatsapp-crm',     'Automação via WhatsApp & CRM', 'Formulário do site integrado ao WhatsApp e ao CRM para qualificar leads.', 1800.00),
  ('dashboard',        'Dashboard de Gestão', 'Painel com indicadores operacionais e financeiros em tempo real.', 3200.00),
  ('pagamentos-online','Pagamentos Online (Pix/Cartão)', 'Cobrança integrada ao site com Pix e cartão.', 1500.00),
  ('blog-seo',         'Blog + SEO', 'Blog administrável e otimização de SEO técnico.', 900.00)
on conflict (slug) do nothing;

-- =====================================================================
-- 06_solicitacoes.sql — o que o cliente montou no site (diagnóstico da
-- página inicial ou "Monte sua solução"), já ligado à conta dele.
--
--   preço fechado (ex.: modelo pronto)   -> aguardando_pagamento
--   sob medida / "a partir de"           -> em_validacao -> admin define valor -> aguardando_pagamento
--   pagamento aprovado                   -> paga (o projeto é criado com as 8 etapas)
--
-- Quem cria a linha é o servidor (api/solicitacoes.js), depois do login,
-- recalculando o preço pelo catálogo. Pode rodar mais de uma vez.
-- Se você rodou os rascunhos antigos (sql-separado), rode o 00 antes.
-- =====================================================================

create sequence if not exists public.seq_solicitacao start 1;

create table if not exists public.solicitacoes (
  id               uuid primary key default gen_random_uuid(),
  codigo           text unique not null
                   default ('PLN-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-' || lpad(nextval('public.seq_solicitacao')::text, 4, '0')),
  cliente_id       uuid not null references public.profiles(id) on delete cascade,
  ref_site         text not null,                 -- id aleatório gerado no site (evita duplicar ao recarregar)
  origem           text not null default 'configurador',
  selecao          jsonb not null,                -- objetivos, serviços, complementos (só ids)
  resumo           jsonb not null default '{}'::jsonb,  -- itens e valores calculados pelo servidor
  notas            text,                          -- contexto que o cliente escreveu no site
  estruturado      boolean not null default false,
  tipo_preco       text not null default 'custom',
  valor_calculado  numeric(12,2) not null default 0,
  valor_final      numeric(12,2),                 -- valor que será cobrado
  observacao_admin text,
  status           text not null default 'em_validacao',
  projeto_id       uuid references public.projetos(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint solicitacoes_ref_unica unique (cliente_id, ref_site)
);

alter table public.solicitacoes drop constraint if exists solicitacoes_origem_check;
alter table public.solicitacoes add constraint solicitacoes_origem_check
  check (origem in ('configurador','diagnostico'));
alter table public.solicitacoes drop constraint if exists solicitacoes_tipo_preco_check;
alter table public.solicitacoes add constraint solicitacoes_tipo_preco_check
  check (tipo_preco in ('fixed','from','free','custom'));
alter table public.solicitacoes drop constraint if exists solicitacoes_status_check;
alter table public.solicitacoes add constraint solicitacoes_status_check
  check (status in ('em_validacao','aguardando_pagamento','paga','cancelada'));

create index if not exists idx_solicitacoes_cliente on public.solicitacoes(cliente_id, created_at desc);
create index if not exists idx_solicitacoes_status  on public.solicitacoes(status);

drop trigger if exists trg_touch_solicitacoes on public.solicitacoes;
create trigger trg_touch_solicitacoes before update on public.solicitacoes
  for each row execute function public.touch_updated_at();

-- projeto -> solicitação de origem
alter table public.projetos drop constraint if exists projetos_solicitacao_fk;
alter table public.projetos add constraint projetos_solicitacao_fk
  foreign key (solicitacao_id) references public.solicitacoes(id) on delete set null;

alter table public.solicitacoes enable row level security;

drop policy if exists "solicitacoes_select" on public.solicitacoes;
create policy "solicitacoes_select" on public.solicitacoes
  for select using (cliente_id = auth.uid() or public.is_admin());

drop policy if exists "solicitacoes_admin_all" on public.solicitacoes;
create policy "solicitacoes_admin_all" on public.solicitacoes
  for all using (public.is_admin()) with check (public.is_admin());
-- cliente NÃO insere nem altera direto: criação pelo servidor, cancelamento pela função do 08.

-- =====================================================================
-- 07_pagamentos.sql — cobranças pelo Mercado Pago (Checkout Pro), registro
-- dos avisos do Mercado Pago e a função "solicitar funcionalidade".
-- Ajusta a sua tabela pagamentos original (não apaga dados).
-- Pode rodar mais de uma vez.
-- =====================================================================

create table if not exists public.pagamentos (
  id                         uuid primary key default gen_random_uuid(),
  cliente_id                 uuid not null references public.profiles(id) on delete cascade,
  projeto_id                 uuid references public.projetos(id) on delete set null,
  projeto_funcionalidade_id  uuid references public.projeto_funcionalidades(id) on delete set null,
  descricao                  text not null,
  valor                      numeric(12,2) not null,
  metodo                     text,
  status                     text not null default 'pendente',
  gateway_id                 text,
  pix_copia_cola             text,
  link_pagamento             text,
  vencimento                 date,
  pago_em                    timestamptz,
  created_at                 timestamptz not null default now()
);

alter table public.pagamentos add column if not exists projeto_funcionalidade_id uuid references public.projeto_funcionalidades(id) on delete set null;
alter table public.pagamentos add column if not exists solicitacao_id       uuid;
alter table public.pagamentos add column if not exists link_pagamento       text;
alter table public.pagamentos add column if not exists mp_preference_id     text;
alter table public.pagamentos add column if not exists mp_payment_id        text;   -- pagamento APROVADO no Mercado Pago
alter table public.pagamentos add column if not exists mp_ultimo_status     text;   -- último status informado
alter table public.pagamentos add column if not exists mp_ultimo_payment_id text;
alter table public.pagamentos add column if not exists updated_at           timestamptz not null default now();
alter table public.pagamentos alter column metodo drop not null;

-- ligação com solicitacoes (recria mesmo que a coluna já existisse de um rascunho antigo)
alter table public.pagamentos drop constraint if exists pagamentos_solicitacao_id_fkey;
alter table public.pagamentos add constraint pagamentos_solicitacao_id_fkey
  foreign key (solicitacao_id) references public.solicitacoes(id) on delete set null;

alter table public.pagamentos drop constraint if exists pagamentos_valor_check;
alter table public.pagamentos add constraint pagamentos_valor_check check (valor > 0);
-- 'falhou' continua aceito para não quebrar cobranças antigas
alter table public.pagamentos drop constraint if exists pagamentos_status_check;
alter table public.pagamentos add constraint pagamentos_status_check
  check (status in ('pendente','pago','falhou','cancelado','reembolsado'));
-- no Checkout Pro o cliente escolhe o método na tela do Mercado Pago (Pix, cartão, boleto...)
alter table public.pagamentos drop constraint if exists pagamentos_metodo_check;
alter table public.pagamentos add constraint pagamentos_metodo_check
  check (metodo is null or metodo in ('pix','cartao','boleto','outro'));

create index if not exists idx_pagamentos_cliente     on public.pagamentos(cliente_id, created_at desc);
create index if not exists idx_pagamentos_solicitacao on public.pagamentos(solicitacao_id);
create index if not exists idx_pagamentos_projeto     on public.pagamentos(projeto_id);
-- uma cobrança pendente por solicitação (dois cliques em "Pagar" não duplicam)
create unique index if not exists uq_pagamento_pendente_solicitacao
  on public.pagamentos(solicitacao_id) where status = 'pendente' and solicitacao_id is not null;
-- o mesmo pagamento do Mercado Pago nunca confirma duas cobranças
create unique index if not exists uq_pagamento_mp
  on public.pagamentos(mp_payment_id) where mp_payment_id is not null;

drop trigger if exists trg_touch_pagamentos on public.pagamentos;
create trigger trg_touch_pagamentos before update on public.pagamentos
  for each row execute function public.touch_updated_at();

alter table public.pagamentos enable row level security;

drop policy if exists "pagamentos_select" on public.pagamentos;
create policy "pagamentos_select" on public.pagamentos
  for select using (cliente_id = auth.uid() or public.is_admin());

drop policy if exists "pagamentos_admin_all" on public.pagamentos;
create policy "pagamentos_admin_all" on public.pagamentos
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Registro de cada aviso/consulta ao Mercado Pago (só admin lê)
-- ---------------------------------------------------------------------
create table if not exists public.pagamento_eventos (
  id             bigserial primary key,
  pagamento_id   uuid references public.pagamentos(id) on delete set null,
  mp_payment_id  text,
  origem         text not null,      -- webhook | retorno | verificacao
  status_mp      text,
  status_detalhe text,
  valor_mp       numeric(12,2),
  resultado      text,               -- pago, valor_divergente, ja_processado...
  created_at     timestamptz not null default now()
);

create index if not exists idx_pagamento_eventos_pagamento on public.pagamento_eventos(pagamento_id, created_at desc);

alter table public.pagamento_eventos enable row level security;
drop policy if exists "pagamento_eventos_admin" on public.pagamento_eventos;
create policy "pagamento_eventos_admin" on public.pagamento_eventos
  for select using (public.is_admin());

-- ---------------------------------------------------------------------
-- SOLICITAR FUNCIONALIDADE: cria o pedido + a cobrança pendente.
-- O preço vem do catálogo. O método (Pix/cartão/boleto) é escolhido depois,
-- no Mercado Pago (o parâmetro p_metodo fica só por compatibilidade).
-- ---------------------------------------------------------------------
create or replace function public.solicitar_funcionalidade(
  p_projeto_id        uuid,
  p_funcionalidade_id uuid,
  p_metodo            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_func      public.funcionalidades%rowtype;
  v_proj      public.projetos%rowtype;
  v_pedido_id uuid;
  v_pag_id    uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_proj from public.projetos where id = p_projeto_id and cliente_id = auth.uid();
  if not found then raise exception 'Projeto não encontrado'; end if;
  if v_proj.status_projeto = 'cancelado' then raise exception 'Projeto cancelado'; end if;

  select * into v_func from public.funcionalidades where id = p_funcionalidade_id and ativo;
  if not found then raise exception 'Funcionalidade indisponível'; end if;
  if v_func.preco <= 0 then raise exception 'Funcionalidade sem preço definido. Fale conosco.'; end if;

  -- mesmo pedido ainda aguardando pagamento: reaproveita a cobrança
  select pf.id, pg.id into v_pedido_id, v_pag_id
    from public.projeto_funcionalidades pf
    join public.pagamentos pg on pg.projeto_funcionalidade_id = pf.id and pg.status = 'pendente'
   where pf.projeto_id = p_projeto_id and pf.funcionalidade_id = v_func.id and pf.status = 'aguardando_pagamento'
   limit 1;
  if v_pag_id is not null then return v_pag_id; end if;

  insert into public.projeto_funcionalidades (projeto_id, funcionalidade_id, valor)
  values (p_projeto_id, v_func.id, v_func.preco)
  returning id into v_pedido_id;

  insert into public.pagamentos (cliente_id, projeto_id, projeto_funcionalidade_id, descricao, valor, vencimento)
  values (auth.uid(), p_projeto_id, v_pedido_id, 'Funcionalidade: ' || v_func.nome || ' (' || coalesce(v_proj.codigo, v_proj.nome) || ')',
          v_func.preco, current_date + 3)
  returning id into v_pag_id;

  return v_pag_id;
end;
$$;

revoke all on function public.solicitar_funcionalidade(uuid, uuid, text) from public, anon;
grant execute on function public.solicitar_funcionalidade(uuid, uuid, text) to authenticated;

-- =====================================================================
-- 08_funcoes_cliente_admin.sql
--   cliente_cancelar_solicitacao -> o cliente desiste antes de pagar
--   admin_decidir_solicitacao    -> admin valida o sob medida (define o valor) ou cancela
--   admin_atualizar_projeto      -> admin avança a etapa, muda status, previsão e domínio
-- Pode rodar mais de uma vez.
-- =====================================================================

create or replace function public.cliente_cancelar_solicitacao(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.solicitacoes%rowtype;
begin
  if auth.uid() is null then raise exception 'Faça login para continuar'; end if;

  select * into s from public.solicitacoes where id = p_id and cliente_id = auth.uid() for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if s.status not in ('em_validacao', 'aguardando_pagamento') then
    raise exception 'Esta solicitação não pode mais ser cancelada';
  end if;

  update public.solicitacoes set status = 'cancelada' where id = s.id;
  update public.pagamentos set status = 'cancelado', link_pagamento = null
   where solicitacao_id = s.id and status = 'pendente';
end;
$$;

revoke all on function public.cliente_cancelar_solicitacao(uuid) from public, anon;
grant execute on function public.cliente_cancelar_solicitacao(uuid) to authenticated;


create or replace function public.admin_decidir_solicitacao(
  p_id         uuid,
  p_acao       text,              -- 'aprovar' | 'cancelar'
  p_valor      numeric default null,
  p_observacao text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.solicitacoes%rowtype;
  v_obs text := nullif(left(trim(coalesce(p_observacao, '')), 500), '');
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;

  select * into s from public.solicitacoes where id = p_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;

  if p_acao = 'aprovar' then
    if s.status not in ('em_validacao', 'aguardando_pagamento') then
      raise exception 'Só é possível definir valor de solicitações em validação ou aguardando pagamento';
    end if;
    if p_valor is null or p_valor <= 0 or p_valor > 1000000 then
      raise exception 'Informe um valor válido';
    end if;

    update public.solicitacoes
       set valor_final = round(p_valor, 2),
           observacao_admin = coalesce(v_obs, observacao_admin),
           status = 'aguardando_pagamento'
     where id = s.id;

    -- cobrança pendente com valor antigo: atualiza e invalida o link antigo
    -- (se alguém pagar o link antigo, o valor não confere e nada é liberado)
    update public.pagamentos
       set valor = round(p_valor, 2), link_pagamento = null, mp_preference_id = null
     where solicitacao_id = s.id and status = 'pendente' and valor <> round(p_valor, 2);

  elsif p_acao = 'cancelar' then
    if s.status in ('paga', 'cancelada') then raise exception 'Solicitação já finalizada'; end if;
    update public.solicitacoes set status = 'cancelada', observacao_admin = coalesce(v_obs, observacao_admin)
     where id = s.id;
    update public.pagamentos set status = 'cancelado', link_pagamento = null
     where solicitacao_id = s.id and status = 'pendente';
  else
    raise exception 'Ação inválida';
  end if;
end;
$$;

revoke all on function public.admin_decidir_solicitacao(uuid, text, numeric, text) from public, anon;
grant execute on function public.admin_decidir_solicitacao(uuid, text, numeric, text) to authenticated;


-- Avança o projeto: etapas anteriores ficam "concluída", a atual "em andamento".
-- Status "concluido" fecha todas as 8 etapas.
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

-- =====================================================================
-- 09_aplicar_pagamento_mp.sql — aplica o que o Mercado Pago informou.
-- Chamada SÓ pelo servidor (service_role): webhook, volta do checkout e
-- botão "verificar pagamento". O servidor sempre consulta o pagamento na
-- API do Mercado Pago antes de chamar esta função.
--
--   approved + valor e moeda conferem + cobrança pendente:
--       solicitação do site -> cria o projeto (8 etapas) com previsão de entrega
--       funcionalidade      -> pedido vira "paga"
--   approved com valor diferente -> nada é liberado (valor_divergente)
--   refunded / charged_back      -> reembolsado
--   pending / rejected / ...     -> continua pendente (o cliente pode tentar de novo)
-- Idempotente: o mesmo aviso repetido não muda nada.
--
-- PRAZO: projetos maiores demoram mais. Dias úteis estimados por tipo
-- (ajuste à vontade na função prazo_estimado_dias) + 5 por complemento
-- + 10 por solução extra. O admin pode mudar a previsão depois.
-- =====================================================================

create or replace function public.prazo_estimado_dias(p_resumo jsonb)
returns int
language plpgsql
immutable
as $$
declare
  v_dias  int := 0;
  v_item  jsonb;
  v_base  int;
  v_qtd   int := 0;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_resumo->'itens', '[]'::jsonb)) loop
    v_base := case v_item->>'id'
      when 'landing-page'         then 10
      when 'portfolio'            then 12
      when 'site-institucional'   then 15
      when 'identidade-essencial' then 10
      when 'identidade-completa'  then 20
      when 'consultoria'          then 7
      when 'diagnostico'          then 5
      when 'automacao'            then 20
      when 'integracao'           then 20
      when 'loja-virtual'         then 35
      when 'sistema'              then 45
      when 'mvp'                  then 50
      when 'plataforma'           then 60
      else 20 end;
    if v_item->>'modelo' = 'sob-medida' then v_base := v_base + 10; end if;
    v_dias := greatest(v_dias, v_base);   -- a maior solução define a base
    v_qtd := v_qtd + 1;
  end loop;
  v_dias := v_dias + greatest(v_qtd - 1, 0) * 10
                   + jsonb_array_length(coalesce(p_resumo->'complementos', '[]'::jsonb)) * 5;
  return greatest(v_dias, 5);
end;
$$;

-- soma dias úteis (seg-sex) a uma data
create or replace function public.somar_dias_uteis(p_inicio date, p_dias int)
returns date
language sql
immutable
as $$
  select d::date from generate_series(p_inicio + 1, p_inicio + p_dias * 2 + 14, interval '1 day') d
   where extract(isodow from d) < 6
   order by d offset greatest(p_dias, 1) - 1 limit 1;
$$;


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
      v_res := 'cobranca_' || pg.status;          -- ex.: pagou depois de a cobrança ser cancelada
    else
      update public.pagamentos
         set status = 'pago', metodo = v_metodo, pago_em = coalesce(p_pago_em, now()),
             mp_payment_id = p_mp_payment_id, gateway_id = p_mp_payment_id,
             mp_ultimo_status = p_status, mp_ultimo_payment_id = p_mp_payment_id, link_pagamento = null
       where id = pg.id;

      -- funcionalidade avulsa de um projeto que já existe
      if pg.projeto_funcionalidade_id is not null then
        update public.projeto_funcionalidades set status = 'paga'
         where id = pg.projeto_funcionalidade_id and status = 'aguardando_pagamento';
      end if;

      -- solicitação vinda do site: vira projeto (as 8 etapas são criadas pelo trigger)
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
      v_res := 'reembolsado';
    else
      v_res := 'ignorado';
    end if;

  else
    -- pending, in_process, authorized, rejected, cancelled...
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

