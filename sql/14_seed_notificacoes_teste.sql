-- =====================================================================
-- 14_seed_notificacoes_teste.sql — OPCIONAL, só para ver o sino funcionando.
-- Cria notificações de exemplo do tipo "compra_oferta" (e uma de outro tipo)
-- para TODOS os admins e para o cliente do e-mail indicado no 2º bloco
-- (troque 'cliente@exemplo.com' pelo e-mail de um cliente de teste).
-- Não rode em produção. Para apagar: a última consulta deste arquivo.
-- =====================================================================

insert into public.notificacoes (usuario_id, tipo, titulo, mensagem, link, lida, created_at, metadados)
select a.id, n.tipo, n.titulo, n.mensagem, n.link, n.lida, now() - n.ha, n.meta || '{"seed": true}'::jsonb
  from public.profiles a
 cross join (values
   ('compra_oferta', 'Nova compra de oferta: Dashboard de Gestão',
    'Cliente de teste comprou a oferta exibida no Início (R$ 3.200,00).', 'admin-clientes.html', false, interval '5 minutes',
    '{"oferta_slug": "dashboard", "valor": 3200, "origem": "faixa_oferta_inicio"}'::jsonb),
   ('compra_oferta', 'Nova compra de oferta: Blog + SEO',
    'Cliente de teste comprou pela dica de funcionalidades (R$ 900,00).', 'admin-clientes.html', false, interval '3 hours',
    '{"oferta_slug": "blog-seo", "valor": 900, "origem": "dicas_inicio"}'::jsonb),
   ('compra_oferta', 'Nova compra de oferta: Pagamentos Online (Pix/Cartão)',
    'Exemplo de notificação já lida.', 'admin-clientes.html', true, interval '2 days',
    '{"oferta_slug": "pagamentos-online", "valor": 1500}'::jsonb)
 ) as n(tipo, titulo, mensagem, link, lida, ha, meta)
 where a.role = 'admin';

insert into public.notificacoes (usuario_id, tipo, titulo, mensagem, link, lida, created_at, metadados)
select c.id, n.tipo, n.titulo, n.mensagem, n.link, n.lida, now() - n.ha, n.meta || '{"seed": true}'::jsonb
  from public.profiles c
 cross join (values
   ('compra_oferta', 'Compra confirmada: Dashboard de Gestão',
    'Recebemos seu pagamento. A equipe já colocou a funcionalidade na fila.', 'projetos.html', false, interval '5 minutes',
    '{"oferta_slug": "dashboard", "valor": 3200}'::jsonb),
   ('info', 'Bem-vindo à plataforma CMK COGIT',
    'Aqui você acompanha projetos, pagamentos e novidades.', 'inicio.html', true, interval '1 day',
    '{}'::jsonb)
 ) as n(tipo, titulo, mensagem, link, lida, ha, meta)
 where lower(c.email) = lower('cliente@exemplo.com');

-- conferir
select p.email, n.tipo, n.titulo, n.lida from public.notificacoes n join public.profiles p on p.id = n.usuario_id
 where n.metadados->>'seed' = 'true' order by n.created_at desc;

-- apagar os exemplos:
-- delete from public.notificacoes where metadados->>'seed' = 'true';
