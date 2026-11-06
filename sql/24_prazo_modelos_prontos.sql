-- =====================================================================
-- 24_prazo_modelos_prontos.sql — novos prazos dos modelos prontos (novembro de 2026)
-- Rode depois do 23. Pode rodar mais de uma vez.
--   Landing Page: 3 a 5 dias úteis · Portfólio: 3 a 5 · Site institucional: 3 a 7
-- A previsão de entrega de cada projeto novo (criado quando o pagamento é aprovado)
-- usa o fim da faixa. Projetos que já existem não mudam; o admin ajusta se quiser.
-- =====================================================================

create or replace function public.prazo_estimado_dias(p_resumo jsonb)
returns int
language plpgsql
immutable
as $$
declare
  v_dias  int := 0;
  v_item  jsonb;
  v_base  int;
  v_qtd   int := 0;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_resumo->'itens', '[]'::jsonb)) loop
    v_base := case v_item->>'id'
      -- modelo pronto: o fim de cada faixa (LP e portfólio 3 a 5, site 3 a 7 dias úteis);
      -- sob medida soma 15 (o prazo real sai do escopo e o admin ajusta a previsão)
      when 'landing-page'         then 5
      when 'portfolio'            then 5
      when 'site-institucional'   then 7
      when 'identidade-essencial' then 10
      when 'identidade-completa'  then 20
      when 'consultoria'          then 7
      when 'diagnostico'          then 5
      when 'automacao'            then 20
      when 'integracao'           then 20
      when 'loja-virtual'         then 35
      when 'sistema'              then 45
      when 'mvp'                  then 50
      when 'plataforma'           then 60
      else 20 end;
    if v_item->>'modelo' = 'sob-medida' then v_base := v_base + 15; end if;
    v_dias := greatest(v_dias, v_base);   -- a maior solução define a base
    v_qtd := v_qtd + 1;
  end loop;
  v_dias := v_dias + greatest(v_qtd - 1, 0) * 10
                   + jsonb_array_length(coalesce(p_resumo->'complementos', '[]'::jsonb)) * 5;
  return greatest(v_dias, 3);
end;
$$;

-- Conferir: dias úteis estimados por solução
select item, modelo, public.prazo_estimado_dias(jsonb_build_object('itens', jsonb_build_array(jsonb_build_object('id', item, 'modelo', modelo)))) as dias
  from (values ('landing-page', 'modelos-prontos'), ('portfolio', 'modelos-prontos'), ('site-institucional', 'modelos-prontos'),
               ('landing-page', 'sob-medida'), ('portfolio', 'sob-medida'), ('site-institucional', 'sob-medida')) v(item, modelo);
