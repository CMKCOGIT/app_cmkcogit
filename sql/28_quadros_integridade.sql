-- =====================================================================
-- 28_quadros_integridade.sql — rode depois do 27. Pode rodar mais de uma vez.
-- O cartão sempre fica numa lista do PRÓPRIO quadro (também ao criar).
-- =====================================================================
create or replace function public.cartao_antes_salvar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_conclui_nova boolean;
  v_conclui_velha boolean;
begin
  if not exists (select 1 from public.quadro_listas where id = new.lista_id and quadro_id = new.quadro_id) then
    raise exception 'A lista não é deste quadro.';
  end if;
  select conclui into v_conclui_nova from public.quadro_listas where id = new.lista_id;
  new.titulo := btrim(new.titulo);
  if tg_op = 'INSERT' then
    if v_conclui_nova then new.concluido_em := coalesce(new.concluido_em, now()); end if;
    return new;
  end if;
  if new.lista_id is distinct from old.lista_id then
    select conclui into v_conclui_velha from public.quadro_listas where id = old.lista_id;
    if v_conclui_nova and old.concluido_em is not distinct from new.concluido_em then new.concluido_em := coalesce(new.concluido_em, now());
    elsif v_conclui_velha and not v_conclui_nova and old.concluido_em is not distinct from new.concluido_em then new.concluido_em := null;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.cartao_antes_salvar() from public, anon, authenticated;
