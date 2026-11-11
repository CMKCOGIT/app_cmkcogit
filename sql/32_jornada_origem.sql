-- =====================================================================
-- 32_jornada_origem.sql — de onde veio cada projeto da Jornada MVP. Rode depois do 31.
-- Pode rodar mais de uma vez. Não apaga dados.
--
--   origem 'app' (app.cmkcogit.com.br): feito só pelo cliente. Cada módulo concluído já fica
--                aprovado e o orçamento sai automático. Não há mentor.
--   origem 'mvp' (mvp.cmkcogit.com.br): o MENTOR libera cada fase. Módulo enviado espera a
--                aprovação dele; sem todas as fases aprovadas, não há orçamento.
-- Quem grava a origem é o servidor do app (lib/jornada-rota.js), pela origem da chamada.
-- Projetos que já existiam ficam como 'app'.
-- =====================================================================
alter table public.jornadas add column if not exists origem text not null default 'app';
alter table public.jornadas drop constraint if exists jornadas_origem_check;
alter table public.jornadas add constraint jornadas_origem_check check (origem in ('app', 'mvp'));
create index if not exists idx_jornadas_cliente_origem on public.jornadas(cliente_id, origem, updated_at desc);

-- Revogar o mentor: no projeto do app (sem mentor por regra) nada muda; no do mvp, o que esperava
-- revisão CONTINUA esperando (um novo mentor libera). Substitui a versão do 31.
create or replace function public.revogar_compartilhamento(p_projeto uuid, p_mentor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.dono_do_projeto(p_projeto) then raise exception 'Projeto não encontrado.'; end if;
  delete from public.mvp_project_shares where project_id = p_projeto and mentor_user_id = p_mentor;
  if (select origem from public.jornadas where id = p_projeto) = 'app'
     and not exists (select 1 from public.mvp_project_shares s where s.project_id = p_projeto and public.is_mentor(s.mentor_user_id)) then
    update public.jornada_modulos set status = 'aprovado', avaliado_em = now(), updated_at = now()
     where jornada_id = p_projeto and status = 'enviado';
  end if;
end;
$$;
revoke all on function public.revogar_compartilhamento(uuid, uuid) from public, anon;
grant execute on function public.revogar_compartilhamento(uuid, uuid) to authenticated;

-- Conferir
select origem, count(*) from public.jornadas group by 1;
