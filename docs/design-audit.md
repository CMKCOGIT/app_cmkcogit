# Auditoria de identidade e interface — CMKCOGIT

Data: 30/10/2026 · Branch: `redesign/visual` (nos dois repositórios)
Escopo: site institucional (`CMKCOGIT/CMK-Cogit`, cmkcogit.com.br) e Plataforma do Cliente / Painel de Gestão
(`CMKCOGIT/app_cmkcogit`, app.cmkcogit.com.br). Os três sites de `templates/` são produtos vendidos a clientes
(modelos prontos) e ficam **fora** deste redesign.

Fonte: só o código dos repositórios. O site em produção não pôde ser aberto desta sessão (o proxy de rede recusa
`cmkcogit.com.br` e `app.cmkcogit.com.br`), então nada aqui vem de inspeção da produção.

---

## 1. Marca

| Grafia | Ocorrências (site) | Onde |
|---|---|---|
| `COGIT` | 227 | títulos de página (`... \| COGIT`), textos corridos |
| `CMKCOGIT` | 105 | logo, domínio, `og:site_name`, JSON-LD `Organization.name` |
| `CMK COGIT` | 58 | textos alternativos do logo, painel (menu, comprovante) |
| `Cogit` | 35 | nomes de arquivo/produto (`cogit-start`), alguns textos |
| `SMK Cogit` | 0 | não existe em nenhum dos dois repositórios |

**Decisão (confirmada pelo responsável em 30/10/2026):** `CMKCOGIT` é o nome oficial — títulos, meta, rodapé, textos
jurídicos, `alt` do logo, painel. `COGIT` continua aceito como nome curto no meio dos textos. `CMK COGIT` (com espaço)
deixa de ser usado.

## 2. Logo e favicon

| Arquivo | Formato | Uso | Observação |
|---|---|---|---|
| `assets/images/logo-white.png` | PNG 40 KB | logo horizontal para fundo escuro (cabeçalho, intro, rodapé, painel) | "CMK" branco + "COGIT" violeta. Não há versão para fundo claro nem SVG |
| `assets/images/cmk-symbol.png` | PNG 28 KB, 192 px de altura | símbolo "CMK" (favicon, menu móvel) | único favicon do site |
| `assets/images/cmk.png` | PNG 419 KB | original em alta | **não referenciado** em páginas |
| `assets/images/logo-white1.png` | PNG 54 KB | — | **não referenciado** |
| `assets/images/og-image.png` | PNG 387 KB | — | **não referenciado** (o OG atual é `og-cmkcogit-2026.png`, 148 KB) |
| painel `public/assets/images/favicon-64.png`, `apple-touch-icon.png` | PNG | favicon do painel | sem `site.webmanifest`, sem `.ico`/192/512 |

- Espaço de respeito / tamanho mínimo: não documentados. Na prática o logo horizontal é usado com 136–200 px de largura
  e o símbolo a partir de 32 px. Proposta: área de respiro = altura da letra "C"; mínimo 120 px (horizontal) e 24 px (símbolo).
- Faltam: `favicon.ico`, PNG 192/512, `apple-touch-icon` 180 no site, `site.webmanifest`, `theme-color` no site.
- `favicon.svg`: não há logo vetorial no projeto. **Não vetorizar à mão** (seria redesenhar a marca) — pendência:
  pedir o SVG original ao responsável pela identidade.

## 3. Paleta (tokens em `css/variables.css` do site, copiados no painel)

| Função | Token | Valor | Uso |
|---|---|---|---|
| Marca (destaque) | `--purple` | `#4A3DDB` | botões primários, "COGIT" do logo, links, foco |
| | `--purple-hover` | `#3D31C4` | hover/ativo |
| | `--purple-light` | `#5B4FE6` | degradês |
| | `--lilac` | `#A79BFF` | detalhes sobre fundo escuro, rótulos |
| Navy | `--ink` | `#0F1B33` | texto principal, menu lateral, faixas escuras |
| | `--ink-light` / `--ink-lighter` | `#1A2847` / `#243560` | superfícies escuras |
| Fundo / superfície | `--neutral` / `--neutral-dark` / `--white` | `#F4F5F8` / `#E8EAF0` / `#FFF` | fundo da página, divisórias, cards |
| Texto | `--text-secondary` / `--text-tertiary` | `#4A5568` / `#5F6B7F` | apoio (ambos passam AA sobre branco) |
| Estados (só no painel) | success / danger / warning / info | `#1E7A4C` / `#B42318` / `#8A5A00` / `#4A3DDB` | etiquetas, avisos |

Uso real: além dos tokens, o CSS do site tem **mais de 40 hexadecimais soltos** e **230 `rgba()` distintos**. Os mais
frequentes fora dos tokens: `#fafafc`, `#242329`, `#c6c3cf`, `#c4b5fd`, `#5b4bf0`, `#16133a` — variações de
violeta/grafite criadas por seção (cards "grafite" do configurador, diagnóstico). `#5b4bf0`, `#5b4ae3`, `#6d5df5`,
`#4034c4`, `#3a2fad` são quase o mesmo violeta: **inconsistência a consolidar numa escala `--color-brand-50…900`**.
Não há estados (sucesso/erro/aviso) tokenizados no site.

## 4. Tipografia

- **Inter** (títulos, 400–800) e **Manrope** (corpo, 400–700), locais em WOFF2 com subconjunto latino, `font-display: swap`
  (`css/fonts.css`). O painel usa as mesmas famílias, mas em **TTF** (mais pesado) — trocar pelos WOFF2 do site.
- Escala fluida já existe (`--text-xs … --text-7xl`, `--fs-hero`, `--fs-section`, `--fs-card` com `clamp`).
- São 9 arquivos de fonte (5 pesos de Inter + 4 de Manrope). Os pesos 400 de Inter e 500 de Manrope quase não
  aparecem — candidatos a corte.
- Não há `preload` da fonte principal.

## 5. Componentes existentes

| Componente | Site | Painel |
|---|---|---|
| Botões | `.btn`, `.btn-primary`, `.btn-secondary(-dark)`, `-sm/-lg` | estilo por elemento (`button`, `[data-primario]`, `[data-perigo]`) |
| Campos | formulários de contato/configurador | `input/select/textarea` globais |
| Cards | serviços, soluções, preços, depoimentos, cases | seções, clientes, solicitações |
| Badges/pílulas | pontuais | `[data-etiqueta=ok/atencao/perigo/info/neutro]` |
| Tabelas | poucas | eventos MP, clientes (viram cards no celular) |
| Modal | diálogo de modelos, consentimento de cookies | `<dialog>` de cliente e de validação |
| Menu | cabeçalho fixo que compacta, menu móvel em tela cheia | menu lateral fixo (vira barra no celular) |
| Toast | — | `[data-toasts]` |
| Acordeão | FAQ | `<details>` |
| Skeleton | — | `[data-esqueleto]` com brilho |

## 6. Ícones e bibliotecas

- Site: **Bootstrap Icons 1.11.3**, subconjunto local (fonte de 1,6 KB com 18 ícones). Correto e leve.
- Painel: **não usa biblioteca de ícones** — usa SVG em data URI (busca, seta, check, alerta, exportar) e caracteres
  (`×`, `✓`, `▲`, `▼`, `!`, `⚠`). Precisa migrar para Bootstrap Icons.
- Emojis: nenhum nos dois repositórios (fora de `templates/`).
- Bibliotecas: nenhuma de UI. Painel usa `@supabase/supabase-js@2.45.4` (CDN jsDelivr). Sem jQuery, sem frameworks.

## 7. Problemas encontrados

### Desempenho (o ponto fraco)
Lighthouse mobile (4G simulada), servidor local sem compressão — ver `docs/performance-report.md`:

| Página | Perf | A11y | BP | SEO | LCP | CLS |
|---|---|---|---|---|---|---|
| Home | 66 | 100 | 100 | 100 | 5,8 s | 0,153 |
| Monte sua solução | 53 | 100 | 100 | 100 | 5,9 s | 0,49 |
| Soluções | 89 | 100 | 100 | 100 | 3,0 s | 0,001 |
| Contato | 74 | 100 | 100 | 100 | 5,8 s | 0 |
| Painel — login | 66 | 100 | 96 | 50* | 9,8 s | 0,17 |

\* `noindex` proposital (área privada).

1. **CSS em cascata de `@import`**: `style.css` importa 13 arquivos em sequência — 14 requisições bloqueantes,
   ~1,5 s de espera antes da primeira pintura. Toda página baixa ~340 KB de CSS (150–200 KB sem uso).
2. **JS igual em todas as páginas**: `components.js` (131 KB) e `configurator.js` (43 KB) carregam até onde não há
   configurador; scripts no fim do `body` sem `defer`. ~113 KB de JS sem uso por página.
3. **Abertura da marca (`#brand-intro`)** segura a primeira pintura do conteúdo (atraso de renderização do LCP 1,3 s)
   e gera pequenos deslocamentos.
4. **CLS**: em "Monte sua solução" o rodapé é empurrado quando o configurador é montado por JS (0,49); na home um
   container do hero se desloca (0,14). Painel: o menu é injetado por JS depois da pintura (0,17).
5. Imagens PNG sem WebP/AVIF; três arquivos grandes não usados no repositório.

### Consistência e estados
6. Três grafias da marca (ver §1).
7. Violetas quase iguais espalhados (ver §3); 230 `rgba()` distintos.
8. Painel com ícones improvisados (SVG soltos e caracteres) e sem estados vazios com ícone.
9. Botões do painel estilizados por atributo/ID, sem classes de componente reutilizáveis.
10. Sem favicon completo nem `site.webmanifest` no site.

### O que já está bom (preservar)
- Acessibilidade 100 nas páginas medidas: link "Pular para o conteúdo", foco visível, contraste AA documentado.
- `html.js` antes da pintura (nada fica invisível sem JS) e `prefers-reduced-motion` respeitado nas animações.
- Fontes e ícones locais, sem chamadas a Google Fonts.
- Revelação por `IntersectionObserver` (`js/animations.js`) e cabeçalho que compacta ao rolar.
- Verificações automatizadas (`node tools/check.mjs`, 22 testes) e testes do painel (`npm test`, 39 testes).

## 8. Prioridades do redesign (derivadas desta auditoria)

1. Tokens unificados (escala da marca, navy, neutros, estados, motion) servindo os dois projetos.
2. CSS empacotado por página (sem `@import`), JS com `defer` e carregado só onde é usado.
3. Remover o atraso da abertura da marca no LCP e reservar espaço dos blocos montados por JS (CLS).
4. Marca padronizada; favicon completo e manifest.
5. Painel com Bootstrap Icons, menu recolhível, cabeçalhos de página e estados vazios.
6. Medir de novo e registrar em `docs/performance-report.md`.

---

# Parte 2 — Reestruturação da plataforma (branch `redesign/plataforma`)

Auditoria feita antes de mexer no layout da área do cliente e do painel de gestão. Parte da branch `redesign/visual` (tokens, ícones, fontes WOFF2 e favicon já prontos).

## Stack e estrutura

- HTML estático + CSS + JavaScript puro, sem build. Supabase (auth, banco com RLS, Realtime) via CDN `supabase-js@2.45.4`; funções `/api/*` na Vercel; Mercado Pago no checkout.
- CSP: `script-src 'self' https://cdn.jsdelivr.net` (nada de script inline nem `onclick`), `style-src 'unsafe-inline'`.
- Um arquivo de página + um `js/<página>.js` por tela. `js/app.js` é a base comum (sessão, `protegerPagina()`, `montarMenu()`, sino, `toast()`, `ocupado()`, formatação `brl()`/`fmtData()`).
- CSS: `css/tokens.css` (igual ao site) + `css/plataforma.css` (≈2.800 linhas, seletores semânticos: `main > section` vira card, `#resumo` vira grade de números etc.).

## Telas

| Área | Página | Script | Observação |
|---|---|---|---|
| Cliente | `inicio.html` | `inicio.js` | resumo (5 números), atualizações, próximo passo (no fim), dicas, suporte |
| Cliente | `continuar.html` (Minhas solicitações) | `continuar.js` | cards com itens e botão "Remover" por item |
| Cliente | `pagamentos.html` | `pagamentos.js` | resumo + tabela + Mercado Pago |
| Cliente | `projetos.html` / `projeto.html` | `projetos.js` / `projeto.js` | cards de projeto; detalhe com etapas, pendências, repositório, extras, pagamentos (e painel admin) |
| Cliente | `funcionalidades.html` | `funcionalidades.js` | catálogo por projeto, compra individual |
| Ambos | `perfil.html` | `perfil.js` | dados, e-mail, senha, sair de todos |
| Admin | `admin-inicio.html` | `admin-inicio.js` | KPIs, gráfico SVG, o que vendemos, top clientes, atividades, filtro de período |
| Admin | `admin.html` (Solicitações) | `admin.js` | filtro por `<select>`, cards, modal de validação, eventos do Mercado Pago |
| Admin | `admin-clientes.html` | `admin-clientes.js` | busca, filtros rápidos, cards/tabela, detalhe em `<dialog>` |
| Público | `login`, `redefinir-senha`, `completar-cadastro`, `comprovante`, `index`, `404` | — | fora do shell; só ajustes de token |

## Problemas de layout confirmados

1. `body.app` é uma grade `272px | 1fr`, mas `main` tem `max-width: 1080px` sem `margin: auto`: a coluna de conteúdo para em 1.144 px e fica colada à esquerda: em 1920 px sobram ~500 px vazios à direita; em 2560 px, ~1.140 px.
2. Uma coluna só: resumo, atualizações e próximo passo com o mesmo peso; "Próximo passo" é a terceira seção do Início.
3. Abaixo de 1024 px o menu vira faixa com rolagem horizontal no topo; não há navegação inferior nem atalho de ação no celular.
4. Sino de notificações dentro do menu; não há barra superior, busca nem menu do usuário.
5. Filtros de Solicitações em `<select>`; sem busca por código/cliente.
6. Raios de 8–16 px nos cards (a referência pede 20–24 px).

## Reaproveitado × substituído

| Reaproveitado | Substituído / novo |
|---|---|
| tokens de cor, fontes, ícones (sprite Bootstrap Icons), `toast`, `ocupado`, sino (lógica), modal de validação, `dialog` de clientes, todos os IDs usados pelos scripts e testes | menu lateral (agora flutuante, com grupos, cartão de destaque e utilidades), barra superior nova (busca, sino, avatar), menu inferior com FAB e folha "Mais", grade de 12 colunas com painel lateral, cabeçalho de página com ação principal, cards de KPI com destaque, filtros em pílula |

Ícones novos no sprite (mesma biblioteca): ajuda, mais, abrir-menu, relógio, teclado, configurações, período, enviado, cancelado, ok, mensagem, recibo; `solicitacoes` passou a `inboxes`, `projetos` a `kanban`, `adquirir` a `puzzle` (mapa sugerido no briefing). O gerador do sprite agora também existe aqui: `node tools/build-icons.mjs <pasta icons do pacote>`.

Raios da plataforma: o briefing pede sm 10 · md 14 · lg 20 · xl 24. `tokens.css` continua idêntico ao do site (que usa a escala menor); a plataforma redefine `--radius-*` em `plataforma.css`, só para as páginas dela.
