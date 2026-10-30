-- =====================================================================
-- auditar_dados.sql — tem dado falso, de teste ou inconsistente no banco?
--
-- SÓ LEITURA: não altera nada. Cole no SQL Editor do Supabase e rode.
-- Cada linha é um achado. Sem linhas (ou só "NADA ENCONTRADO") = dados limpos.
--   gravidade ALTA  -> mostra informação falsa para cliente/admin ou valor errado
--   gravidade MÉDIA -> resto de teste ou inconsistência que confunde
--   gravidade INFO  -> vale olhar, pode ser normal
-- A coluna "como_resolver" diz o que fazer (nada aqui é apagado sozinho).
-- =====================================================================

with achados as (
  -- 1) notificações de exemplo criadas pelo sql/14 (aparecem no sino como compras que não aconteceram)
  select 'ALTA' as gravidade, 'notificação de teste' as tipo,
         n.titulo || ' -> ' || coalesce(p.email, '?') as detalhe,
         'delete from public.notificacoes where metadados->>''seed'' = ''true'';' as como_resolver
    from public.notificacoes n left join public.profiles p on p.id = n.usuario_id
   where n.metadados->>'seed' = 'true'

  union all
  -- 2) pagamento "pago" sem nenhuma confirmação do Mercado Pago (marcado à mão ou teste)
  select 'ALTA', 'pago sem confirmação do Mercado Pago',
         coalesce(pg.descricao, pg.id::text) || ' · ' || to_char(pg.valor, 'FM999G999G990D00') || ' · ' || coalesce(p.email, '?'),
         'confira no Mercado Pago; se não houve pagamento, volte o status para pendente/cancelado'
    from public.pagamentos pg left join public.profiles p on p.id = pg.cliente_id
   where pg.status = 'pago'
     and pg.mp_payment_id is null
     and not exists (select 1 from public.pagamento_eventos e where e.pagamento_id = pg.id and e.resultado = 'pago')

  union all
  -- 3) solicitação marcada como paga sem cobrança paga
  select 'ALTA', 'solicitação paga sem pagamento',
         s.codigo || ' · ' || coalesce(p.email, '?'),
         'rode sql/16 (mantém só as pagas de verdade) ou confira a cobrança'
    from public.solicitacoes s left join public.profiles p on p.id = s.cliente_id
   where s.status = 'paga'
     and not exists (select 1 from public.pagamentos pg where pg.solicitacao_id = s.id and pg.status = 'pago')

  union all
  -- 4) projeto que diz "pago" mas não tem nenhuma cobrança paga
  select 'ALTA', 'projeto "pago" sem cobrança paga',
         coalesce(pr.codigo, '') || ' · ' || pr.nome || ' · ' || coalesce(p.email, '?'),
         'confira as cobranças do projeto em Clientes'
    from public.projetos pr left join public.profiles p on p.id = pr.cliente_id
   where pr.status_pagamento = 'pago'
     and not exists (select 1 from public.pagamentos pg where pg.projeto_id = pr.id and pg.status = 'pago')

  union all
  -- 5) contas com cara de teste (entram no painel como clientes)
  select 'MÉDIA', 'conta de teste',
         p.email || ' · ' || coalesce(p.nome, '') || ' · ' || p.role,
         'se for teste, apague o usuário em Authentication > Users (o perfil e os dados dele saem junto)'
    from public.profiles p
   where p.email ~* '(exemplo|example|teste|test|fake|demo|@mailinator|@yopmail|\+t)'

  union all
  -- 6) cobranças pendentes esquecidas (contam em "pagamentos pendentes" do painel)
  select 'MÉDIA', 'cobrança pendente há mais de 30 dias',
         coalesce(pg.descricao, pg.id::text) || ' · ' || to_char(pg.valor, 'FM999G999G990D00') || ' · desde ' || to_char(pg.created_at, 'DD/MM/YYYY'),
         'se o cliente desistiu, cancele a solicitação (a cobrança é cancelada junto)'
    from public.pagamentos pg
   where pg.status = 'pendente' and pg.created_at < now() - interval '30 days'

  union all
  -- 7) solicitação "aguardando pagamento" sem valor final (o cliente não consegue pagar)
  select 'ALTA', 'aguardando pagamento sem valor final',
         s.codigo,
         'o cliente não consegue pagar: abra a solicitação no admin e aprove com o valor final'
    from public.solicitacoes s
   where s.status = 'aguardando_pagamento' and s.valor_final is null

  union all
  -- 8) projeto concluído com progresso diferente de 100% (o cliente vê número errado)
  select 'MÉDIA', 'projeto concluído com progresso < 100%',
         coalesce(pr.codigo, '') || ' · ' || pr.nome || ' · ' || coalesce(pr.progresso::text, 'vazio') || '%',
         'em Clientes, abra o projeto e salve 100% / Concluído'
    from public.projetos pr
   where pr.status_projeto = 'concluido' and coalesce(pr.progresso, 100) < 100

  union all
  -- 9) solicitação ainda com o código antigo
  select 'INFO', 'código SOL antigo', s.codigo, 'rode sql/17_codigo_plano.sql'
    from public.solicitacoes s where s.codigo like 'SOL-%'

  union all
  -- 10) nenhum admin (painel de gestão inacessível)
  select 'ALTA', 'sem admin', 'nenhum perfil com role = admin', 'rode sql/10_tornar_admin.sql com o seu e-mail'
   where not exists (select 1 from public.profiles where role = 'admin')
)
select gravidade, tipo, detalhe, como_resolver from (
  select 0 as ordem, 'OK' as gravidade, 'NADA ENCONTRADO' as tipo, 'dados limpos' as detalhe, '-' as como_resolver
   where not exists (select 1 from achados)
  union all
  select case gravidade when 'ALTA' then 1 when 'MÉDIA' then 2 else 3 end, gravidade, tipo, detalhe, como_resolver from achados
) r
order by ordem, tipo, detalhe;
