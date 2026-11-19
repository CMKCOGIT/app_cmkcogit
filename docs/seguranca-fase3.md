# Fase 3 — Segurança: o que foi implementado

> **Banco:** o `sql/33_seguranca.sql` precisa ser rodado no Supabase (SQL Editor) para ligar as
> proteções do banco. O código publicado funciona com ou sem ele (o limite de requisições só
> passa a valer depois do 33; até lá as rotas seguem normalmente).

## Implementado

| Área | O que mudou | Arquivos |
|---|---|---|
| Pagamento: link antigo | Link do Mercado Pago (preferência + Pix/boleto) vence em **72 h**. Cancelar, pedir ajustes, reenviar, tirar item ou mudar o valor **encerra o link no Mercado Pago** (preferência expira e Pix/boleto pendentes são cancelados), não só no banco. Link reaproveitado só se ainda estiver válido. | `lib/mercadopago.js`, `lib/cobranca.js`, `api/checkout.js`, `api/admin-solicitacao.js`, `api/solicitacoes.js`, `api/solicitacao-itens.js` |
| Pagamento: cancelamento pelo cliente | Passou a ser feito pelo servidor (`acao: 'cancelar'` em `/api/solicitacoes`), para poder encerrar o link no MP e avisar a equipe. | `api/solicitacoes.js`, `public/js/continuar.js` |
| Pagamento: exceções | Dinheiro aprovado que não liberou nada (valor divergente, pago após cancelamento, duplicidade) gera **alerta para cada admin** (sino), uma vez por pagamento. | `lib/mercadopago.js` |
| Idempotência | Preferência criada com `X-Idempotency-Key` (mesma cobrança + valor em 10 min = mesma preferência); continuam os índices únicos de cobrança pendente e de `mp_payment_id`. | `api/checkout.js` |
| Webhook | Com `MP_WEBHOOK_SECRET`, a assinatura `x-signature` é **obrigatória** (antes, aviso sem assinatura passava). Sem segredo, registra alerta no log. | `api/mp-webhook.js` |
| Confirmação só pelo servidor | Gatilhos no banco: ninguém logado (nem admin) marca cobrança como paga/reembolsada, troca `mp_payment_id`/`pago_em`, põe solicitação em "paga" ou muda `status_pagamento` do projeto. Só o servidor (Mercado Pago) e o SQL Editor. | `sql/33_seguranca.sql` |
| Rate limit | 429 + `Retry-After` + mensagem amigável em checkout (10/10 min), verificar pagamento (20/5 min), criar solicitação (15/h por conta + 30/h por IP), ações do cliente (30/10 min), tirar itens, ações do admin (120/10 min), comprovante público (60/10 min por IP), notificações, assinatura. Contagem no banco (vale para todas as instâncias). | `lib/limite.js`, rotas em `api/`, `sql/33` |
| Sessão do admin | Sai sozinho após **30 min sem uso** (conta todas as abas; volta ao login com aviso). | `public/js/app.js`, `public/js/login.js` |
| Troca de senha | Ao trocar (Meu perfil) ou redefinir (e-mail), **as outras sessões são encerradas**. `redefinir-senha.html` só troca sem a senha atual quando aberta pelo link do e-mail; logado, manda para "Meu perfil". | `public/js/perfil.js`, `public/js/redefinir-senha.js`, `public/js/app.js` |
| Auditoria do admin | Tabela `admin_auditoria` (quem, quando, tabela, antes → depois; CPF/CNPJ nunca gravado) em projetos, pagamentos, solicitações, pendências, perfis, catálogo, funcionalidades, arquivos e assinaturas. Só admin lê; ninguém apaga. | `sql/33_seguranca.sql` |
| Supabase advisors | `search_path` fixo em 10 funções; funções de gatilho fora da API pública; `preparar_quadro` só pelo gatilho; RPC antiga `admin_decidir_solicitacao` (aprovava sem histórico) fora da API. `rate_limits`/`consumir_limite` agora estão no repositório. | `sql/33_seguranca.sql` |
| Cabeçalhos | `Strict-Transport-Security`, `X-Permitted-Cross-Domain-Policies`, CSP com `object-src 'none'` (CSP, X-Frame-Options, nosniff, Referrer-Policy e Permissions-Policy já existiam). | `vercel.json` |
| Textos | Removido "o preço já está fechado: é só pagar" (todo pedido passa pela análise); mensagens de erro sem detalhe técnico nas telas tocadas. | `public/js/continuar.js`, `public/login.html`, `public/js/app.js` |

## Como testar
1. `npm test` — 100 testes (novos: link expira em 72 h e é reaproveitado/renovado; cliente cancela e o link/Pix é encerrado no MP; pagamento numa cobrança cancelada gera 1 alerta por admin; 429 com Retry-After; webhook sem assinatura recusado).
2. Rode o `sql/33_seguranca.sql`. A última consulta deve mostrar 3 gatilhos de proteção, 10 tabelas com auditoria e a função de rate limit.
3. Logado como admin, no console do navegador:
   `await db.from('pagamentos').update({ status: 'pago' }).eq('id', '<id pendente>')` → erro "Pagamento só é confirmado… pelo Mercado Pago".
4. Pague com o cartão de teste `APRO` → confirma normalmente (webhook/verificação).
5. Libere um pedido, clique em Pagar (não pague), cancele o pedido e abra o link antigo do Mercado Pago → deve aparecer como expirado/indisponível.
6. Clique em "Já paguei — verificar" mais de 20 vezes em 5 min → mensagem "Muitas tentativas…".
7. Admin: deixe a aba parada 30 min → volta ao login com o aviso de inatividade.
8. Troque a senha num navegador → o outro navegador logado cai no login na próxima ação.
9. `select * from admin_auditoria order by created_at desc` depois de mudar a previsão de um projeto.

## Configurações que são do painel (não de código) — recomendadas
- **Supabase → Authentication → Email:** ligar *Prevent use of leaked passwords*; senha mínima 8 com letras e números.
- **Supabase → Authentication → Rate Limits:** e-mails (cadastro/recuperação) ≤ 30/h; *sign-in/sign-up* ≤ 30 por 5 min por IP; verificações de OTP padrão. (Login, cadastro e recuperação de senha vão do navegador direto ao Supabase Auth: o limite deles é este.)
- **Supabase → Authentication → Attack Protection:** CAPTCHA (Cloudflare Turnstile) no cadastro e na recuperação de senha.
- **Supabase → Authentication → Sessions:** JWT de 1 h (padrão), *refresh token rotation* ligada com reuso de 10 s; *time-box*/*inactivity timeout* de sessão (plano Pro).
- **Supabase → Authentication → MFA:** habilitar TOTP (ver "não implementado").
- **Vercel:** `MP_WEBHOOK_SECRET` obrigatório em produção; `CRON_SECRET` longo; trocar credenciais que já foram coladas em conversas (o README já alerta).

## Não implementado (e por quê)
| Item | Por quê |
|---|---|
| Cookies HttpOnly/Secure/SameSite para a sessão | O app é estático + supabase-js no navegador, que guarda o token no `localStorage`. Cookie HttpOnly exige um servidor intermediando toda chamada ao Supabase (SSR/proxy) — reescrita grande. Mitigações: CSP rígida (`script-src 'self'`), expiração por inatividade do admin, encerramento de sessões ao trocar senha. |
| CSRF | Não se aplica: as rotas usam `Authorization: Bearer` (não cookie), então outro site não consegue agir em nome do usuário. |
| CORS restrito | As funções não enviam `Access-Control-Allow-Origin`, então o navegador já bloqueia chamadas de outras origens. Nada a restringir. |
| MFA obrigatório para admin | Requer tela de cadastro/desafio do TOTP e exigir `aal2` nas regras do banco (`is_admin()`); se ligado sem a tela, os admins ficam trancados para fora. Proposto como item do backlog. |
| Rate limit de login/cadastro/recuperação no nosso servidor | Essas chamadas não passam pelo nosso servidor (vão direto ao Supabase Auth); o controle é a configuração do painel acima + CAPTCHA. |
| Validação por schema (ex.: zod) | As rotas já validam no servidor tudo que recebem (`sanitizarCfg`, `validarItensAdmin`, UUID, limites de tamanho de corpo/texto) e recalculam preço; adicionar uma biblioteca exigiria build/dependências que o projeto não tem. |
| Tolerância de horário (`ts`) no webhook | O Mercado Pago reenvia avisos com o mesmo `ts`; rejeitar por idade derrubaria reenvios legítimos. O reenvio de um aviso é inofensivo porque o servidor sempre consulta o pagamento na API e o processamento é idempotente. |
| Estorno automático das exceções | Devolver dinheiro deve ser decisão humana; agora a equipe é avisada na hora. Botão de estorno fica para a tela "Pagamentos → Exceções" (Fase 2). |
| `COOP` (Cross-Origin-Opener-Policy) | Quebraria o envio do site personalizado pelo editor do modelo (usa `window.opener`). |
