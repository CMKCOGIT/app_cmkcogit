-- =====================================================================
-- 18_cpf_cnpj.sql — CPF (pessoa física) ou CNPJ (empresa) do contratante
--
-- Rode DEPOIS do 12 e ANTES de publicar a versão do app que pede o documento.
-- Pode rodar mais de uma vez.
--
-- O que faz:
--   1. profiles ganha "documento" (só números: 11 = CPF, 14 = CNPJ), com os
--      dígitos verificadores conferidos pelo banco.
--   2. Quem pode ver: o próprio cliente e o admin (a política profiles_select
--      do 01 já garante isso). O cliente NÃO grava a coluna direto: só pelas
--      funções abaixo, que validam antes.
--   3. salvar_documento(): o cliente informa ou troca o documento (Meu perfil).
--   4. concluir_cadastro() passa a exigir o documento de quem ainda não tem.
--      Contas antigas continuam entrando; o documento é pedido antes do pagamento.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Validação (mesma regra do app: public/js/app.js -> documentoValido)
-- ---------------------------------------------------------------------
create or replace function public.documento_valido(p text)
returns boolean
language plpgsql
immutable
as $$
declare
  d   text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  n   int[];
  s   int;
  dv1 int;
  dv2 int;
  i   int;
  pesos1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  pesos2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if d !~ '^(\d{11}|\d{14})$' or d ~ '^(\d)\1+$' then return false; end if;
  n := array(select substr(d, k, 1)::int from generate_series(1, length(d)) k);

  if length(d) = 11 then
    s := 0; for i in 1..9 loop s := s + n[i] * (11 - i); end loop;
    dv1 := (s * 10) % 11; if dv1 = 10 then dv1 := 0; end if;
    s := 0; for i in 1..10 loop s := s + n[i] * (12 - i); end loop;
    dv2 := (s * 10) % 11; if dv2 = 10 then dv2 := 0; end if;
    return dv1 = n[10] and dv2 = n[11];
  end if;

  s := 0; for i in 1..12 loop s := s + n[i] * pesos1[i]; end loop;
  dv1 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  s := 0; for i in 1..13 loop s := s + n[i] * pesos2[i]; end loop;
  dv2 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  return dv1 = n[13] and dv2 = n[14];
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Coluna + regra
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists documento text;

alter table public.profiles drop constraint if exists profiles_documento_check;
alter table public.profiles add constraint profiles_documento_check
  check (documento is null or (documento ~ '^(\d{11}|\d{14})$' and public.documento_valido(documento)));

-- O cliente continua podendo alterar direto só nome e telefone
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (nome, telefone) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 3. salvar_documento(): informa ou troca o CPF/CNPJ do próprio cliente
-- ---------------------------------------------------------------------
create or replace function public.salvar_documento(p_documento text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
begin
  if auth.uid() is null then raise exception 'Sua sessão expirou. Entre novamente.'; end if;
  if not public.documento_valido(v_doc) then raise exception 'CPF ou CNPJ inválido. Confira os números.'; end if;
  update public.profiles set documento = v_doc where id = auth.uid();
  return v_doc;
end;
$$;

revoke all on function public.salvar_documento(text) from public, anon;
grant execute on function public.salvar_documento(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. concluir_cadastro(): obrigatórios = nome, CPF/CNPJ e aceite dos termos
--    (substitui a versão de 3 parâmetros do 12_cadastro_google.sql)
-- ---------------------------------------------------------------------
drop function if exists public.concluir_cadastro(text, text, boolean);

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

  -- tudo numa só atualização: ou salva tudo e conclui, ou não salva nada
  update public.profiles set
    nome                  = v_nome,
    telefone              = nullif(v_fone, ''),
    documento             = coalesce(nullif(v_doc, ''), documento),
    aceite_termos_em      = coalesce(aceite_termos_em, now()),
    cadastro_concluido_em = coalesce(cadastro_concluido_em, now())
  where id = auth.uid()
  returning cadastro_concluido_em into v_perfil.cadastro_concluido_em;

  return v_perfil.cadastro_concluido_em;
end;
$$;

revoke all on function public.concluir_cadastro(text, text, boolean, text) from public, anon;
grant execute on function public.concluir_cadastro(text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- Conferir: clientes com e sem documento
-- ---------------------------------------------------------------------
select (documento is not null) as tem_documento, count(*) from public.profiles where role = 'cliente' group by 1;
