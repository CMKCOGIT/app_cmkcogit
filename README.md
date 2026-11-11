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
| `public/css/plataforma.css` + `identidade.css` | Visual da plataforma. `tokens.css` tem a paleta e as fontes da identidade 2026 (igual ao site); `identidade.css`, carregado por último, tira degradês e sombras e aplica cantos retos, Clash Display nos títulos e Satoshi na interface |
| `public/assets/` | Logo, símbolo/favicon e fontes (Clash Display e Satoshi, identidade 2026) copiados do site, servidos localmente |
| `api/` | Funções do servidor (Vercel): `solicitacoes`, `checkout`, `verificar-pagamento`, `mp-webhook`, `config`, `mensagens-ia` (Gemini) |
| `lib/` | Cálculo de preço, cliente REST do Supabase e Mercado Pago (sem dependências) |
| `sql/` | Banco: rode no Supabase na ordem `00` → `09`, depois o `10`, `11`, `12`, `13`, `15`, `17`, `18`, `19`, `20` e `21` (o `14` é só dado de teste) |
| `dev-server.mjs` | Roda tudo no seu computador, igual à Vercel |
| `tests/` | Testes automáticos (`npm test`) |

### Telas

| Página | Quem | O que faz |
|---|---|---|
| `login.html` | todos | Entrar, criar conta (e-mail/senha ou **Continuar com Google**), recuperar senha (mostra a solução trazida do site) |
| `completar-cadastro.html` | logado com cadastro pendente | Dados obrigatórios antes de liberar a plataforma (nome, CPF/CNPJ + aceite dos termos; WhatsApp opcional). Salva rascunho enquanto digita |
| `admin-inicio.html` | admin | **Início do admin = painel de gestão**: faturamento (vs. período anterior), vendas, ticket médio, conversão, pendentes, mais vendido, o que vendemos, gráficos, top 5 clientes, atividades, prazos e exportar CSV. Filtro: hoje, 7 dias, 30 dias, mês atual ou personalizado |
| `inicio.html` | cliente | Botão "Montar nova solução", resumo, atualizações dos projetos (notificações), próximo passo, dicas de funcionalidades com preço (e faixa de oferta no topo) e suporte |
| `continuar.html` | cliente | Minhas solicitações: recebe a solução do site, pagar ou aguardar validação |
| `pagamentos.html` | cliente | Cobranças, pagar, "Já paguei — verificar" |
| `projetos.html` | cliente | Sites/soluções adquiridos com % de progresso, previsão de entrega e atalho para o repositório |
| `projeto.html?id=...` | cliente/admin | Tudo sobre o produto: etapas, prazo, domínio, pendências, repositório, funcionalidades, pagamentos. Admin avança etapa, muda status/previsão/domínio e cria pendências |
| `projeto.html?id=...#repositorio` | cliente/admin | Repositório do projeto: a equipe envia código e entregas, o cliente envia documentação (até 50 MB por arquivo); cada lado é avisado |
| `perfil.html` | cliente | Nome, WhatsApp, CPF/CNPJ (mascarado), troca de e-mail (com confirmação), troca de senha e "sair de todos os dispositivos" |
| `funcionalidades.html` | cliente | Adquirir nova funcionalidade para um projeto e pagar no Mercado Pago |
| `admin.html` | admin | Solicitações: cada card abre o **modal de validação** — itens com checkbox ("Remover selecionados"), "+ Adicionar funcionalidade" (catálogo ou item personalizado, marcados como "adicionado pela equipe"), valor sugerido recalculado + valor final editável, mensagem ao cliente, resumo com prévia do comprovante, aprovação (quem/quando) e envio pelo WhatsApp; cancelar com motivo. Também os avisos do Mercado Pago |
| `comprovante.html?t=...` | público | Comprovante do pedido aprovado (link único e aleatório, sem login): itens, valor final, status do pagamento e a mensagem da equipe em destaque. "Baixar PDF" usa a impressão do navegador (Salvar como PDF) |
| `mensagens.html` | cliente/admin | **Mensagens**: o cliente conversa com a equipe; o admin vê todas as conversas (clientes + equipe: grupo e diretas entre admins). Texto com *negrito*/_itálico_, áudio gravado no navegador, arquivos até 25 MB (arrastar/colar), editar e apagar a própria mensagem, "visto", tempo real e aviso no sino. Admin: **nota interna** (tag amarela, o cliente nunca vê nem é avisado), **sugestões com IA** (Gemini: sugerir resposta, melhorar o rascunho), detalhes do cliente e **Modelos e WhatsApp** (construir mensagem com IA, variáveis `{primeiro_nome}` `{projeto}` `{link}`, prévia, salvar, copiar e abrir no WhatsApp manualmente, registrando o envio como nota interna) |
| `admin-quadros.html` | admin | **Quadros** (estilo Trello, só a equipe): seletor de quadro por **projeto** (criado sozinho para cada projeto), **empresa** ou **tema interno**; colunas com arrastar e soltar, limite e "conclui"; cartão com descrição, responsáveis, etiquetas, datas, prioridade, capa, checklists, anexos, comentários, histórico, ligação com cliente/projeto, mover entre quadros, duplicar e arquivar; visões Quadro, Lista e **Minhas tarefas**; filtros e busca; cadastro de **Empresas** (clientes e projetos por empresa); avisos no sino (marcado como responsável, comentário, prazo) |
| `jornada.html` | cliente/admin | **Jornada MVP (em teste)**: o cliente responde 9 módulos (bases do projeto; proposta de valor com árvore do problema, segmentos de clientes com objetivos e mapa de oportunidades; concorrência, stakeholders, modelo de negócio, jornada do usuário, funcionalidades, dados e integrações, operação e prazo), com salvamento automático. Pode ter vários projetos (`?id=`). **Quem revisa é o mentor** com quem o projeto foi compartilhado (no mvp.cmkcogit.com.br); sem mentor, o módulo enviado completo já fica aprovado (o admin não revisa mais, só acompanha e gera prévias). Com tudo aprovado, a IA (`lib/ia.js`) lê as respostas e lista as funcionalidades do MVP; horas, valor e prazo são calculados no servidor pelos parâmetros de `lib/jornada.js` (valor da hora em `JORNADA_VALOR_HORA`). O cliente vê escopo, faixa de valor e prazo; horas e valor por item só a equipe. Trilha e perguntas ficam em `lib/jornada.js`; banco no `sql/30_jornada_mvp.sql`; rota `/api/notificacoes?rota=jornada` (código em `lib/jornada-rota.js`; não é um arquivo em `api/` por causa do limite de 12 funções do plano Hobby da Vercel) |
| `admin-mentores.html` | admin | **Mentores e orçamentos MVP**: aprova/recusa os pedidos "Quero ser mentor" feitos no mvp (concede a permissão pelo banco), retira a permissão, mostra a margem por mês (receita − custo de IA) e os orçamentos detalhados pagos com PDF, "gerar de novo" e estorno |
| `construir.html` (rota `/projeto/{id}`) | cliente | "Construir com a CMK Cogit": recebe o projeto (jornada) salvo no banco, cria a solicitação a partir do orçamento salvo e leva para Minhas solicitações. Sem login, volta para cá depois de entrar |
| `admin-clientes.html` | admin | Clientes: cards ou tabela, busca em tempo real por projeto/código/cliente, filtros rápidos (pago/pendente, em andamento/concluído, atrasado, entrega em 7 dias) e o detalhe de cada projeto, onde o admin atualiza % e status até concluir |

**Cliente × admin.** O admin não compra: o menu dele é só Início (painel), Solicitações, Clientes, Meu perfil e Sair.
As telas de compra/acompanhamento do cliente (`inicio`, `continuar`, `pagamentos`, `projetos`, `funcionalidades`)
mandam o admin para `admin-inicio.html` mesmo digitando a URL, e as telas de admin mandam o cliente para o `inicio.html`
(`protegerPagina()` em `js/app.js`). No servidor, `/api/solicitacoes` e `/api/checkout` recusam admin
(403 `somente_cliente`), e os dados continuam protegidos pelo RLS.

**Notificações (sino no topo, cliente e admin).** Contador de não lidas, lista e "marcar como lida", pela rota
`/api/notificacoes` (GET lista; POST `marcar_lida`/`marcar_todas`). Atualiza em tempo real (Supabase Realtime) e a
cada 45 s como garantia. A notificação é genérica (`notificacoes`: tipo, título, mensagem, destinatário, lida/lida_em,
data, `metadados`); o servidor cria com `createNotification()` (`lib/notificacoes.js`). O tipo **`compra_oferta`**
(funcionalidade extra paga) já dispara pelo ponto certo (pagamento confirmado → `notificarCompraOferta`), mas **as
regras de quando avisar ainda não estão definidas**: ficam em `lib/notificacoes.config.js`,
`shouldNotifyOnOfferPurchase(event)`, hoje um placeholder desligado (`habilitado: false`, ver os `TODO(regras)`).

**Prazo:** quando um projeto é criado pelo pagamento, a previsão de entrega é calculada pelo tamanho
(tipo da solução, sob medida, quantidade de soluções e complementos) — função `prazo_estimado_dias` no
`sql/09`. Ajuste os dias lá; o admin também pode mudar a previsão de cada projeto.

Requer Node.js 20 ou mais novo. Rode `npm install` uma vez: as únicas dependências são do servidor
(`@anthropic-ai/sdk` para o documento detalhado e `pdf-lib` + `@pdf-lib/fontkit` para o PDF). A Vercel instala sozinha.

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
7. Rode `12_cadastro_google.sql` (login com Google e "cadastro concluído") — **antes** de publicar a versão
   do app que tem o botão do Google. Veja a seção 5.
8. Rode `13_painel_admin.sql` **antes** de publicar a versão com o painel de gestão. Ele acrescenta em `projetos`
   o `progresso` (% definida pelo admin; vazio = calculado pelas etapas, como antes) e o `concluido_em`
   (preenchido para os já concluídos com a data da última etapa fechada), a função `admin_atualizar_andamento`
   (100% = concluído, com data registrada), as consultas agregadas do painel (`admin_dashboard` e
   `admin_vendas_periodo`, que contam só pagamentos **pagos**, no fuso de Brasília) e, nas notificações, `metadados`,
   `lida_em` e o tempo real.
9. Rode `15_validacao_comprovante.sql` **antes** de publicar o modal de validação: guarda quem aprovou e quando,
   o link único e a cópia do comprovante, e o motivo/quem/quando do cancelamento. A aprovação continua sendo o status
   "aguardando pagamento" (o checkout não muda).
10. Opcional, só para ver o sino com dados: `14_seed_notificacoes_teste.sql` (troque o e-mail do cliente de teste
   dentro dele). Apague depois com a consulta do fim do arquivo.
11. Rode `17_codigo_plano.sql`: as solicitações passam a se chamar **PLN-2026-0001** (Plano; quando pago vira o
   projeto COG-2026-100). As que já existem são renumeradas e o código é trocado no nome do projeto, nas cobranças,
   nas notificações e no comprovante.
12. Opcional, para limpar testes: `16_opcional_zerar_solicitacoes.sql` mantém só as solicitações **pagas de verdade**
   (status paga + cobrança confirmada) e apaga o resto. Rode a prévia antes; rode o 16 **antes** do 17 para a
   numeração recomeçar do 0001.
13. Rode `18_cpf_cnpj.sql` **antes** de publicar a versão que pede CPF/CNPJ. O perfil ganha `documento` (só números,
   dígitos verificadores conferidos pelo banco), visível só para o próprio cliente e o admin. O cliente grava pela
   função `salvar_documento` (Meu perfil) ou ao concluir o cadastro, que passa a exigir o documento. Contas antigas
   continuam entrando, mas o `/api/checkout` só abre o pagamento depois do documento informado (manda para
   "Meu perfil") e envia CPF/CNPJ ao Mercado Pago. Na tela ele aparece mascarado (`***.456.789-**`).
14. Rode `19_assinaturas.sql` para os **planos mensal e anual** do modelo pronto. Quando a cobrança de um pedido com
   plano mensal/anual é paga, nasce uma assinatura com o próximo vencimento. Todo dia a rotina `/api/renovacoes`
   (cron da Vercel em `vercel.json`) cria a cobrança da renovação 7 dias antes do vencimento, em **Pagamentos**,
   avisa no sino e manda e-mail. Pagou, o vencimento avança um período; o cliente pode **cancelar a renovação**
   em Pagamentos (o site fica no ar até o fim do período pago). Renovação automática no cartão só se o cliente
   pedir (veja o item 15).
   Na Vercel, configure `CRON_SECRET` (qualquer texto longo e aleatório) e, para os e-mails, `RESEND_API_KEY` e
   `EMAIL_FROM` (ex.: `CMKCOGIT <cobranca@cmkcogit.com.br>`, com o domínio verificado no [Resend](https://resend.com)).
   Sem o Resend, a cobrança e o aviso no sino continuam funcionando, só sem e-mail.
15. Rode `20_renovacao_cartao.sql` para a **renovação automática no cartão** (opcional para o cliente). Em
   Pagamentos → Seus planos, "Renovar automaticamente no cartão" cria uma assinatura no Mercado Pago
   (`POST /preapproval`, rota `/api/assinatura`) e leva o cliente para cadastrar o cartão; na volta a plataforma
   confere e liga a renovação automática (a cobrança manual pendente é cancelada). A rotina diária consulta cada
   assinatura no Mercado Pago e registra como paga cada cobrança nova do cartão (o vencimento avança). Se a
   assinatura for cancelada lá, ou o cartão não for cobrado em até 5 dias do vencimento, volta para a cobrança por
   e-mail + Pagamentos e o cliente é avisado. Cancelar o plano também cancela no Mercado Pago. Teste com a conta de
   teste do Mercado Pago antes de divulgar.

16. Rode `25_mensagens.sql` para a tela de **Mensagens**: tabelas `conversas`, `mensagens`, `conversa_leituras` e
   `modelos_mensagem` (com 5 modelos iniciais), bucket privado `mensagens` no Storage (`<conversa>/publico|interno/...`),
   regras de acesso (a nota interna e o anexo dela são invisíveis para o cliente no próprio banco), aviso no sino e tempo real.
   **IA (gratuita, Groq):** crie uma chave em [console.groq.com/keys](https://console.groq.com/keys) e, na Vercel, configure
   `GROQ_API_KEY` (opcional: `GROQ_MODEL`, padrão `openai/gpt-oss-120b`). Também aceita o Gemini (`GEMINI_API_KEY`,
   `GEMINI_MODEL`); com os dois, a Groq vem primeiro e o Gemini é a reserva quando ela está no limite. Sem chave, as mensagens
   funcionam normalmente e o painel de IA avisa que não está configurado. Só administradores usam a IA (rota `/api/mensagens-ia`).

17. Rode `26_mensagens_assunto_projeto.sql`, `27_quadros.sql` e `28_quadros_integridade.sql` para o assunto/projeto nas
   mensagens e para os **Quadros** de tarefas e o cadastro de **Empresas**. O lembrete de prazo dos cartões roda na
   mesma rotina diária `/api/renovacoes`.

18. Rode `29_assistente_uso.sql` para o **Assistente IA** (só admin): botão fixo em todas as telas do admin e no
   cabeçalho de Mensagens, chat com resposta em streaming (rota `/api/mensagens-ia?modo=assistente`, código em `lib/assistente.js`, Groq
   `openai/gpt-oss-120b`). **Atenção:** o plano Hobby da Vercel aceita no máximo 12 arquivos em `api/` (o `npm test` confere).
   A tabela `ia_uso` só conta pedidos e tokens para respeitar o limite da Groq (não guarda conversas; o histórico
   fica só na aba do navegador). Ajustes em `config/assistente.config.js` (modelo, temperatura, orçamentos e limites).
   **Base de conhecimento:** pasta `knowledge/`, um `.md` por assunto. O `00-identidade-e-regras.md` vai sempre; dos
   outros entram só as **seções** (`## ...`) que combinam com a pergunta (palavras do cabeçalho `palavras:`), dentro do
   orçamento de tokens. Seção só com o comentário-guia não vai para a IA, que então diz que não tem a informação.
   Escreva só fatos reais e, depois de mudar um `.md`, rode `npm run base` (gera `lib/base-conhecimento.gerada.js`,
   que vai junto no deploy; o `npm test` avisa se esquecer). Chave: usa `GROQ_API_KEY`; opcional `GROQ_API_KEY_ASSISTENTE` para uma chave só dele.

19. Rode `31_mvp_orcamento_mentor.sql` para o **orçamento detalhado pago (R$ 30)**, os **mentores** e o
   **mvp.cmkcogit.com.br** (que usa este mesmo banco e não tem migrations). Veja a seção 6. Ele também passa a
   permitir vários projetos por cliente na Jornada e troca a revisão dos módulos do admin para o mentor: os módulos que
   estavam "enviado" esperando a equipe ficam aprovados. Teste local do banco: `npm run test:sql` (seção 6.5).

**O banco está atualizado?** Rode `sql/conferir_banco.sql` no SQL Editor (só leitura, não altera nada).
A primeira linha diz **TUDO CERTO** ou lista o que **FALTA** e qual arquivo rodar.

**Tem dado falso ou de teste?** Rode `sql/auditar_dados.sql` (também só leitura): aponta notificações de exemplo do
`sql/14`, pagamentos "pagos" sem confirmação do Mercado Pago, solicitações/projetos "pagos" sem cobrança paga, contas
de teste, cobranças esquecidas e o que mais estiver inconsistente, cada um com o que fazer.

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
npm test                       # testes automáticos (e confere as versões de CSS/JS)
npm run versionar              # depois de mudar qualquer CSS/JS em public/
```

**Mudou CSS ou JS? Rode `npm run versionar` antes do commit.** Os HTMLs apontam para
`app.js?v=<hash>`: o navegador guarda CSS/JS por 1 ano (troca de tela sem baixar nada) e,
como o endereço muda junto com o conteúdo, ninguém fica com versão velha depois do deploy.
O `npm test` falha se alguma versão estiver desatualizada.

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
   **Solicitações**, defina o valor, e o cliente consegue pagar.
8. Em **Clientes** veja quem comprou o quê; abra um projeto e mude a % e o status (100% conclui). Em **Solicitações**,
   a tabela "Últimos avisos do Mercado Pago" mostra tudo que o Mercado Pago informou.
9. No **Início** do admin confira o painel (troque o período, passe o mouse no gráfico, exporte o CSV). Digite
   `/pagamentos.html` logado como admin: volta para o painel. Logado como cliente, `/admin-clientes.html` volta ao início.
10. Em **Solicitações**, clique num card "Em validação": marque dois itens → "Remover selecionados" (o valor sugerido
   cai), "+ Adicionar funcionalidade" (busque no catálogo ou crie um personalizado), mude o valor final e escreva a
   mensagem → "Aprovar e liberar" → confira a prévia → confirme: o WhatsApp do cliente abre com o link do comprovante e
   a solicitação sai do filtro "Em validação". Feche com alteração não salva: o modal pede confirmação.
   **WhatsApp:** o link `wa.me` só leva texto, por isso o comprovante vai como link. Envio automático do PDF exige a API
   oficial do WhatsApp Business (fase 2).

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

## 5. Login com Google

O botão **Continuar com Google** (em "Entrar" e em "Criar conta") usa o OAuth do próprio Supabase
(`signInWithOAuth`): a sessão é a mesma do login por e-mail, e nenhum segredo fica no navegador.

**Regra:** ter sessão do Google não é ter cadastro. Toda página interna (`protegerPagina()` em `js/app.js`)
e as rotas `/api/solicitacoes` e `/api/checkout` exigem `profiles.cadastro_concluido_em` preenchido.
Quem não concluiu vai para `completar-cadastro.html`. Só o banco grava esse campo, pela função
`concluir_cadastro()`, depois de validar nome e aceite dos termos (os mesmos obrigatórios do cadastro por e-mail).

### 5.1 Banco
Rode `sql/12_cadastro_google.sql` no SQL Editor. Ele marca como concluídas **uma única vez** as contas que já
existiam (cadastro por e-mail e admins), então ninguém antigo é bloqueado. Pode rodar de novo sem efeito.

### 5.2 Google Cloud (credenciais OAuth)
1. console.cloud.google.com → crie ou escolha um projeto.
2. **Google Auth Platform → Branding** (tela de consentimento): nome do app "CMK COGIT", e-mail de suporte,
   links da Política de Privacidade e dos Termos do site. Em **Authorized domains** adicione `cmkcogit.com.br`
   e `SEU-PROJETO.supabase.co`.
3. **Audience**: tipo **External** → **Publish app** (em "Testing" só os e-mails de teste conseguem entrar).
4. **Data access**: só os escopos básicos `openid`, `.../auth/userinfo.email` e `.../auth/userinfo.profile`
   (não exigem verificação do Google).
5. **Clients → Create client → Web application**:
   - Authorized JavaScript origins: `https://app.cmkcogit.com.br` e `http://localhost:3000`
   - Authorized redirect URIs: `https://SEU-PROJETO.supabase.co/auth/v1/callback`
     (é a "Callback URL" que aparece no Supabase, passo 5.3)
6. Copie o **Client ID** e o **Client secret**. O secret vai **só** no painel do Supabase — nunca no
   código, no `.env.local` nem na Vercel.

### 5.3 Supabase
1. **Authentication → Sign In / Providers → Google**: ligue, cole Client ID e Client secret, salve.
2. **Authentication → URL Configuration**: Site URL `https://app.cmkcogit.com.br`; Redirect URLs
   `https://app.cmkcogit.com.br/**` e `http://localhost:3000/**` (os mesmos do passo 1.3; o app volta
   para `/login.html`). Para testar em previews da Vercel, acrescente a URL do preview com `/**`.
3. Deixe a vinculação automática de identidades como está (padrão) e "Allow manual linking" desligado:
   o Supabase só junta o Google a uma conta de e-mail existente quando o e-mail está **confirmado**; o app
   não junta contas por conta própria.

Não é preciso mudar variáveis de ambiente nem o `vercel.json`.

### 5.4 Como testar
1. **Criar conta → Continuar com Google** com uma conta nova → cai em "Concluir cadastro" com nome e e-mail
   do Google → tente concluir sem aceitar os termos (bloqueia) → digite o WhatsApp, espere "Rascunho salvo",
   feche a aba → abra `/projetos.html` direto: volta para "Concluir cadastro" com o WhatsApp salvo →
   aceite e conclua → abre a plataforma.
2. **Entrar → Continuar com Google** com essa mesma conta → vai direto para o início (sem perfil duplicado:
   `select email, count(*) from profiles group by 1 having count(*) > 1;` deve voltar vazio).
3. Clique em Continuar com Google e **cancele** na tela do Google → volta ao login com aviso.
4. Entre com **e-mail e senha** numa conta antiga → entra normalmente.
5. Entre como **admin** → abre o painel de gestão (menu de admin, sem as telas de compra).

## 6. Orçamento detalhado do MVP (R$ 30), mentores e mvp.cmkcogit.com.br

Este repositório é dono do **schema**, do **pagamento** e da **geração** do orçamento. O mvp.cmkcogit.com.br (outro
repositório) só tem telas: lê o banco direto com a sessão do usuário (o RLS decide) e chama as rotas daqui.

```
Jornada (grátis) ──> resumo do orçamento (Groq, valor calculado no servidor) ──> "Gerar documento por R$ 30"
   POST /api/mvp acao=pedir ──> mvp_budget_orders (pending_payment) + pagamentos + Mercado Pago (Pix/cartão)
   webhook assinado ──> aplicar_pagamento_mp confere valor/moeda na API do MP ──> pedido "paid" (idempotente)
   POST /api/mvp acao=gerar (tela de espera; rotina diária como reserva) ──> reserva atômica ──> Claude (JSON por schema)
      ──> validação ──> PDF (identidade COGIT) ──> Storage privado "orcamentos-mvp" ──> "ready" ──> URL assinada (10 min)
      falhou: nova tentativa automática até max_tentativas; depois "failed": o cliente libera 1 nova tentativa,
      o admin reprocessa ou estorna (POST /v1/payments/{id}/refunds, com chave de idempotência)
"Construir com a CMK Cogit" ──> app.cmkcogit.com.br/projeto/{id} ──> solicitação (origem jornada_mvp) pelo ID salvo
   contratou em até credit_valid_days: o checkout abate o valor do orçamento (crédito consumido só no pagamento)
```

### 6.1 Rotas (todas com CORS para `MVP_ORIGENS`; login pelo cabeçalho `Authorization: Bearer`)

| Rota | O que faz |
|---|---|
| `GET /api/jornada` · `?id=` | projetos do cliente / um projeto (dono, admin ou mentor com compartilhamento) |
| `POST /api/jornada` | `iniciar`, `salvar`, `enviar`, `avaliar` (só o mentor do projeto), `gerar_orcamento` (resumo grátis) |
| `GET /api/mvp?acao=config` · `status&projeto_id=` · `pdf&pedido_id=` | preço; último pedido + crédito; link do PDF (só o dono ou admin) |
| `POST /api/mvp` `{acao}` | `pedir`, `gerar`, `tentar_novamente`, `construir`; admin: `admin_reprocessar`, `admin_estornar` (`GET admin_pedidos`) |
| `POST /api/sso` `{para, volta}` | login único: código de uso único para o outro site (`lib/sso.js`) |
| `POST /api/mp-webhook` | Mercado Pago. Com `MP_WEBHOOK_SECRET`, aviso sem assinatura válida é recusado (401) |

`/api/jornada` e `/api/mvp` são reescritas (vercel.json) para `/api/notificacoes?rota=...`: o plano Hobby aceita 12 funções.
A função tem `maxDuration` de 300 s (precisa do **Fluid compute**, padrão em projetos novos da Vercel; sem ele o Hobby para em 60 s).

### 6.2 Banco (sql/31) e permissões

- `profiles.role` continua `cliente` | `admin`. **Mentor é uma permissão adicional** em `user_roles` (`is_mentor()`): o
  mentor continua cliente e pode comprar. O cadastro sempre cria cliente; ninguém se dá a permissão.
- "Quero ser mentor" existe só no mvp (`pedir_mentoria`). O admin aprova na tela **Mentores** (`admin_decidir_mentoria`).
- O dono compartilha um projeto com um mentor pelo e-mail (`compartilhar_projeto`, consentimento LGPD) e revoga quando quiser.
  O mentor lê projeto, módulos, resumo e comentários **só** com compartilhamento e permissão ativa; nunca o pedido nem o PDF.
- Preço, cotação US$→R$, teto de tokens, validade do crédito e tentativas: tabela `mvp_pricing_config` (uma linha; o admin
  muda pelo SQL Editor ou pelo painel). `update mvp_pricing_config set price_brl = 35 where id = 1;`
- Custo real de cada chamada de IA (tokens do campo `usage`, inclusive das que falharam e do resumo grátis):
  `mvp_budget_generations`. Margem: `select * from admin_mvp_margem();` (ou a view `vw_mvp_margem`, só service_role).

### 6.3 IA

- **Groq** continua nas etapas baratas (resumo grátis, mensagens, assistente).
- **Claude** (`lib/claude.js`, SDK oficial, chave só no servidor) gera o documento: saída em JSON validada pelo schema de
  `lib/mvp-documento.js` e de novo no servidor; `max_tokens` = `mvp_pricing_config.max_output_tokens`; cache do prompt de
  sistema; `fallbacks: "default"` (se o modelo recusar por segurança, a API tenta outro modelo, e o custo é gravado por modelo).
  Modelo, esforço e preços vêm do ambiente (`CLAUDE_*`). A IA nunca define preço: escopo, valor e prazo são os do resumo.

### 6.4 Login único, captcha e Supabase

1. **Login único sem cookie compartilhado.** Cada site guarda a sessão só no próprio endereço; nenhum outro subdomínio
   (por exemplo um site de cliente em `xxx.cmkcogit.com.br`) recebe ou lê a sessão. Quem abre um site sem estar logado
   passa, sem digitar nada, pelo `sso.html` do outro: se lá estiver logado, o servidor do app (`/api/sso`, `lib/sso.js`)
   gera um código de uso único (link mágico do Supabase, sem e-mail) que volta no fragmento `#` e vira uma sessão
   própria; se não estiver, a pessoa volta para a tela de login normal (`?sso=0`). Destinos só do ambiente
   (`APP_URL`, `MVP_URL`). "Sair" vale para o site onde a pessoa clicou (e ela não entra sozinha de novo até um login
   manual); "Sair de todos os dispositivos" encerra todas as sessões. Em Supabase > Authentication > Email, deixe
   **Email OTP Expiration** curto (ex.: 600 s): é a validade do código (também vale para os links de e-mail).
2. **Supabase > Authentication > URL Configuration > Redirect URLs:** acrescente `https://mvp.cmkcogit.com.br/**` (e
   `http://localhost:3001/**` para o mvp no computador). Os e-mails de confirmação e senha voltam para o site de onde a
   pessoa veio.
3. **Captcha:** crie um widget no Cloudflare Turnstile para `app.cmkcogit.com.br` e `mvp.cmkcogit.com.br`; cole a chave
   secreta em Supabase > Authentication > Attack Protection > Captcha (Turnstile) e a chave pública em `TURNSTILE_SITE_KEY`
   (app e mvp). **Publique o app e o mvp com a chave antes de ligar o captcha no Supabase**: ligado, o Supabase exige o
   token em todo cadastro, login por senha e recuperação de senha (o login com Google não muda).
4. **Rate limit do cadastro:** o cadastro vai direto ao Supabase Auth, então o limite é o dele: Authentication > Rate
   Limits (ex.: 30 cadastros/hora por IP) + o captcha. As ações pagas e de IA têm limite por usuário no banco
   (`consumir_limite`, valores em `lib/limite.js`).
5. **Mercado Pago:** nada muda (mesmo webhook). Garanta `MP_WEBHOOK_SECRET` na Vercel.

### 6.5 Testes

- `npm test`: inclui `tests/mvp.test.js` (pedir, webhook assinado/sem assinatura/repetido, geração, custo, PDF, falhas e
  tentativas, estorno, construir e crédito, CORS) e `tests/jornada.test.js` (mentor revisa, vários projetos, CORS, limite).
- `npm run test:sql`: aplica **todos** os `sql/` num Postgres local com uma imitação mínima do Supabase
  (`tests/sql/supabase-stub.sql`) e roda `tests/sql/*.test.sql` (RLS do mentor: **sem compartilhamento = sem acesso**,
  pedidos, crédito, estorno, transições da geração). Precisa de um Postgres local:
  `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:sql` (nunca o do Supabase).

### 6.6 Variáveis novas

`ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_EFFORT`, `CLAUDE_TIMEOUT_MS`, `CLAUDE_PRECO_ENTRADA`, `CLAUDE_PRECO_SAIDA`,
`CLAUDE_PRECO_CACHE_LEITURA`, `CLAUDE_PRECO_CACHE_ESCRITA`, `CLAUDE_PRECOS_JSON`, `GROQ_PRECO_ENTRADA`, `GROQ_PRECO_SAIDA`,
`USD_BRL`, `MVP_ORIGENS`, `MVP_URL` (login único; no computador `http://localhost:3001`), `TURNSTILE_SITE_KEY` (veja `.env.example`).

## Segurança — o que já está garantido

- O valor cobrado vem sempre do banco (`catalogo_precos` / valor definido pelo admin); preço enviado pelo navegador é ignorado.
- Confirmação só depois de consultar o pagamento na API do Mercado Pago, conferindo cobrança (`external_reference`), valor e moeda. Valor diferente não libera nada e fica registrado.
- Webhook com assinatura `x-signature` obrigatória quando `MP_WEBHOOK_SECRET` está configurado; avisos repetidos não duplicam nada.
- Orçamento detalhado: só é gerado com o pedido pago no banco (`paid_at`, gravado por `aplicar_pagamento_mp`); reserva atômica
  evita gerar duas vezes; PDF em bucket privado, entregue por URL assinada de 10 minutos depois de conferir o dono.
- RLS: cada cliente só vê o que é dele; cliente não cria/altera cobranças nem projetos; ninguém vira admin pelo cadastro (nem pelo Google).
- Cadastro concluído só pelo banco (`concluir_cadastro`); o cliente só consegue alterar nome e telefone do próprio perfil.
- A `service_role` e o token do Mercado Pago ficam só no servidor; `/config.js` entrega apenas a chave pública (anon).
- Uma cobrança pendente por solicitação; dois cliques em "Pagar" reaproveitam o mesmo link.

## Observações

- O `Content-Security-Policy` do `vercel.json` libera `*.supabase.co`. Se usar domínio próprio no Supabase, acrescente-o em `connect-src`.
- O supabase-js é carregado do jsDelivr com versão fixa (`2.45.4`).
