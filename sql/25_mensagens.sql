-- =====================================================================
-- 25_mensagens.sql — Mensagens dentro da plataforma (rode depois do 24).
--   · Conversa cliente ↔ equipe (uma por cliente; todos os admins participam)
--   · Conversas da equipe: grupo "Equipe" (todos os admins) e diretas entre admins
--   · Mensagens de texto, áudio e arquivo; editar e apagar a própria mensagem
--   · Nota interna: só a equipe vê (o RLS esconde do cliente, inclusive o anexo)
--   · Modelos de mensagem (só a equipe) para montar e enviar pelo WhatsApp manualmente
--   · Não lidas por conversa, aviso no sino e tempo real
-- Arquivos no Storage, bucket privado "mensagens": <conversa>/<publico|interno>/<arquivo>
-- Pode rodar mais de uma vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------
create table if not exists public.conversas (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null,
  cliente_id  uuid references public.profiles(id) on delete cascade,
  membros     uuid[],            -- equipe: null = grupo da equipe toda; [a, b] = conversa direta
  created_at  timestamptz not null default now(),
  constraint conversas_tipo_check check (tipo in ('cliente', 'equipe')),
  constraint conversas_forma_check check (
    (tipo = 'cliente' and cliente_id is not null and membros is null)
    or (tipo = 'equipe' and cliente_id is null and (membros is null or cardinality(membros) = 2))
  )
);
create unique index if not exists uq_conversa_cliente on public.conversas(cliente_id) where tipo = 'cliente';
create unique index if not exists uq_conversa_equipe_grupo on public.conversas(tipo) where tipo = 'equipe' and membros is null;
create unique index if not exists uq_conversa_equipe_direta on public.conversas(membros) where tipo = 'equipe' and membros is not null;

create table if not exists public.mensagens (
  id             uuid primary key default gen_random_uuid(),
  conversa_id    uuid not null references public.conversas(id) on delete cascade,
  autor_id       uuid references public.profiles(id) on delete set null,
  autor_nome     text,
  autor_papel    text,
  tipo           text not null default 'texto',
  corpo          text,
  interna        boolean not null default false,
  anexo_path     text,
  anexo_nome     text,
  anexo_mime     text,
  anexo_tamanho  bigint,
  duracao_seg    int,
  editada_em     timestamptz,
  apagada_em     timestamptz,
  created_at     timestamptz not null default now(),
  constraint mensagens_tipo_check check (tipo in ('texto', 'audio', 'arquivo')),
  constraint mensagens_corpo_tamanho check (corpo is null or char_length(corpo) <= 5000),
  constraint mensagens_conteudo_check check (
    apagada_em is not null
    or (tipo = 'texto' and nullif(btrim(corpo), '') is not null)
    or (tipo in ('audio', 'arquivo') and anexo_path is not null)
  )
);
create index if not exists idx_mensagens_conversa on public.mensagens(conversa_id, created_at desc);

create table if not exists public.conversa_leituras (
  conversa_id uuid not null references public.conversas(id) on delete cascade,
  usuario_id  uuid not null references public.profiles(id) on delete cascade,
  lida_em     timestamptz not null default now(),
  primary key (conversa_id, usuario_id)
);

create table if not exists public.modelos_mensagem (
  id           uuid primary key default gen_random_uuid(),
  autor_id     uuid references public.profiles(id) on delete set null default auth.uid(),
  titulo       text not null,
  categoria    text not null default 'geral',
  corpo        text not null,
  compartilhado boolean not null default true,
  usos         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint modelos_titulo_check check (char_length(btrim(titulo)) between 1 and 120),
  constraint modelos_corpo_check check (char_length(btrim(corpo)) between 1 and 5000)
);

drop trigger if exists trg_modelos_updated_at on public.modelos_mensagem;
create trigger trg_modelos_updated_at before update on public.modelos_mensagem
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 2. QUEM VÊ O QUÊ
-- ---------------------------------------------------------------------
create or replace function public.pode_ver_conversa(p_conversa uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversas c
     where c.id = p_conversa
       and (
         (c.tipo = 'cliente' and (c.cliente_id = auth.uid() or public.is_admin()))
         or (c.tipo = 'equipe' and public.is_admin() and (c.membros is null or auth.uid() = any (c.membros)))
       )
  );
$$;
revoke all on function public.pode_ver_conversa(uuid) from public, anon;
grant execute on function public.pode_ver_conversa(uuid) to authenticated;

-- caminho do Storage: <conversa>/<publico|interno>/<arquivo>; 'interno' só a equipe
create or replace function public.pode_usar_anexo_mensagem(p_nome text, p_enviar boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pastas text[] := storage.foldername(p_nome);
  v_conversa uuid;
begin
  if coalesce(array_length(v_pastas, 1), 0) < 2 or v_pastas[1] !~* '^[0-9a-f-]{36}$' then return false; end if;
  v_conversa := v_pastas[1]::uuid;
  if not public.pode_ver_conversa(v_conversa) then return false; end if;
  if v_pastas[2] = 'publico' then return true; end if;
  return v_pastas[2] = 'interno' and public.is_admin();
end;
$$;
revoke all on function public.pode_usar_anexo_mensagem(text, boolean) from public, anon;
grant execute on function public.pode_usar_anexo_mensagem(text, boolean) to authenticated;

alter table public.conversas enable row level security;
alter table public.mensagens enable row level security;
alter table public.conversa_leituras enable row level security;
alter table public.modelos_mensagem enable row level security;

drop policy if exists "conversas_select" on public.conversas;
create policy "conversas_select" on public.conversas for select using (public.pode_ver_conversa(id));
revoke insert, update, delete on public.conversas from anon, authenticated; -- criadas pelas funções abaixo

drop policy if exists "mensagens_select" on public.mensagens;
create policy "mensagens_select" on public.mensagens for select using (
  public.pode_ver_conversa(conversa_id) and (not interna or public.is_admin())
);

drop policy if exists "mensagens_insert" on public.mensagens;
create policy "mensagens_insert" on public.mensagens for insert with check (
  autor_id = auth.uid()
  and public.pode_ver_conversa(conversa_id)
  and (not interna or (public.is_admin() and exists (
        select 1 from public.conversas c where c.id = conversa_id and c.tipo = 'cliente')))
  and (anexo_path is null or (
        split_part(anexo_path, '/', 1) = conversa_id::text
        and split_part(anexo_path, '/', 2) = case when interna then 'interno' else 'publico' end))
);

drop policy if exists "mensagens_update_autor" on public.mensagens;
create policy "mensagens_update_autor" on public.mensagens for update
  using (autor_id = auth.uid() and apagada_em is null)
  with check (autor_id = auth.uid());

revoke insert, update, delete on public.mensagens from anon, authenticated;
grant insert (conversa_id, autor_id, tipo, corpo, interna, anexo_path, anexo_nome, anexo_mime, anexo_tamanho, duracao_seg)
  on public.mensagens to authenticated;
grant update (corpo, apagada_em) on public.mensagens to authenticated;

drop policy if exists "leituras_select" on public.conversa_leituras;
create policy "leituras_select" on public.conversa_leituras for select using (usuario_id = auth.uid());
revoke insert, update, delete on public.conversa_leituras from anon, authenticated;

drop policy if exists "modelos_select" on public.modelos_mensagem;
create policy "modelos_select" on public.modelos_mensagem for select using (
  public.is_admin() and (compartilhado or autor_id = auth.uid() or autor_id is null)
);
drop policy if exists "modelos_insert" on public.modelos_mensagem;
create policy "modelos_insert" on public.modelos_mensagem for insert with check (public.is_admin() and autor_id = auth.uid());
drop policy if exists "modelos_update" on public.modelos_mensagem;
create policy "modelos_update" on public.modelos_mensagem for update
  using (public.is_admin() and (compartilhado or autor_id = auth.uid() or autor_id is null))
  with check (public.is_admin());
drop policy if exists "modelos_delete" on public.modelos_mensagem;
create policy "modelos_delete" on public.modelos_mensagem for delete
  using (public.is_admin() and (autor_id = auth.uid() or autor_id is null or compartilhado));
grant select, insert, delete on public.modelos_mensagem to authenticated;
revoke update on public.modelos_mensagem from authenticated;
grant update (titulo, categoria, corpo, compartilhado) on public.modelos_mensagem to authenticated;

-- ---------------------------------------------------------------------
-- 3. GATILHOS: autor (nunca vem do navegador), edição e exclusão
-- ---------------------------------------------------------------------
create or replace function public.mensagem_antes_inserir()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil public.profiles%rowtype;
begin
  select * into v_perfil from public.profiles where id = new.autor_id;
  new.autor_nome  := coalesce(nullif(btrim(v_perfil.nome), ''), split_part(v_perfil.email, '@', 1), 'Usuário');
  new.autor_papel := coalesce(v_perfil.role, 'cliente');
  new.corpo       := nullif(btrim(new.corpo), '');
  new.created_at  := now();
  new.editada_em  := null;
  new.apagada_em  := null;
  if new.tipo = 'texto' then
    new.anexo_path := null; new.anexo_nome := null; new.anexo_mime := null; new.anexo_tamanho := null; new.duracao_seg := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_mensagem_antes_inserir on public.mensagens;
create trigger trg_mensagem_antes_inserir before insert on public.mensagens
  for each row execute function public.mensagem_antes_inserir();

create or replace function public.mensagem_antes_alterar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.apagada_em is not null then
    raise exception 'Mensagem apagada não pode ser alterada.';
  end if;
  if new.apagada_em is not null then             -- apagar: some o conteúdo para todos
    new.apagada_em := now();
    new.corpo := null; new.anexo_path := null; new.anexo_nome := null; new.anexo_mime := null;
    new.anexo_tamanho := null; new.duracao_seg := null;
    return new;
  end if;
  new.corpo := nullif(btrim(new.corpo), '');
  if new.corpo is distinct from old.corpo then
    if old.tipo = 'texto' and new.corpo is null then
      raise exception 'A mensagem não pode ficar vazia.';
    end if;
    new.editada_em := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_mensagem_antes_alterar on public.mensagens;
create trigger trg_mensagem_antes_alterar before update on public.mensagens
  for each row execute function public.mensagem_antes_alterar();

-- Aviso no sino: um por conversa enquanto não for lido (mensagens seguidas atualizam o mesmo aviso)
create or replace function public.notificar_mensagem()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv    public.conversas%rowtype;
  v_previa  text;
  v_titulo  text;
  v_dest    uuid;
  v_link    text := 'mensagens.html?c=' || new.conversa_id;
begin
  if new.interna then return new; end if;    -- nota interna não avisa ninguém
  select * into v_conv from public.conversas where id = new.conversa_id;
  v_previa := case new.tipo
    when 'audio'   then 'Mensagem de áudio'
    when 'arquivo' then 'Arquivo: ' || coalesce(new.anexo_nome, 'anexo')
    else left(regexp_replace(new.corpo, '\s+', ' ', 'g'), 140) end;

  for v_dest in
    select d from (
      select v_conv.cliente_id as d where v_conv.tipo = 'cliente' and new.autor_papel = 'admin'
      union
      select p.id from public.profiles p
       where p.role = 'admin'
         and ((v_conv.tipo = 'cliente' and new.autor_papel <> 'admin')
              or (v_conv.tipo = 'equipe' and (v_conv.membros is null or p.id = any (v_conv.membros))))
    ) x
    where d is not null and d is distinct from new.autor_id
  loop
    v_titulo := case
      when v_conv.tipo = 'cliente' and new.autor_papel = 'admin' then 'Nova mensagem da equipe CMKCOGIT'
      when v_conv.tipo = 'equipe' and v_conv.membros is null then new.autor_nome || ' no grupo da equipe'
      else 'Nova mensagem de ' || new.autor_nome end;
    update public.notificacoes
       set titulo = v_titulo, mensagem = v_previa, created_at = now()
     where usuario_id = v_dest and tipo = 'mensagem' and not lida
       and metadados->>'conversa_id' = new.conversa_id::text;
    if not found then
      insert into public.notificacoes (usuario_id, tipo, titulo, mensagem, link, metadados)
      values (v_dest, 'mensagem', v_titulo, v_previa, v_link, jsonb_build_object('conversa_id', new.conversa_id));
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists trg_notificar_mensagem on public.mensagens;
create trigger trg_notificar_mensagem after insert on public.mensagens
  for each row execute function public.notificar_mensagem();

-- ---------------------------------------------------------------------
-- 4. FUNÇÕES CHAMADAS PELO APP
-- ---------------------------------------------------------------------
-- Conversa do cliente com a equipe. Cliente: a própria. Admin: a do cliente informado.
create or replace function public.abrir_conversa_cliente(p_cliente uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Entre para continuar.'; end if;
  if public.is_admin() then
    if p_cliente is null or not exists (select 1 from public.profiles where id = p_cliente and role = 'cliente') then
      raise exception 'Cliente não encontrado.';
    end if;
    v_cliente := p_cliente;
  else
    v_cliente := auth.uid();
  end if;
  insert into public.conversas (tipo, cliente_id) values ('cliente', v_cliente)
  on conflict (cliente_id) where tipo = 'cliente' do nothing;
  select id into v_id from public.conversas where tipo = 'cliente' and cliente_id = v_cliente;
  return v_id;
end;
$$;
revoke all on function public.abrir_conversa_cliente(uuid) from public, anon;
grant execute on function public.abrir_conversa_cliente(uuid) to authenticated;

-- Conversas da equipe: sem membro = grupo; com membro = conversa direta entre dois admins
create or replace function public.abrir_conversa_equipe(p_membro uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membros uuid[];
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Só a equipe usa as conversas internas.'; end if;
  if p_membro is null then
    insert into public.conversas (tipo) values ('equipe')
    on conflict (tipo) where tipo = 'equipe' and membros is null do nothing;
    select id into v_id from public.conversas where tipo = 'equipe' and membros is null;
    return v_id;
  end if;
  if p_membro = auth.uid() or not exists (select 1 from public.profiles where id = p_membro and role = 'admin') then
    raise exception 'Escolha outro administrador.';
  end if;
  v_membros := array(select unnest(array[auth.uid(), p_membro]) order by 1);
  insert into public.conversas (tipo, membros) values ('equipe', v_membros)
  on conflict (membros) where tipo = 'equipe' and membros is not null do nothing;
  select id into v_id from public.conversas where tipo = 'equipe' and membros = v_membros;
  return v_id;
end;
$$;
revoke all on function public.abrir_conversa_equipe(uuid) from public, anon;
grant execute on function public.abrir_conversa_equipe(uuid) to authenticated;

-- Lista do usuário: nome do outro lado, última mensagem que ELE pode ver e não lidas
create or replace function public.listar_conversas()
returns table (
  id uuid, tipo text, cliente_id uuid, membros uuid[], nome text, email text, telefone text,
  ultima_em timestamptz, ultima_previa text, ultima_autor uuid, ultima_interna boolean, nao_lidas int
)
language sql
stable
security definer
set search_path = public
as $$
  with eu as (select auth.uid() as uid, public.is_admin() as admin)
  select c.id, c.tipo, c.cliente_id, c.membros,
         case
           when c.tipo = 'cliente' and not eu.admin then 'Equipe CMKCOGIT'
           when c.tipo = 'cliente' then coalesce(nullif(btrim(pc.nome), ''), pc.email)
           when c.membros is null then 'Equipe (interno)'
           else coalesce(nullif(btrim(po.nome), ''), po.email) end,
         case when eu.admin then coalesce(pc.email, po.email) end,
         case when eu.admin then pc.telefone end,
         coalesce(u.created_at, c.created_at),
         case when u.id is null then null
              when u.apagada_em is not null then 'Mensagem apagada'
              when u.tipo = 'audio' then 'Mensagem de áudio'
              when u.tipo = 'arquivo' then coalesce(u.anexo_nome, 'Arquivo')
              else left(regexp_replace(u.corpo, '\s+', ' ', 'g'), 120) end,
         u.autor_id, coalesce(u.interna, false),
         (select count(*)::int from public.mensagens m
           where m.conversa_id = c.id and m.autor_id is distinct from eu.uid and m.apagada_em is null
             and (not m.interna or eu.admin)
             and m.created_at > coalesce((select l.lida_em from public.conversa_leituras l
                                           where l.conversa_id = c.id and l.usuario_id = eu.uid), '-infinity'))
    from public.conversas c
    cross join eu
    left join public.profiles pc on pc.id = c.cliente_id
    left join public.profiles po on po.id = (select x from unnest(c.membros) x where x <> eu.uid limit 1)
    left join lateral (
      select m.* from public.mensagens m
       where m.conversa_id = c.id and (not m.interna or eu.admin)
       order by m.created_at desc limit 1
    ) u on true
   where public.pode_ver_conversa(c.id)
   order by coalesce(u.created_at, c.created_at) desc;
$$;
revoke all on function public.listar_conversas() from public, anon;
grant execute on function public.listar_conversas() to authenticated;

-- Total de não lidas (contador do menu)
create or replace function public.mensagens_nao_lidas()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(nao_lidas), 0)::int from public.listar_conversas();
$$;
revoke all on function public.mensagens_nao_lidas() from public, anon;
grant execute on function public.mensagens_nao_lidas() to authenticated;

-- Abriu a conversa: marca como lida (e o aviso do sino dessa conversa)
create or replace function public.marcar_conversa_lida(p_conversa uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.pode_ver_conversa(p_conversa) then raise exception 'Conversa não encontrada.'; end if;
  insert into public.conversa_leituras (conversa_id, usuario_id, lida_em) values (p_conversa, auth.uid(), now())
  on conflict (conversa_id, usuario_id) do update set lida_em = now();
  update public.notificacoes set lida = true, lida_em = now()
   where usuario_id = auth.uid() and tipo = 'mensagem' and not lida and metadados->>'conversa_id' = p_conversa::text;
end;
$$;
revoke all on function public.marcar_conversa_lida(uuid) from public, anon;
grant execute on function public.marcar_conversa_lida(uuid) to authenticated;

-- Quando a outra parte leu (para o "visto"): última leitura de quem não sou eu
create or replace function public.leitura_da_conversa(p_conversa uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(l.lida_em) from public.conversa_leituras l
   where public.pode_ver_conversa(p_conversa) and l.conversa_id = p_conversa and l.usuario_id <> auth.uid();
$$;
revoke all on function public.leitura_da_conversa(uuid) from public, anon;
grant execute on function public.leitura_da_conversa(uuid) to authenticated;

-- Modelo usado (ordena os mais usados primeiro)
create or replace function public.usar_modelo_mensagem(p_modelo uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.modelos_mensagem set usos = usos + 1 where id = p_modelo and public.is_admin();
$$;
revoke all on function public.usar_modelo_mensagem(uuid) from public, anon;
grant execute on function public.usar_modelo_mensagem(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. STORAGE: bucket privado "mensagens" (até 25 MB por arquivo)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('mensagens', 'mensagens', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "mensagens_storage_select" on storage.objects;
create policy "mensagens_storage_select" on storage.objects
  for select to authenticated using (bucket_id = 'mensagens' and public.pode_usar_anexo_mensagem(name, false));

drop policy if exists "mensagens_storage_insert" on storage.objects;
create policy "mensagens_storage_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'mensagens' and public.pode_usar_anexo_mensagem(name, true));

drop policy if exists "mensagens_storage_delete" on storage.objects;
create policy "mensagens_storage_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'mensagens' and owner_id = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 6. TEMPO REAL (mensagem nova aparece na hora; o RLS vale também aqui)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mensagens') then
    alter publication supabase_realtime add table public.mensagens;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. MODELOS INICIAIS (só se ainda não houver nenhum)
--    Variáveis: {primeiro_nome} {nome} {projeto} {link}
-- ---------------------------------------------------------------------
insert into public.modelos_mensagem (autor_id, titulo, categoria, corpo)
select null, t, c, b from (values
  ('Boas-vindas', 'relacionamento',
   E'Olá, {primeiro_nome}! Tudo bem?\n\nAqui é da *CMKCOGIT*. Seja muito bem-vindo(a)! A partir de agora você acompanha tudo do seu projeto pela plataforma: etapas, prazos, arquivos e mensagens com a equipe.\n\nAcesse: {link}\n\nQualquer dúvida, é só responder por aqui.'),
  ('Atualização do projeto', 'projeto',
   E'Olá, {primeiro_nome}!\n\nPassando para atualizar o andamento do *{projeto}*: concluímos mais uma etapa e seguimos dentro do prazo.\n\nOs detalhes estão na plataforma: {link}\n\nSe quiser conversar sobre algum ponto, estamos à disposição.'),
  ('Pedido de material', 'projeto',
   E'Olá, {primeiro_nome}! Tudo certo?\n\nPara seguirmos com o *{projeto}*, precisamos de alguns materiais seus (textos, logo e fotos). Você pode enviar direto pela plataforma, no repositório do projeto: {link}\n\nObrigado!'),
  ('Lembrete de pagamento', 'financeiro',
   E'Olá, {primeiro_nome}! Tudo bem?\n\nPassando para lembrar que há um pagamento pendente referente ao *{projeto}*. Você pode pagar por Pix, cartão ou boleto direto na plataforma: {link}\n\nSe já tiver pago, desconsidere esta mensagem. Obrigado!'),
  ('Projeto entregue', 'projeto',
   E'Olá, {primeiro_nome}! 🎉\n\nO *{projeto}* está no ar! Foi um prazer construir isso com você.\n\nOs arquivos finais e o endereço estão na plataforma: {link}\n\nConte com a gente para os próximos passos.')
) as v(t, c, b)
where not exists (select 1 from public.modelos_mensagem);

-- funções de gatilho não são chamadas pela API
revoke all on function public.mensagem_antes_inserir() from public, anon, authenticated;
revoke all on function public.mensagem_antes_alterar() from public, anon, authenticated;
revoke all on function public.notificar_mensagem() from public, anon, authenticated;

-- conferir
select (select count(*) from public.conversas) as conversas,
       (select count(*) from public.mensagens) as mensagens,
       (select count(*) from public.modelos_mensagem) as modelos;
