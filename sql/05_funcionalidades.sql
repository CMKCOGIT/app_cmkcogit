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
