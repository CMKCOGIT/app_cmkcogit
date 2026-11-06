-- =====================================================================
-- 21_catalogo_2026_11.sql — catálogo de novembro de 2026 (igual a js/data.js do site)
-- Rode depois do 20. Pode rodar mais de uma vez.
--  - Landing Page R$ 600 (sob medida a partir de R$ 800); Portfólio R$ 500 (sob medida a partir de R$ 700)
--  - Loja virtual a partir de R$ 6.000; Automação a partir de R$ 890 (serviço e complemento)
--  - "Sistemas de Gestão" (sem CRM)
--  - Suporte: Técnico Essencial a partir de R$ 150 por solicitação; Técnico Contínuo R$ 150/mês
--  - Saem do catálogo (ficam inativos, solicitações antigas continuam legíveis):
--    consultoria (agora opcional e sem custo dentro do projeto), identidade visual completa e evolução contínua
-- =====================================================================

update public.catalogo_precos set preco = 600, preco_sob_medida = 800 where id = 'landing-page';
update public.catalogo_precos set preco = 500, preco_sob_medida = 700 where id = 'portfolio';
update public.catalogo_precos set preco = 6000 where id = 'loja-virtual';
update public.catalogo_precos set preco = 890 where id in ('automacao', 'automacao-extra');
update public.catalogo_precos set nome = 'Sistemas de Gestão' where id = 'sistema';
update public.catalogo_precos set nome = 'Suporte Técnico Essencial', preco = 150, tipo_preco = 'from', mensal = true where id = 'manutencao';
update public.catalogo_precos set nome = 'Suporte Técnico Contínuo', preco = 150, tipo_preco = 'fixed', mensal = true where id = 'suporte';
update public.catalogo_precos set ativo = false where id in ('consultoria', 'identidade-completa', 'evolucao');

-- Conferir
select id, nome, preco, preco_sob_medida, tipo_preco, mensal, ativo from public.catalogo_precos order by ativo desc, id;
