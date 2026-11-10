-- =====================================================================
-- 29_assistente_uso.sql — contagem de uso do Assistente IA (rate limit). Rode depois do 28.
-- NÃO guarda conversas: só quem pediu, quando e quantos tokens. Só o servidor (service_role) usa.
-- Pode rodar mais de uma vez.
-- =====================================================================
create table if not exists public.ia_uso (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.profiles(id) on delete cascade,
  recurso    text not null default 'assistente',
  modelo     text,
  tokens     int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_ia_uso_recurso on public.ia_uso(recurso, created_at desc);
create index if not exists idx_ia_uso_usuario on public.ia_uso(usuario_id, created_at desc);

alter table public.ia_uso enable row level security;
revoke all on public.ia_uso from anon, authenticated;   -- ninguém pela API do navegador

-- Reserva um pedido se couber nos limites (da conta Groq e do admin). Devolve o id da reserva,
-- ou o motivo da recusa. Os tokens reservados são a estimativa; ia_registrar_uso grava o real.
create or replace function public.ia_reservar(
  p_usuario uuid, p_recurso text, p_modelo text, p_tokens int,
  p_rpm int, p_rpd int, p_tpm int, p_tpd int, p_usuario_rpm int, p_usuario_rpd int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min record;
  v_dia record;
  v_umin int;
  v_udia int;
  v_id uuid;
begin
  -- um pedido de cada vez por recurso (evita dois admins passarem juntos do limite)
  perform pg_advisory_xact_lock(hashtext('ia_uso:' || p_recurso));
  select count(*)::int as n, coalesce(sum(tokens), 0)::int as t into v_min
    from public.ia_uso where recurso = p_recurso and created_at > now() - interval '1 minute';
  select count(*)::int as n, coalesce(sum(tokens), 0)::int as t into v_dia
    from public.ia_uso where recurso = p_recurso and created_at > now() - interval '1 day';
  select count(*)::int into v_umin from public.ia_uso where usuario_id = p_usuario and recurso = p_recurso and created_at > now() - interval '1 minute';
  select count(*)::int into v_udia from public.ia_uso where usuario_id = p_usuario and recurso = p_recurso and created_at > now() - interval '1 day';

  if v_umin >= p_usuario_rpm then return jsonb_build_object('ok', false, 'motivo', 'usuario_minuto', 'espera', 60); end if;
  if v_udia >= p_usuario_rpd then return jsonb_build_object('ok', false, 'motivo', 'usuario_dia'); end if;
  if v_min.n >= p_rpm or v_min.t + p_tokens > p_tpm then return jsonb_build_object('ok', false, 'motivo', 'conta_minuto', 'espera', 60); end if;
  if v_dia.n >= p_rpd or v_dia.t + p_tokens > p_tpd then return jsonb_build_object('ok', false, 'motivo', 'conta_dia'); end if;

  if random() < 0.02 then delete from public.ia_uso where created_at < now() - interval '7 days'; end if; -- limpeza ocasional
  insert into public.ia_uso (usuario_id, recurso, modelo, tokens) values (p_usuario, p_recurso, p_modelo, p_tokens) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.ia_reservar(uuid, text, text, int, int, int, int, int, int, int) from public, anon, authenticated;
grant execute on function public.ia_reservar(uuid, text, text, int, int, int, int, int, int, int) to service_role;

-- Depois da resposta: grava os tokens de verdade (a Groq informa no fim do streaming)
create or replace function public.ia_registrar_uso(p_id uuid, p_tokens int, p_modelo text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ia_uso set tokens = greatest(0, coalesce(p_tokens, tokens)), modelo = coalesce(p_modelo, modelo) where id = p_id;
$$;
revoke all on function public.ia_registrar_uso(uuid, int, text) from public, anon, authenticated;
grant execute on function public.ia_registrar_uso(uuid, int, text) to service_role;
