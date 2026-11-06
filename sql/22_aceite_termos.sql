-- =====================================================================
-- 22_aceite_termos.sql — registro do aceite dos Termos de Uso e da Política de Privacidade
-- Rode depois do 21. Pode rodar mais de uma vez.
--
-- Antes: o perfil guardava só a data (profiles.aceite_termos_em).
-- Agora: cada aceite vira uma linha em public.aceites_termos, deixando claro
--   QUEM aceitou, O QUÊ (Termos de Uso + Política de Privacidade), QUAL VERSÃO,
--   QUANDO, POR ONDE (cadastro por e-mail ou conclusão do cadastro com Google),
--   o texto exato da caixa marcada, o navegador e (quando disponível) o IP.
-- - A linha não pode ser alterada nem apagada pelo cliente (só leitura da própria).
-- - profiles ganha aceite_termos_versao, para consulta rápida.
-- - Quem já tinha aceite_termos_em ganha o registro "anterior ao registro detalhado".
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Versão vigente dos documentos (mesma data do topo das páginas do site)
--    Ao atualizar os Termos ou a Política no site, troque aqui também.
-- ---------------------------------------------------------------------
create or replace function public.versao_termos_vigente()
returns text language sql immutable as $$ select 'termos-2026-10+privacidade-2026-10'::text $$;

create or replace function public.texto_aceite_termos()
returns text language sql immutable as $$
  select 'Li e aceito os Termos de Uso e a Política de Privacidade.'::text
$$;

grant execute on function public.versao_termos_vigente() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Tabela de aceites
-- ---------------------------------------------------------------------
create table if not exists public.aceites_termos (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  email       text,
  documentos  text[] not null default array['termos-de-uso', 'politica-de-privacidade'],
  versao      text not null,
  aceito      boolean not null default true check (aceito),
  aceito_em   timestamptz not null default now(),
  origem      text not null check (origem in ('cadastro-email', 'concluir-cadastro', 'registro-anterior')),
  texto       text not null,
  navegador   text,
  ip          text,
  criado_em   timestamptz not null default now()
);
create index if not exists aceites_termos_user_idx on public.aceites_termos (user_id, aceito_em desc);
comment on table public.aceites_termos is 'Registro de aceite dos Termos de Uso e da Política de Privacidade (um por aceite; não editável).';

alter table public.aceites_termos enable row level security;
drop policy if exists aceites_termos_ler on public.aceites_termos;
create policy aceites_termos_ler on public.aceites_termos
  for select using (user_id = auth.uid() or public.is_admin());
-- sem políticas de insert/update/delete: só as funções abaixo (security definer) gravam
revoke insert, update, delete on public.aceites_termos from anon, authenticated;
grant select on public.aceites_termos to authenticated;

alter table public.profiles add column if not exists aceite_termos_versao text;

-- ---------------------------------------------------------------------
-- 3. Gravação (usada pelo trigger de cadastro e pela conclusão do cadastro)
-- ---------------------------------------------------------------------
create or replace function public.registrar_aceite_termos(p_user uuid, p_origem text, p_navegador text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers json;
  v_nav text := p_navegador;
  v_ip  text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then v_headers := null;
  end;
  if v_headers is not null then
    v_nav := coalesce(v_nav, v_headers->>'user-agent');
    v_ip  := split_part(coalesce(v_headers->>'cf-connecting-ip', v_headers->>'x-real-ip', v_headers->>'x-forwarded-for', ''), ',', 1);
  end if;

  insert into public.aceites_termos (user_id, email, versao, origem, texto, navegador, ip)
  select p.id, p.email, public.versao_termos_vigente(), p_origem, public.texto_aceite_termos(),
         left(nullif(trim(v_nav), ''), 400), nullif(trim(v_ip), '')
    from public.profiles p where p.id = p_user;

  update public.profiles set aceite_termos_versao = public.versao_termos_vigente() where id = p_user;
end;
$$;
revoke all on function public.registrar_aceite_termos(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Cadastro por e-mail: o trigger de criação do perfil registra o aceite
--    (mesma função do 12_cadastro_google.sql, com o registro no fim)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- "nome" e "aceite_termos_em" só vêm do formulário de e-mail do app (o Google não manda)
  v_nome_form text := nullif(trim(new.raw_user_meta_data->>'nome'), '');
  v_aceite    timestamptz := case when nullif(trim(new.raw_user_meta_data->>'aceite_termos_em'), '') is not null then now() end;
  v_criou     boolean;
begin
  insert into public.profiles (id, email, nome, telefone, aceite_termos_em, cadastro_concluido_em)
  values (
    new.id,
    new.email,
    public.nome_inicial(new.raw_user_meta_data, new.email),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'telefone', ''), '\D', '', 'g'), ''),
    v_aceite,
    case when v_aceite is not null and char_length(coalesce(v_nome_form, '')) >= 2 then now() end
  )
  on conflict (id) do nothing   -- a mesma pessoa nunca ganha dois perfis
  returning true into v_criou;

  if coalesce(v_criou, false) and v_aceite is not null then
    perform public.registrar_aceite_termos(new.id, 'cadastro-email', new.raw_user_meta_data->>'aceite_navegador');
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Conclusão do cadastro (Google ou e-mail sem aceite): registra o aceite
--    (mesma função do 18_cpf_cnpj.sql, com o registro no fim)
-- ---------------------------------------------------------------------
create or replace function public.concluir_cadastro(
  p_nome      text,
  p_telefone  text    default null,
  p_aceite    boolean default false,
  p_documento text    default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome  text := trim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_fone  text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_doc   text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
  v_perfil public.profiles%rowtype;
  v_aceitou_agora boolean;
begin
  if auth.uid() is null then raise exception 'Sua sessão expirou. Entre novamente.'; end if;
  if char_length(v_nome) < 2 or char_length(v_nome) > 120 then raise exception 'Informe seu nome (de 2 a 120 caracteres).'; end if;
  if v_fone <> '' and v_fone !~ '^\d{10,11}$' then raise exception 'WhatsApp com DDD: 10 ou 11 números.'; end if;
  if v_doc <> '' and not public.documento_valido(v_doc) then raise exception 'CPF ou CNPJ inválido. Confira os números.'; end if;

  perform public.garantir_perfil();
  select * into v_perfil from public.profiles where id = auth.uid() for update;

  if v_perfil.aceite_termos_em is null and not coalesce(p_aceite, false) then
    raise exception 'Para continuar, aceite os Termos de Uso e a Política de Privacidade.';
  end if;
  if v_perfil.documento is null and v_doc = '' and v_perfil.role <> 'admin' then
    raise exception 'Informe seu CPF ou o CNPJ da empresa.';
  end if;
  v_aceitou_agora := v_perfil.aceite_termos_em is null;

  -- tudo numa só transação: ou salva tudo (inclusive o registro do aceite) e conclui, ou não salva nada
  update public.profiles set
    nome                  = v_nome,
    telefone              = nullif(v_fone, ''),
    documento             = coalesce(nullif(v_doc, ''), documento),
    aceite_termos_em      = coalesce(aceite_termos_em, now()),
    cadastro_concluido_em = coalesce(cadastro_concluido_em, now())
  where id = auth.uid()
  returning cadastro_concluido_em into v_perfil.cadastro_concluido_em;

  if v_aceitou_agora then
    perform public.registrar_aceite_termos(auth.uid(), 'concluir-cadastro');
  end if;

  return v_perfil.cadastro_concluido_em;
end;
$$;

revoke all on function public.concluir_cadastro(text, text, boolean, text) from public, anon;
grant execute on function public.concluir_cadastro(text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Quem já tinha aceitado antes deste registro detalhado
-- ---------------------------------------------------------------------
insert into public.aceites_termos (user_id, email, versao, aceito_em, origem, texto)
select p.id, p.email, 'anterior-a-2026-11', p.aceite_termos_em, 'registro-anterior', public.texto_aceite_termos()
  from public.profiles p
 where p.aceite_termos_em is not null
   and not exists (select 1 from public.aceites_termos a where a.user_id = p.id);

update public.profiles set aceite_termos_versao = 'anterior-a-2026-11'
 where aceite_termos_em is not null and aceite_termos_versao is null;

-- ---------------------------------------------------------------------
-- Conferir: perfis com aceite x registros
-- ---------------------------------------------------------------------
select (p.aceite_termos_em is not null) as aceitou,
       count(distinct p.id) as perfis,
       count(a.id) as registros
  from public.profiles p left join public.aceites_termos a on a.user_id = p.id
 group by 1;
