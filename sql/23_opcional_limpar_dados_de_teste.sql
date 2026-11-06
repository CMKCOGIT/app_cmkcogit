-- =====================================================================
-- 23_opcional_limpar_dados_de_teste.sql
--
-- Zera tudo o que veio dos USUÁRIOS (eram todos testes) e mantém a estrutura.
-- NÃO é migração: rode só quando quiser limpar.
--
--   apaga  · contas de CLIENTE (login, perfil, aceites dos termos)
--          · solicitações, cobranças, eventos do Mercado Pago, assinaturas
--          · projetos, etapas, pendências, arquivos (registros), funcionalidades contratadas
--          · notificações
--          · numeração volta ao começo (PLN-AAAA-0001 e COG-AAAA-100)
--   mantém · contas ADMIN (login e perfil continuam funcionando)
--          · catálogo de preços (catalogo_precos) e de funcionalidades (funcionalidades)
--          · tabelas, funções, regras de segurança, modelos de e-mail e configurações
--
-- Como usar no Supabase (SQL Editor):
--   1) Rode só o bloco 1 (PRÉVIA) e confira os números.
--   2) Rode o bloco 2 (LIMPAR). É tudo ou nada: se der erro, nada muda.
--   3) Arquivos enviados (fotos, logos...) ficam no Storage: apague em
--      Storage > arquivos > selecionar tudo > Delete (o Supabase não deixa
--      apagar arquivos do Storage por SQL).
-- Não tem como desfazer. Se quiser garantia, faça um backup antes
-- (Database > Backups).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) PRÉVIA: quanto vai sair e quem fica (não altera nada)
-- ---------------------------------------------------------------------
select 'contas de cliente (saem)' as item, count(*) as qtd from public.profiles where role <> 'admin'
union all select 'contas admin (ficam)', count(*) from public.profiles where role = 'admin'
union all select 'logins sem perfil (saem)', count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)
union all select 'solicitações', count(*) from public.solicitacoes
union all select 'cobranças', count(*) from public.pagamentos
union all select 'eventos Mercado Pago', count(*) from public.pagamento_eventos
union all select 'assinaturas', count(*) from public.assinaturas
union all select 'projetos', count(*) from public.projetos
union all select 'etapas', count(*) from public.projeto_etapas
union all select 'pendências', count(*) from public.pendencias
union all select 'arquivos (registros)', count(*) from public.arquivos
union all select 'funcionalidades contratadas', count(*) from public.projeto_funcionalidades
union all select 'notificações', count(*) from public.notificacoes
union all select 'catálogo de preços (fica)', count(*) from public.catalogo_precos
union all select 'catálogo de funcionalidades (fica)', count(*) from public.funcionalidades;

-- quem continua com acesso
select email, nome, role from public.profiles where role = 'admin' order by email;


-- ---------------------------------------------------------------------
-- 2) LIMPAR — um bloco só (tudo ou nada)
-- ---------------------------------------------------------------------
do $$
declare
  v_admins int;
  v_contas int;
begin
  select count(*) into v_admins from public.profiles where role = 'admin';
  if v_admins = 0 then
    raise exception 'Nenhuma conta admin encontrada: limpeza cancelada para você não perder o acesso ao painel.';
  end if;

  -- dados de uso (de todo mundo, inclusive testes feitos com a conta admin)
  delete from public.pagamento_eventos;
  delete from public.pagamentos;
  delete from public.assinaturas;
  delete from public.solicitacoes;
  delete from public.notificacoes;
  delete from public.projeto_funcionalidades;
  delete from public.arquivos;
  delete from public.pendencias;
  delete from public.projeto_etapas;
  delete from public.projetos;

  -- contas de cliente: apagar o login leva junto perfil, aceites e sessões
  delete from auth.users u
   where not exists (select 1 from public.profiles p where p.id = u.id and p.role = 'admin');
  get diagnostics v_contas = row_count;

  -- numeração do começo
  perform setval('public.seq_solicitacao', 1, false);
  perform setval('public.seq_codigo_projeto', 100, false);

  raise notice 'Limpo: % contas de cliente apagadas, % admin(s) mantido(s). Catálogos intactos.', v_contas, v_admins;
end $$;

-- conferência: tudo zerado, admins e catálogos no lugar
select 'contas' as item, count(*) as qtd from public.profiles
union all select 'solicitações', count(*) from public.solicitacoes
union all select 'cobranças', count(*) from public.pagamentos
union all select 'projetos', count(*) from public.projetos
union all select 'notificações', count(*) from public.notificacoes
union all select 'catálogo de preços', count(*) from public.catalogo_precos
union all select 'catálogo de funcionalidades', count(*) from public.funcionalidades;
