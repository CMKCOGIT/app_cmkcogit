-- =====================================================================
-- 10_tornar_admin.sql — torna a SUA conta administradora (libera as telas
-- "Admin · Solicitações" e "Admin · Clientes"). Cadastre-se no app primeiro,
-- depois troque o e-mail abaixo e rode.
-- =====================================================================

update public.profiles set role = 'admin' where lower(email) = lower('adm@cmkcogit.com');

-- conferir:
select id, nome, email, role from public.profiles where role = 'admin';
