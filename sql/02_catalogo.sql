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
