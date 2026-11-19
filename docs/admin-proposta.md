# Fase 2 — Proposta do novo admin (para aprovação, ainda NÃO implementada)

## 1. Tarefas reais do admin quando um cliente chega

| # | Momento | O que o admin precisa fazer | Onde faz hoje | Dor atual |
|---|---|---|---|---|
| 1 | Novo pedido chega | Ver o que o cliente montou, assumir a análise | `admin.html` (modal) **ou** `admin-solicitacao.html` | Duas telas com ações diferentes para o mesmo pedido |
| 2 | Analisar | Conferir itens/personalização, ajustar itens e valor | Modal de validação (4 passos) | Modal muito denso; personalização só na outra tela |
| 3 | Pedir ajustes ao cliente | Escrever o que mudar | `admin-solicitacao.html` | Não aparece no modal |
| 4 | Aprovar e liberar pagamento | Definir valor final + mensagem, enviar link | As duas telas | Fácil aprovar no lugar errado |
| 5 | Pagamento confirmado | Saber que pagou e iniciar o projeto | Sino + "Clientes" | Nenhuma fila "pagos aguardando início" |
| 6 | Pagamento com problema | Estornar / liberar à mão (valor divergente, pago após cancelamento, duplicado) | Tabela de avisos do MP no fim de `admin.html` | Não havia alerta (agora há, Fase 3) |
| 7 | Sob medida: estruturação (1–3 dias) | Enviar a estruturação e pedir aprovação | Não existe | Fase inexistente no sistema |
| 8 | Andamento do projeto | Avançar etapa, previsão, domínio, pendências, arquivos | `projeto.html` (etapas) **e** `admin-clientes.html` (%) | % e etapas podem se contradizer |
| 9 | Pedir aprovação da entrega | Mandar para "Sua aprovação" | Etapa 5 sem ação do cliente | Cliente não tem botão de aprovar |
| 10 | Registrar ajuste | Anotar o que o cliente pediu (dentro do contratado) | Não existe | Sem histórico de rodadas de ajuste |
| 11 | Concluir | Marcar concluído | `admin-clientes.html` (100%) | Não inicia o suporte |
| 12 | Suporte (30 dias) | Ver quem está no suporte e quando acaba | Não existe | Regra de negócio sem tela |

## 2. Arquitetura de informação

```
Menu lateral (admin)
├─ Agora            ← tela inicial: só o que exige ação
├─ Pedidos          ← antes do pagamento (solicitações)
├─ Projetos         ← depois do pagamento (inclui suporte)
├─ Pagamentos       ← cobranças + exceções do Mercado Pago
├─ Clientes         ← cadastro e histórico do cliente
├─ Mensagens
├─ Quadros
└─ Relatórios       ← o painel de faturamento atual (sai da tela inicial)
```

Um pedido e o projeto que nasce dele são **a mesma ficha** (`/admin-pedido.html?id=`), com abas
*Resumo · Itens e valor · Personalização · Projeto · Pagamentos · Histórico*. O modal de
`admin.html` e a página `admin-solicitacao.html` deixam de existir separados.

## 3. Telas

### 3.1 Agora (tela inicial)
```
┌──────────────────────────────────────────────────────────────────────┐
│ Bom dia, Ana · 4 coisas precisam de você                              │
├──────────────────────────────────────────────────────────────────────┤
│ ⚠ Pagamentos com problema (1)        [Ver]  ← exceções do MP, vermelho │
│ ● Pedidos novos para analisar (3)    [Analisar o mais antigo]         │
│ ● Cliente respondeu (1)              reenviou / aprovou / pediu revisão│
│ ● Pagos aguardando início (2)        [Iniciar projeto]                │
│ ● Aguardando aprovação do cliente há +3 dias (1)   [Lembrar cliente]  │
│ ● Projetos atrasados (1) · vencem em 7 dias (2)                       │
│ ● Suporte terminando em 7 dias (1)                                    │
├──────────────────────────────────────────────────────────────────────┤
│ Hoje: R$ 1.500 recebidos · 2 pedidos · 1 concluído   [Relatórios →]   │
└──────────────────────────────────────────────────────────────────────┘
```
Cada linha é um contador clicável que abre a lista já filtrada. Vazio: "Tudo em dia ✓".

### 3.2 Pedidos (lista)
- Abas por fase com contador: **Novos · Em análise · Com o cliente · Pagamento liberado · Pagos · Cancelados**.
- Busca **no servidor** por código, nome, e-mail, CPF/CNPJ (sem o limite de 100 itens).
- Filtros: tipo de entrega (modelo pronto / sob medida / plataforma), período, responsável.
- Colunas: código · cliente · tipo · valor · há quanto tempo está nesta fase · responsável · próxima ação.
- Paginação; ordenação padrão "mais antigo esperando primeiro".

### 3.3 Ficha do pedido/projeto
```
PLN-2026-0012 · Landing Page (modelo pronto) · Maria Souza        [Em análise]
Próxima ação: [ Aprovar e liberar pagamento ]  [ Pedir ajustes ]  [ ⋯ ]
──────────────────────────────────────────────────────────────────────────
Linha do tempo                                  │ Cliente
● Enviado 18/11 10:02 (cliente)                │ Maria · WhatsApp · e-mail
● Análise iniciada 18/11 14:20 (Ana)           │ CPF ***.456.789-**
○ Aprovado / pagamento liberado                 │
○ Pago                                          │ Valor
○ Em produção (etapas por tipo)                 │ Sugerido R$ 500
○ Aprovação do cliente · ajustes (n rodadas)    │ Final    R$ 500
○ Concluído → suporte até dd/mm                 │
──────────────────────────────────────────────────────────────────────────
[Resumo] [Itens e valor] [Personalização] [Projeto] [Pagamentos] [Histórico]
```
**Ações por status** (um botão primário, o resto em "⋯"):

| Status | Primária | Secundárias |
|---|---|---|
| Novo | Iniciar análise | Cancelar |
| Em análise | Aprovar e liberar pagamento | Pedir ajustes · Editar itens · Mensagem · Cancelar |
| Ajustes solicitados / Aguardando cliente | Lembrar cliente (WhatsApp) | Mensagem · Cancelar |
| Pagamento liberado | Reenviar link | Voltar para análise · Cancelar |
| Pago | Iniciar projeto | — |
| Sob medida em estruturação | Enviar estruturação para aprovação | Mensagem |
| Em produção | Avançar etapa | Previsão · Domínio · Pendência · Arquivo |
| Aprovação do cliente | Registrar ajuste | Lembrar cliente |
| Concluído (suporte) | Registrar atendimento de suporte | Reabrir |

**Etapas por tipo de entrega:**
- Modelo pronto (1–7 dias): Confirmado → Produção → Sua aprovação → Ajustes → Publicado.
- Sob medida: Confirmado → **Estruturação (1–3 dias)** → **Aprovação da estruturação** → Design → Construção → Sua aprovação → Ajustes → Publicado.
- Plataforma/e-commerce ("a partir de"): Validação do escopo e valor → mesmo fluxo do sob medida.

Andamento = etapas (a % passa a ser calculada, não digitada: acaba a contradição % × etapas).

### 3.4 Projetos, Pagamentos, Clientes
- **Projetos:** abas Em produção · Aguardando cliente · Em suporte (com "termina em") · Concluídos; filtro atrasados.
- **Pagamentos:** todas as cobranças, filtros por status/método/período, e a aba **Exceções**
  (valor divergente, pago após cancelamento, duplicado) com "Marcar como resolvido" + nota.
- **Clientes:** ficha com todos os pedidos/projetos/pagamentos e mensagens do cliente.

## 4. Confirmação, feedback e desfazer

| Ação | Confirmação | Feedback | Desfazer |
|---|---|---|---|
| Aprovar e liberar pagamento | Diálogo com valor + prévia do comprovante | Toast + linha do tempo | "Voltar para análise" (encerra o link no MP) |
| Pedir ajustes / mensagem | Prévia da mensagem | Toast "cliente avisado" | Mensagem nova (histórico não se apaga) |
| Editar itens / valor | Diferença destacada (antes → depois) | Valor recalculado ao vivo | Até aprovar: "descartar alterações" |
| Cancelar pedido | Diálogo com motivo obrigatório | Toast | 10 s de "Desfazer" no toast; depois, reabrir pela ficha |
| Avançar etapa | Sem diálogo | Toast | "Desfazer" no toast (volta a etapa) |
| Concluir projeto | Diálogo: "inicia 30 dias de suporte até dd/mm" | Toast | "Reabrir" na ficha |
| Resolver exceção de pagamento | Nota obrigatória | Toast | "Reabrir exceção" |

Substituir `window.prompt`/`confirm` por um diálogo próprio (acessível, funciona no celular).
Toda ação grava quem/quando (já existe em `solicitacao_eventos` e, agora, `admin_auditoria`).

## 5. Ordem sugerida de implementação
1. Ficha única do pedido/projeto (junta modal + `admin-solicitacao.html`).
2. Tela "Agora" com as filas.
3. Etapas por tipo de entrega + suporte de 30 dias (banco + cliente + admin).
4. Listas com busca/paginação no servidor; aba Exceções em Pagamentos.
