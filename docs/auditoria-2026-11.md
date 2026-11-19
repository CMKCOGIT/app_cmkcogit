# Auditoria da plataforma — novembro de 2026

Documentos desta auditoria:
- **Fase 1 — diagnóstico:** este arquivo (seção 1).
- **Fase 2 — proposta do novo admin:** [`admin-proposta.md`](admin-proposta.md) (aguarda aprovação).
- **Fase 3 — segurança implementada:** [`seguranca-fase3.md`](seguranca-fase3.md).
- **Fase 4 — backlog de sugestões:** seção 2.
- **Checklist de teste manual (QA):** seção 3.

## 1. Fase 1 — problemas encontrados

Status: ✅ corrigido nesta entrega · 🅿 proposto na Fase 2 · ⏳ em aberto (backlog).

| # | Grav. | Onde | Problema | Status |
|---|---|---|---|---|
| C1 | Crítica | checkout / cancelar / ajustes / reenviar / tirar item | Link do Mercado Pago continuava pagável depois de cancelar ou mudar o valor: dinheiro entrava sem liberar projeto e sem aviso | ✅ link vence em 72 h e é encerrado no MP; alerta ao admin |
| A1 | Alta | RLS `pagamentos`/`solicitacoes` | Admin conseguia marcar pagamento como pago pela API (há 1 registro "pago" sem id do MP em produção) | ✅ gatilhos no `sql/33` (revisar o registro com `sql/auditar_dados.sql`) |
| A2 | Alta | `aplicar_pagamento_mp` | Duplicidade / valor divergente só no log | ✅ alerta; estorno pela tela de Exceções 🅿 |
| A3 | Alta | `continuar.js`, `login.html` | "Preço fechado: é só pagar" — todo pedido passa pela análise | ✅ |
| A4 | Alta | etapas / prazos | Tipos de entrega não modelados (estruturação do sob medida, aprovação do cliente, rodadas de ajuste); sem suporte de 30 dias | 🅿 |
| A5 | Alta | APIs | Sem rate limit em checkout/verificação/admin | ✅ |
| A6 | Alta | sessão admin | Sem expiração por inatividade, sem MFA | ✅ inatividade · ⏳ MFA |
| M1 | Média | `app.js` (pedido pendente) | Um só pedido por navegador; pedido de outra pessoa no mesmo navegador; `#cfg` inválido sem aviso | ⏳ |
| M2 | Média | admin | Duas telas de aprovação; % × etapas | 🅿 |
| M3 | Média | webhook | Aviso sem assinatura aceito | ✅ |
| M4 | Média | listas do admin | Limite de 100, busca só local, tabela inteira baixada | 🅿 |
| M5 | Média | senha | Troca não encerrava outras sessões; redefinir sem senha atual estando logado | ✅ |
| M6 | Média | cobranças | Pendentes eternas | ✅ link vence em 72 h · ⏳ limpeza de cobranças antigas |
| M7 | Média | banco × repo | Objetos só no banco | ✅ parcial (`rate_limits`, RPC antiga) · ⏳ exportar o restante |
| M8 | Média | advisors | search_path, funções expostas, senha vazada | ✅ (senha vazada = painel) |
| M9 | Média | UX | `prompt`/`confirm` | 🅿 |
| B* | Baixa | vários | erros técnicos na tela, estimativa do site, console, CSP localhost, `.env.example` ausente | ✅ parcial |

## 2. Fase 4 — backlog de sugestões (só lista; vocês decidem)

Esforço: P (≤1 dia) · M (2–5 dias) · G (1–2 semanas). Prioridade: 1 = mais alta.

| # | Sugestão | Problema que resolve | Esforço | Prior. |
|---|---|---|---|---|
| 1 | Etapas por tipo de entrega + estruturação do sob medida + aprovação do cliente com botão | Regras de negócio que hoje não existem no sistema | G | 1 |
| 2 | Suporte de 30 dias a partir de "concluído" (data, contador para cliente e admin, aviso 7 dias antes) | Regra comercial sem tela; evita suporte fora do prazo ou esquecido | M | 1 |
| 3 | Tela "Agora" + ficha única do pedido/projeto (Fase 2) | Admin confuso, ações espalhadas | G | 1 |
| 4 | Aba Exceções em Pagamentos com estorno pela API do MP | Fechar o ciclo dos alertas de pagamento | M | 1 |
| 5 | E-mail por mudança de status (recebido, aprovado/pagamento liberado, pago, etapa, aprovação pedida, concluído, fim do suporte) — Resend já configurado | Cliente só vê o sino quando entra | M | 2 |
| 6 | MFA (TOTP) obrigatório para admin | Conta de admin é o alvo mais valioso | M | 2 |
| 7 | Registro de rodadas de ajuste (o que foi pedido, dentro/fora do contratado) | Regra "ajustes só do contratado" sem histórico | M | 2 |
| 8 | Fila de pedidos pendentes no navegador (vários pedidos, por conta) + aviso de link inválido | Pedido perdido/duplicado vindo do simulador | P | 2 |
| 9 | WhatsApp automático por status (API oficial do WhatsApp Business) | Hoje o envio é manual (wa.me) | G | 3 |
| 10 | Comentários no projeto por etapa (cliente ↔ equipe), ligados às Mensagens | Contexto da conversa separado do projeto | M | 3 |
| 11 | Área de arquivos com pastas (entregas, documentos, notas) e versões | Repositório atual é lista única | M | 3 |
| 12 | Histórico de pagamentos com recibo/nota fiscal (integração com emissor de NFS-e) | Cliente pede comprovante fiscal | G | 3 |
| 13 | Métricas no admin: tempo médio em cada fase, conversão pedido→pago, atraso por tipo, NPS na conclusão | Gestão sem indicadores de operação | M | 3 |
| 14 | CAPTCHA (Turnstile) no cadastro e na recuperação de senha | Robôs de cadastro/e-mail | P | 2 |
| 15 | Ambiente de testes (branch do Supabase + preview da Vercel + credenciais de teste do MP) e testes E2E com Playwright | Hoje só dá para testar telas logadas em produção | M | 1 |
| 16 | Exportar para o repositório as tabelas/funções que só existem no banco (Jornada MVP/mentoria) | Recriar o ambiente do zero | P | 2 |
| 17 | Limpeza automática de cobranças pendentes vencidas e de pedidos abandonados (com aviso ao cliente) | Lixo nas listas | P | 3 |

## 3. Checklist de teste manual (QA)

Use as credenciais de **teste** do Mercado Pago (README §2). Marque cada item em mobile (375 px), tablet (768 px) e desktop.

### Chegada do simulador
- [ ] Usuário novo: monta no site → "Continuar na plataforma" → tela de cadastro mostra a solução salva e o texto "a equipe da CMK analisa e libera o pagamento".
- [ ] Cadastro com confirmação de e-mail no **mesmo navegador** → pedido aparece em "Minhas solicitações" como "Aguardando análise da CMK", sem botão Pagar.
- [ ] Usuário já cadastrado: login → pedido salvo na conta.
- [ ] Recarregar a página depois de salvar → não duplica ("já estava salva").
- [ ] Link direto `continuar.html` sem `#cfg`, sem login → vai para o login; logado → lista vazia com "Monte sua solução".
- [ ] Sessão expirada no meio → volta ao login e, ao entrar, o pedido pendente continua.
- [ ] Admin abrindo o link do simulador → vai para o painel do admin, pedido não é criado.

### Cadastro, login e senha
- [ ] Campos obrigatórios, e-mail inválido, senha < 8, senhas diferentes, termos não aceitos → mensagens claras.
- [ ] E-mail já cadastrado → "Use Entrar".
- [ ] Senha errada → "E-mail ou senha incorretos". Muitas tentativas → mensagem de aguardar.
- [ ] Esqueci minha senha → e-mail → link abre `redefinir-senha.html` → troca → outras sessões saem.
- [ ] Link de recuperação usado/vencido → mensagem com "peça um novo".
- [ ] Logado, abrir `redefinir-senha.html` direto → manda para "Meu perfil".
- [ ] Google: novo usuário cai em "Concluir cadastro"; cancelar no Google volta com aviso.
- [ ] Meu perfil → trocar senha (com a atual) → outro navegador logado cai no login.
- [ ] "Sair de todos os dispositivos" funciona.

### Análise e aprovação (admin + cliente)
- [ ] Admin: Iniciar análise → cliente vê "Em análise" e recebe aviso.
- [ ] Admin: Pedir ajustes → cliente vê a mensagem, edita e reenvia → volta para "Aguardando análise".
- [ ] Admin aprova sem mudar itens → "Aprovado — aguardando pagamento", botão Pagar aparece para o cliente.
- [ ] Admin aprova mudando itens → cliente vê a proposta, aprova (libera pagamento) ou pede revisão.
- [ ] Cliente e admin mostram o mesmo status, valor e itens em cada etapa.

### Pagamento
- [ ] Pagar (cartão `APRO`) → volta para Pagamentos → "Pago" → projeto criado em "Meus projetos"; admin vê o projeto e o pagamento.
- [ ] Cartão `OTHE` (recusado) → continua pendente, mensagem de recusa, pode tentar de novo.
- [ ] Cartão `CONT` (pendente) / Pix não pago → "aguardando pagamento"; nada é liberado.
- [ ] Clicar "Pagar" duas vezes → mesmo link.
- [ ] Fechar a aba no meio do pagamento e voltar → "Já paguei — verificar" confirma.
- [ ] Sem webhook (local) → confirmação pela volta/verificação.
- [ ] **Abrir o pagamento, cancelar o pedido e tentar pagar o link antigo → link expirado/indisponível.**
- [ ] **Abrir o pagamento, admin muda o valor, pagar o link antigo → indisponível; novo "Pagar" usa o valor novo.**
- [ ] Se algum pagamento cair numa cobrança cancelada/valor diferente → cada admin recebe 1 alerta "Atenção: …".
- [ ] "Verificar" mais de 20 vezes em 5 min → "Muitas tentativas…".
- [ ] Admin no console: `db.from('pagamentos').update({status:'pago'})` → recusado (após `sql/33`).

### Pós-pagamento e conclusão
- [ ] Previsão de entrega coerente com o tipo (modelo pronto: até 7 dias úteis).
- [ ] Admin avança etapa / muda previsão / domínio / pendência / arquivo → cliente é avisado e vê igual.
- [ ] Admin conclui → cliente vê "Concluído" (e, quando o item 2 do backlog entrar, a data de fim do suporte).
- [ ] `admin_auditoria` registra as mudanças do admin.

### Sessão do admin
- [ ] 30 min sem uso → volta ao login com aviso de inatividade (também com duas abas abertas).
- [ ] Cliente não abre telas do admin; admin não abre telas de compra.

### Layout e estados
- [ ] Sem rolagem horizontal em 375/768/1366 px em todas as telas.
- [ ] Carregando (esqueleto), vazio e erro aparecem em listas e painéis.
- [ ] Console sem erros; nenhuma requisição repetida em loop (aba Rede).
