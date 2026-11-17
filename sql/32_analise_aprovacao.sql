-- =====================================================================
-- 32 · Análise e aprovação da CMK antes do pagamento
--
-- Toda solicitação começa em "Aguardando análise da CMK" (status em_validacao) e só vai
-- para pagamento quando um administrador aprova (status aguardando_pagamento; o checkout
-- já recusa qualquer outro status no servidor).
--
-- Status (coluna solicitacoes.status)                rótulo na plataforma
--   em_validacao          Aguardando análise da CMK
--   em_analise            Em análise                                   (novo)
--   ajustes_solicitados   Ajustes solicitados                          (novo)
--   aguardando_cliente    Aguardando aprovação do cliente              (novo)
--   aguardando_pagamento  Aprovado pela CMK — aguardando pagamento
--   paga                  Pagamento confirmado → depois do pagamento, o projeto
--                         (tabela projetos) mostra "Em desenvolvimento" e "Site entregue"
--   cancelada             Cancelada
--
-- Também cria o histórico (solicitacao_eventos), as versões da personalização
-- (solicitacao_versoes) e deixa o cliente LER os arquivos da própria solicitação.
-- Rode depois do 31. Pode rodar de novo sem problema.
-- =====================================================================

alter table public.solicitacoes drop constraint if exists solicitacoes_status_check;
alter table public.solicitacoes add constraint solicitacoes_status_check
  check (status in ('em_validacao','em_analise','ajustes_solicitados','aguardando_cliente','aguardando_pagamento','paga','cancelada'));

alter table public.solicitacoes add column if not exists versao_atual    integer not null default 1;
alter table public.solicitacoes add column if not exists versao_aprovada integer;
alter table public.solicitacoes add column if not exists analise_por     uuid references public.profiles(id) on delete set null;
alter table public.solicitacoes add column if not exists analise_em      timestamptz;

-- ---------------------------------------------------------------------
-- Histórico: cada mudança de status, mensagem da equipe e reenvio do cliente
-- ---------------------------------------------------------------------
create table if not exists public.solicitacao_eventos (
  id              uuid primary key default gen_random_uuid(),
  solicitacao_id  uuid not null references public.solicitacoes(id) on delete cascade,
  tipo            text not null,          -- criada, analise_iniciada, ajustes_solicitados, observacao, reenviada, aprovada, aguardando_cliente, cliente_aprovou, cancelada, pagamento_confirmado
  status_de       text,
  status_para     text,
  mensagem        text,
  visivel_cliente boolean not null default true,
  autor_id        uuid references public.profiles(id) on delete set null,
  autor_nome      text,
  autor_papel     text not null default 'sistema' check (autor_papel in ('cliente','admin','sistema')),
  versao          integer,
  created_at      timestamptz not null default now()
);
create index if not exists idx_sol_eventos_sol on public.solicitacao_eventos(solicitacao_id, created_at);

alter table public.solicitacao_eventos enable row level security;
drop policy if exists "sol_eventos_select" on public.solicitacao_eventos;
create policy "sol_eventos_select" on public.solicitacao_eventos
  for select using (
    public.is_admin()
    or (visivel_cliente and exists (select 1 from public.solicitacoes s where s.id = solicitacao_id and s.cliente_id = auth.uid()))
  );
-- gravação só pelo servidor (service_role), nas rotas /api/solicitacoes e /api/admin-solicitacao

-- ---------------------------------------------------------------------
-- Versões da personalização (arquivo em arquivos/solicitacoes/<id>/[vN/]personalizacao.json)
-- ---------------------------------------------------------------------
create table if not exists public.solicitacao_versoes (
  id              uuid primary key default gen_random_uuid(),
  solicitacao_id  uuid not null references public.solicitacoes(id) on delete cascade,
  numero          integer not null,
  personalizada   boolean not null default false,
  storage_path    text,
  criado_por      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint solicitacao_versoes_unica unique (solicitacao_id, numero)
);

alter table public.solicitacao_versoes enable row level security;
drop policy if exists "sol_versoes_select" on public.solicitacao_versoes;
create policy "sol_versoes_select" on public.solicitacao_versoes
  for select using (
    public.is_admin()
    or exists (select 1 from public.solicitacoes s where s.id = solicitacao_id and s.cliente_id = auth.uid())
  );

-- o cliente consulta (e reabre no editor) a personalização que ele mesmo enviou
drop policy if exists "personalizacao_storage_select" on storage.objects;
create policy "personalizacao_storage_select" on storage.objects
  for select to authenticated using (
    bucket_id = 'arquivos'
    and (storage.foldername(name))[1] = 'solicitacoes'
    and storage.filename(name) = 'personalizacao.json'
    and public.dono_pasta_solicitacao(name) = auth.uid()
  );

-- o cliente pode desistir em qualquer etapa antes do pagamento
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
  if s.status not in ('em_validacao', 'em_analise', 'ajustes_solicitados', 'aguardando_cliente', 'aguardando_pagamento') then
    raise exception 'Esta solicitação não pode mais ser cancelada';
  end if;

  update public.solicitacoes set status = 'cancelada' where id = s.id;
  update public.pagamentos set status = 'cancelado', link_pagamento = null
   where solicitacao_id = s.id and status = 'pendente';
  insert into public.solicitacao_eventos (solicitacao_id, tipo, status_de, status_para, autor_id, autor_papel, mensagem)
  values (s.id, 'cancelada', s.status, 'cancelada', auth.uid(), 'cliente', 'Cancelada pelo cliente.');
end;
$$;

revoke all on function public.cliente_cancelar_solicitacao(uuid) from public, anon;
grant execute on function public.cliente_cancelar_solicitacao(uuid) to authenticated;

-- Pagamento confirmado (sql/09 muda o status para "paga"): entra no histórico.
-- O aviso ao cliente já existe: o projeto criado dispara "Projeto iniciado... Pagamento confirmado" (sql/11).
create or replace function public.historico_pagamento_solicitacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paga' and old.status is distinct from 'paga' then
    insert into public.solicitacao_eventos (solicitacao_id, tipo, status_de, status_para, autor_papel, mensagem, versao)
    values (new.id, 'pagamento_confirmado', old.status, 'paga', 'sistema', 'Pagamento confirmado. O projeto entrou em preparação.', new.versao_aprovada);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_historico_pagamento_solicitacao on public.solicitacoes;
create trigger trg_historico_pagamento_solicitacao
  after update of status on public.solicitacoes
  for each row execute function public.historico_pagamento_solicitacao();
