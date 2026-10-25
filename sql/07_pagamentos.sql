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
