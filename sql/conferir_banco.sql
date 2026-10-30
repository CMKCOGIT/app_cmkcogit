-- =====================================================================
-- conferir_banco.sql — o banco está atualizado?
--
-- SÓ LEITURA: não cria, não altera e não apaga nada. Pode rodar quando quiser.
-- Cole no SQL Editor do Supabase e rode. Uma linha por item conferido:
--   FALTA -> rode o arquivo indicado em "como_resolver" (na ordem dos números)
--   OK    -> já está no banco
-- As faltas aparecem primeiro. Se a primeira linha for "TUDO CERTO", nada a fazer.
-- =====================================================================

with item(arquivo, o_que, nome) as (values
  -- 01 base
  ('01_base', 'tabela', 'profiles'),
  ('01_base', 'coluna', 'profiles.role'),
  ('01_base', 'coluna', 'profiles.telefone'),
  ('01_base', 'função', 'is_admin'),
  ('01_base', 'função', 'handle_new_user'),
  ('01_base', 'gatilho', 'on_auth_user_created'),
  ('01_base', 'política', 'profiles_select'),
  -- 02 catálogo
  ('02_catalogo', 'tabela', 'catalogo_precos'),
  ('02_catalogo', 'coluna', 'catalogo_precos.preco_sob_medida'),
  ('02_catalogo', 'coluna', 'catalogo_precos.complementos_permitidos'),
  -- 03 projetos e etapas
  ('03_projetos_etapas', 'tabela', 'projetos'),
  ('03_projetos_etapas', 'tabela', 'projeto_etapas'),
  ('03_projetos_etapas', 'coluna', 'projetos.etapa_atual'),
  ('03_projetos_etapas', 'coluna', 'projetos.previsao_entrega'),
  ('03_projetos_etapas', 'sequência', 'seq_codigo_projeto'),
  ('03_projetos_etapas', 'gatilho', 'trg_criar_etapas'),
  -- 04 pendências e arquivos
  ('04_pendencias_arquivos', 'tabela', 'pendencias'),
  ('04_pendencias_arquivos', 'tabela', 'arquivos'),
  -- 05 funcionalidades
  ('05_funcionalidades', 'tabela', 'funcionalidades'),
  ('05_funcionalidades', 'tabela', 'projeto_funcionalidades'),
  -- 06 solicitações
  ('06_solicitacoes', 'tabela', 'solicitacoes'),
  ('06_solicitacoes', 'sequência', 'seq_solicitacao'),
  ('06_solicitacoes', 'restrição', 'solicitacoes_cliente_id_fkey'),
  ('06_solicitacoes', 'índice', 'idx_solicitacoes_status'),
  -- 07 pagamentos
  ('07_pagamentos', 'tabela', 'pagamentos'),
  ('07_pagamentos', 'tabela', 'pagamento_eventos'),
  ('07_pagamentos', 'coluna', 'pagamentos.solicitacao_id'),
  ('07_pagamentos', 'coluna', 'pagamentos.mp_ultimo_status'),
  ('07_pagamentos', 'índice', 'uq_pagamento_pendente_solicitacao'),
  ('07_pagamentos', 'função', 'solicitar_funcionalidade'),
  -- 08 funções cliente/admin
  ('08_funcoes_cliente_admin', 'função', 'cliente_cancelar_solicitacao'),
  ('08_funcoes_cliente_admin', 'função', 'admin_decidir_solicitacao'),
  -- 09 Mercado Pago
  ('09_aplicar_pagamento_mp', 'função', 'aplicar_pagamento_mp'),
  ('09_aplicar_pagamento_mp', 'função', 'somar_dias_uteis'),
  -- 11 repositório, notificações e perfil
  ('11_repositorio_notificacoes_perfil', 'tabela', 'notificacoes'),
  ('11_repositorio_notificacoes_perfil', 'coluna', 'arquivos.origem'),
  ('11_repositorio_notificacoes_perfil', 'função', 'notificar'),
  ('11_repositorio_notificacoes_perfil', 'gatilho', 'trg_notificar_projeto'),
  ('11_repositorio_notificacoes_perfil', 'gatilho', 'on_auth_user_email_alterado'),
  ('11_repositorio_notificacoes_perfil', 'política', 'arquivos_storage_insert'),
  ('11_repositorio_notificacoes_perfil', 'bucket', 'arquivos'),
  -- 12 cadastro com Google
  ('12_cadastro_google', 'coluna', 'profiles.cadastro_concluido_em'),
  ('12_cadastro_google', 'coluna', 'profiles.aceite_termos_em'),
  ('12_cadastro_google', 'função', 'concluir_cadastro'),
  ('12_cadastro_google', 'função', 'garantir_perfil'),
  -- 13 painel do admin
  ('13_painel_admin', 'coluna', 'projetos.progresso'),
  ('13_painel_admin', 'coluna', 'projetos.concluido_em'),
  ('13_painel_admin', 'coluna', 'notificacoes.lida_em'),
  ('13_painel_admin', 'função', 'admin_dashboard'),
  ('13_painel_admin', 'função', 'admin_vendas_periodo'),
  ('13_painel_admin', 'função', 'admin_atualizar_andamento'),
  ('13_painel_admin', 'tempo real', 'notificacoes'),
  -- 15 validação e comprovante
  ('15_validacao_comprovante', 'coluna', 'solicitacoes.comprovante'),
  ('15_validacao_comprovante', 'coluna', 'solicitacoes.comprovante_token'),
  ('15_validacao_comprovante', 'coluna', 'solicitacoes.aprovado_por'),
  ('15_validacao_comprovante', 'coluna', 'solicitacoes.motivo_cancelamento'),
  ('15_validacao_comprovante', 'índice', 'uq_solicitacoes_comprovante_token'),
  ('18_cpf_cnpj', 'coluna', 'profiles.documento'),
  ('18_cpf_cnpj', 'função', 'documento_valido'),
  ('18_cpf_cnpj', 'função', 'salvar_documento')
),
estrutura as (
  select i.arquivo, i.o_que, i.nome,
         case i.o_que
           when 'tabela'     then to_regclass('public.' || i.nome) is not null
           when 'sequência'  then to_regclass('public.' || i.nome) is not null
           when 'índice'     then to_regclass('public.' || i.nome) is not null
           when 'coluna'     then exists (select 1 from information_schema.columns c
                                           where c.table_schema = 'public'
                                             and c.table_name = split_part(i.nome, '.', 1)
                                             and c.column_name = split_part(i.nome, '.', 2))
           when 'função'     then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                           where n.nspname = 'public' and p.proname = i.nome)
           when 'gatilho'    then exists (select 1 from pg_trigger t where t.tgname = i.nome and not t.tgisinternal)
           when 'política'   then exists (select 1 from pg_policies p where p.policyname = i.nome)
           when 'restrição'  then exists (select 1 from pg_constraint k where k.conname = i.nome)
           when 'tempo real' then exists (select 1 from pg_publication_tables t
                                           where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = i.nome)
           when 'bucket'     then to_regclass('storage.buckets') is not null
                                  and (xpath('/row/ok/text()', query_to_xml(
                                        format('select exists (select 1 from storage.buckets where id = %L) as ok', i.nome),
                                        false, true, '')))[1]::text = 'true'
         end as ok
    from item i
),
dados as (
  -- conteúdo mínimo e as mudanças que não são só estrutura. Cada consulta só roda
  -- se a tabela existir (query_to_xml executa o texto na hora): banco atrasado não dá erro.
  select arquivo, o_que, nome,
         case when to_regclass(tabela) is null then false
              else (xpath('/row/ok/text()', query_to_xml(consulta, false, true, '')))[1]::text = 'true' end as ok
    from (values
      ('02_catalogo', 'dados', 'catálogo de preços preenchido', 'public.catalogo_precos',
       'select exists (select 1 from public.catalogo_precos) as ok'),
      ('05_funcionalidades', 'dados', 'funcionalidades cadastradas', 'public.funcionalidades',
       'select exists (select 1 from public.funcionalidades) as ok'),
      ('10_tornar_admin', 'dados', 'pelo menos um admin', 'public.profiles',
       'select exists (select 1 from public.profiles where role = ''admin'') as ok'),
      ('17_codigo_plano', 'formato', 'novas solicitações nascem como PLN-AAAA-0001', 'public.solicitacoes',
       'select exists (select 1 from information_schema.columns where table_schema = ''public'' and table_name = ''solicitacoes'' and column_name = ''codigo'' and column_default like ''%PLN-%'') as ok'),
      ('17_codigo_plano', 'dados', 'nenhuma solicitação com código SOL antigo', 'public.solicitacoes',
       'select not exists (select 1 from public.solicitacoes where codigo like ''SOL-%'') as ok')
    ) as d(arquivo, o_que, nome, tabela, consulta)
),
tudo as (
  select * from estrutura union all select * from dados
)
select situacao, arquivo, o_que, item, como_resolver from (
  select 0 as ordem, 'TUDO CERTO' as situacao, '-' as arquivo, '-' as o_que,
         count(*) || ' itens conferidos' as item, 'nada a fazer' as como_resolver
    from tudo having bool_and(ok)
  union all
  select case when ok then 2 else 1 end, case when ok then 'OK' else 'FALTA' end, arquivo, o_que, nome,
         case when ok then '' when arquivo = '10_tornar_admin' then 'rode sql/10_tornar_admin.sql com o seu e-mail'
              else 'rode sql/' || arquivo || '.sql' end
    from tudo
) r
order by ordem, arquivo, o_que, item;
