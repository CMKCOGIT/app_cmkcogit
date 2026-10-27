# CMK COGIT — Plataforma do cliente (app.cmkcogit.com.br)

Recebe a solução que o visitante montou no site (diagnóstico da página inicial ou "Monte sua solução"),
pede login/cadastro, guarda a solicitação na conta e cobra pelo Mercado Pago (Pix, cartão ou boleto).

```
cmkcogit.com.br  ──"Continuar na plataforma"──►  app.cmkcogit.com.br/continuar.html#cfg=...
                                                     │ (solução guardada no navegador até o login)
                                                     ▼
                                               login / criar conta
                                                     ▼
                         POST /api/solicitacoes  (servidor recalcula o preço pelo catálogo)
                    ┌────────────────────────────────┴───────────────────────────────┐
           preço fechado (modelo pronto,                                   sob medida / "a partir de"
           consultoria, identidade)                                        → em validação
           → aguardando pagamento                                          → admin define o valor
                    └────────────────────────────────┬───────────────────────────────┘
                                                     ▼
                         POST /api/checkout → Mercado Pago (Checkout Pro)
                                                     ▼
          confirmação: volta do checkout + botão "Já paguei — verificar" + webhook
          (o servidor SEMPRE consulta o pagamento na API do Mercado Pago e confere o valor)
                                                     ▼
                          cobrança "Paga" + projeto criado em "Meus projetos"
```

## O que tem aqui

| Pasta / arquivo | O que é |
|---|---|
| `public/` | Páginas (HTML + JS) — veja a lista abaixo |
| `public/css/plataforma.css` | Visual da plataforma (tokens da marca + componentes), baseado no site. Estiliza o HTML existente sem depender de classes no JS |
| `public/assets/` | Logo, símbolo/favicon e fontes (Inter e Manrope) copiados do site, servidos localmente |
| `api/` | Funções do servidor (Vercel): `solicitacoes`, `checkout`, `verificar-pagamento`, `mp-webhook`, `config` |
| `lib/` | Cálculo de preço, cliente REST do Supabase e Mercado Pago (sem dependências) |
| `sql/` | Banco: rode no Supabase na ordem `00` → `09`, depois o `10` e o `11` |
| `dev-server.mjs` | Roda tudo no seu computador, igual à Vercel |
| `tests/` | Testes automáticos (`npm test`) |

### Telas

| Página | Quem | O que faz |
|---|---|---|
| `login.html` | todos | Entrar, criar conta, recuperar senha (mostra a solução trazida do site) |
| `inicio.html` | cliente | Botão "Montar nova solução", resumo, atualizações dos projetos (notificações), próximo passo, dicas de funcionalidades com preço (e faixa de oferta no topo) e suporte |
| `continuar.html` | cliente | Minhas solicitações: recebe a solução do site, pagar ou aguardar validação |
| `pagamentos.html` | cliente | Cobranças, pagar, "Já paguei — verificar" |
| `projetos.html` | cliente | Sites/soluções adquiridos com % de progresso, previsão de entrega e atalho para o repositório |
| `projeto.html?id=...` | cliente/admin | Tudo sobre o produto: etapas, prazo, domínio, pendências, repositório, funcionalidades, pagamentos. Admin avança etapa, muda status/previsão/domínio e cria pendências |
| `projeto.html?id=...#repositorio` | cliente/admin | Repositório do projeto: a equipe envia código e entregas, o cliente envia documentação (até 50 MB por arquivo); cada lado é avisado |
| `perfil.html` | cliente | Nome, WhatsApp, troca de e-mail (com confirmação), troca de senha e "sair de todos os dispositivos" |
| `funcionalidades.html` | cliente | Adquirir nova funcionalidade para um projeto e pagar no Mercado Pago |
| `admin.html` | admin | Validar solicitações sob medida (definir valor) e avisos do Mercado Pago |
| `admin-clientes.html` | admin | Cada cliente: o que comprou, quanto pagou/deve, progresso de cada projeto |

**Prazo:** quando um projeto é criado pelo pagamento, a previsão de entrega é calculada pelo tamanho
(tipo da solução, sob medida, quantidade de soluções e complementos) — função `prazo_estimado_dias` no
`sql/09`. Ajuste os dias lá; o admin também pode mudar a previsão de cada projeto.

Não precisa de `npm install`: o projeto não tem dependências. Requer Node.js 20 ou mais novo.

---

## 1. Banco (Supabase)

1. Crie um projeto em supabase.com (ou use o que já tem).
2. **SQL Editor → New query**, cole e rode, nesta ordem:
   - `00_opcional_remover_rascunhos_antigos.sql` — se você já rodou os rascunhos de solicitação
     (consultas salvas "solicitacao_site", "vincular_solicitacao", "definir_valor"...). Apaga só a tabela
     `solicitacoes` antiga e aquelas funções; não mexe em perfis, projetos, etapas, pendências, arquivos,
     funcionalidades nem pagamentos.
   - `01_base.sql` … `09_aplicar_pagamento_mp.sql` (ou o arquivo único `tudo_01_a_09.sql`).
     Eles seguem a estrutura que você já tinha (perfis, projetos com 8 etapas, pendências, arquivos,
     funcionalidades, pagamentos) e só acrescentam o que falta, sem apagar dados.
   Todos podem rodar mais de uma vez.
3. **Authentication → URL Configuration**:
   - Site URL: `https://app.cmkcogit.com.br`
   - Redirect URLs: `https://app.cmkcogit.com.br/**` e `http://localhost:3000/**`
4. **Authentication → Providers → Email**: deixe "Confirm email" ligado (recomendado). O cliente
   precisa abrir o link de confirmação **no mesmo navegador** para a solução montada continuar com ele.
5. Cadastre-se no app (passo 3), depois troque o e-mail em `10_tornar_admin.sql` e rode para virar admin.
6. Rode `11_repositorio_notificacoes_perfil.sql`. Ele cria o bucket privado `arquivos` no Storage (repositório
   de cada projeto, pastas `<projeto>/equipe` e `<projeto>/cliente`), a tabela `notificacoes` com os avisos
   automáticos (etapa avançou, nova previsão, arquivo novo, pendência, funcionalidade paga/entregue) e mantém
   o e-mail do perfil igual ao do login quando o cliente troca de e-mail.
   Sem o `11`, o app continua funcionando, só sem notificações e sem envio de arquivos.

Se mudar um preço no site (`js/data.js`), mude também em `sql/02_catalogo.sql` e rode de novo:
**quem decide o valor cobrado é o banco**, não o navegador.

## 2. Mercado Pago — credenciais de teste

1. developers.mercadopago.com.br → **Suas integrações** → crie uma aplicação (Checkout Pro).
2. **Contas de teste** → crie duas: um **vendedor** e um **comprador**.
3. Entre no painel com a conta de teste **vendedora** e copie o **Access Token de produção** dela
   (começa com `APP_USR-`). É esse que vai em `MP_ACCESS_TOKEN` durante os testes.
4. Para pagar no teste: janela anônima, entre no Mercado Pago com a conta de teste **compradora**.
   Cartão Mastercard `5480 8328 0103 3311`, CVV `123`, validade `11/30`, CPF `12345678909`.
   O **nome no cartão** decide o resultado: `APRO` aprova, `OTHE` recusa, `CONT` deixa pendente.

> Pix e boleto no teste ficam "pendentes" (não há como pagá-los de verdade). Para ver o fluxo
> completo até "Pago", use o cartão com `APRO`.

As chaves que foram coladas em conversas anteriores devem ser **trocadas** antes de ir para produção.

## 3. Rodar no seu computador

```bash
cp .env.example .env.local     # preencha Supabase + MP_ACCESS_TOKEN (teste)
npm run dev                    # http://localhost:3000
npm test                       # testes automáticos
```

Para testar o caminho completo site → app no computador, rode o site também
(`npm run dev` na pasta do site, porta 4173). Quando o site roda em `localhost`, o botão
"Continuar na plataforma" já aponta para `http://localhost:3000`.

Roteiro de teste:
1. No site, diagnóstico → **Landing Page → Modelos Prontos** → "Continuar na plataforma".
2. Crie a conta → confirme o e-mail (mesmo navegador) → a solicitação aparece com R$ 500.
3. **Pagar com Mercado Pago** → pague com a conta compradora e o cartão `APRO`.
4. No computador o Mercado Pago **não volta sozinho** (só volta automaticamente para endereços https):
   clique em "Voltar ao site" no comprovante, ou abra **Pagamentos → Já paguei — verificar**.
   O servidor consulta o Mercado Pago e o status vira **Pago**; o projeto aparece em "Meus projetos".
5. Abra **Meus projetos** → o projeto: progresso, 8 etapas e previsão de entrega. Como admin, avance a etapa.
6. **Adquirir nova funcionalidade** → escolha o projeto → pague → o pedido aparece como "Paga" no projeto.
7. Repita com **Site Institucional → Sob medida**: fica "Em validação". Entre como admin em
   **Admin · Solicitações**, defina o valor, e o cliente consegue pagar.
8. Em **Admin · Clientes e projetos** veja quem comprou o quê. Em **Admin · Solicitações**, a tabela "Últimos avisos do Mercado Pago" mostra tudo que o Mercado Pago informou.

**Webhook no computador (opcional):** o Mercado Pago só chama endereços públicos. Rode um túnel
(ex.: `cloudflared tunnel --url http://localhost:3000`), coloque o endereço https em `PUBLIC_URL`
no `.env.local` e reinicie. Sem isso, a confirmação funciona pela volta/botão de verificação.

## 4. GitHub + Vercel

1. Crie um repositório (ex.: `cmkcogit-app`) e envie esta pasta (o `.env.local` fica de fora pelo `.gitignore`).
2. vercel.com → **Add New → Project** → importe o repositório. Framework: **Other**. Não precisa de
   comando de build (o `vercel.json` já define a pasta `public`).
3. **Settings → Environment Variables** (Production e Preview): as mesmas do `.env.example`, com
   `APP_URL=https://app.cmkcogit.com.br`. Em produção use o Access Token da sua conta **real**.
4. **Settings → Domains** → adicione `app.cmkcogit.com.br` e crie no seu DNS o registro que a Vercel
   indicar (normalmente `CNAME app → cname.vercel-dns.com`).
5. Mercado Pago → sua aplicação → **Webhooks** (modo produção): URL
   `https://app.cmkcogit.com.br/api/mp-webhook`, evento **Pagamentos**. Copie a **assinatura secreta**
   para `MP_WEBHOOK_SECRET` na Vercel e faça um novo deploy.

Cada `git push` na branch principal publica sozinho; cada branch/PR ganha uma URL de preview.

## Segurança — o que já está garantido

- O valor cobrado vem sempre do banco (`catalogo_precos` / valor definido pelo admin); preço enviado pelo navegador é ignorado.
- Confirmação só depois de consultar o pagamento na API do Mercado Pago, conferindo cobrança (`external_reference`), valor e moeda. Valor diferente não libera nada e fica registrado.
- Webhook com assinatura `x-signature` validada quando enviada; avisos repetidos não duplicam nada.
- RLS: cada cliente só vê o que é dele; cliente não cria/altera cobranças nem projetos; ninguém vira admin pelo cadastro.
- A `service_role` e o token do Mercado Pago ficam só no servidor; `/config.js` entrega apenas a chave pública (anon).
- Uma cobrança pendente por solicitação; dois cliques em "Pagar" reaproveitam o mesmo link.

## Observações

- O `Content-Security-Policy` do `vercel.json` libera `*.supabase.co`. Se usar domínio próprio no Supabase, acrescente-o em `connect-src`.
- O supabase-js é carregado do jsDelivr com versão fixa (`2.45.4`).
