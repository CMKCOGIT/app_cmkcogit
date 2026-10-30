# Relatório de performance — redesign visual

Medição antes e depois do redesign (branch `redesign/visual`), site institucional e plataforma.

## Método

- Lighthouse 13.6.0, perfil **mobile** padrão (Moto G Power, 4G simulado, CPU 4×), Chromium headless.
- Servidor local **sem compressão** (gzip/brotli): o peso transferido aqui é maior que o da hospedagem real, então os tempos em produção tendem a ser iguais ou melhores.
- Primeira visita, sem cookies: o aviso de privacidade aparece em todas as medições (é o pior caso; da segunda visita em diante ele não é mostrado).
- Uma rodada por página. O Lighthouse varia alguns pontos entre rodadas (principalmente TBT); as diferenças abaixo são muito maiores que essa variação.

## Site institucional

| Página | Perf. antes | Perf. depois | LCP antes | LCP depois | CLS antes | CLS depois | A11y / BP / SEO depois |
|---|---|---|---|---|---|---|---|
| Home | 66 | **98** | 5,8 s | **1,8 s** | 0,153 | **0,023** | 100 / 100 / 100 |
| Monte sua solução | 53 | **96** | 5,9 s | **2,3 s** | 0,49 | **0** | 100 / 100 / 100 |
| Soluções | 89 | **98** | 3,0 s | **2,0 s** | 0,001 | **0** | 100 / 100 / 100 |
| Contato | 74 | **97** | 5,8 s | **2,1 s** | 0 | **0** | 100 / 100 / 100 |
| Sobre | — | **97** | — | **2,1 s** | — | **0** | 100 / 100 / 100 |
| Como trabalhamos | — | **98** | — | **1,8 s** | — | **0** | 100 / 100 / 100 |

Sobre e Como trabalhamos não estavam na medição inicial; na primeira medição intermediária do redesign marcavam 77 (LCP 5,7 s) e 69 (LCP 5,3 s, CLS 0,21), corrigidos como descrito abaixo.

Todas as metas do briefing foram atingidas no site: Performance ≥ 90, Acessibilidade ≥ 95, Boas práticas ≥ 95, SEO ≥ 95, LCP < 2,5 s, CLS < 0,1.

### O que mudou

| Causa encontrada | Correção |
|---|---|
| 20+ folhas CSS em cascata (cada uma uma requisição bloqueante) | Um único `css/site.min.css` gerado por `tools/build-css.mjs` (o `npm run check` falha se o bundle estiver desatualizado) |
| Fontes TTF sem preload; texto esperando a fonte | WOFF2 com `font-display: swap` e preload só dos dois pesos usados no primeiro quadro (Inter 800, Manrope 400) |
| Título do hero escondido (`opacity: 0`) até o JS rodar — o navegador não considera elemento invisível como LCP | Animação de entrada só com `transform`; o texto existe desde o primeiro quadro |
| Título da home quebrado em vários `span` de bloco (cada um competia como LCP) | Spans em linha com `<br>`; um único candidato a LCP |
| Introdução animada da marca em todas as navegações | Só na primeira página da visita (detectado por referrer/tipo de navegação, sem gravar nada no navegador) |
| Widgets montados por JS empurrando o conteúdo (diagnóstico da home, configurador, etapas da metodologia) | Altura reservada com `min-height` sob `html.js` (sem JS nada fica reservado nem escondido) |
| Parallax sobrescrevendo o `transform` que posiciona a camada de fundo (CLS 0,27) | Parallax usa a propriedade CSS `translate`, que se soma ao `transform` |
| Aviso de cookies com texto longo virando o maior elemento (LCP) nas páginas com hero curto | Texto do aviso encurtado; mesmos links para Política de Privacidade e Termos |

## Plataforma (login)

| Página | Perf. antes | Perf. depois | LCP antes | LCP depois | Peso antes | Peso depois |
|---|---|---|---|---|---|---|
| login.html | 66 | 82 | 9,8 s | 3,5 s | 1.549 KB | **364 KB** |

- Peso caiu 76% (fontes TTF → WOFF2, imagens não usadas removidas).
- **CLS 0,17 e LCP 3,5 s são artefato deste ambiente de teste**: a biblioteca do Supabase vem de `cdn.jsdelivr.net`, bloqueado no ambiente de medição; sem ela a plataforma mostra, de propósito, um aviso "Plataforma não configurada" acima do cartão de login, que empurra o cartão e vira o LCP. Com a biblioteca carregada (simulada no Playwright), o cartão não se move: CLS 0. A medição definitiva precisa ser feita no endereço publicado.
- SEO 50 é intencional: o login tem `noindex` (área logada não deve aparecer no Google).
- Boas práticas 96: erro de console do mesmo CDN bloqueado.

## O que ainda pesa (pendências)

- CSS não usado por página: o bundle único (~199 KB sem compressão) carrega estilos de todas as páginas. Com gzip fica em torno de 34 KB; dividir por página só compensa se o site crescer.
- `components.js` e `configurator.js` são carregados em todas as páginas, inclusive onde não há componente para montar.
- O aviso de cookies continua sendo candidato a LCP na primeira visita em páginas com hero muito curto; hoje ele é menor que o texto do hero em todas as páginas medidas.

---

# Parte 2 — Reestruturação da plataforma (branch `redesign/plataforma`)

## Método

- Lighthouse 13.6.0, mobile padrão (4G simulado, CPU 4×), servidor local sem compressão.
- As telas logadas precisam de sessão: as duas versões foram servidas com o mesmo Supabase simulado (mesmos dados de teste, sem rede) no lugar da biblioteca do CDN. Antes = commit `362a49e` (fim do redesign visual); depois = esta branch.
- SEO 50 em todas é intencional: área logada com `noindex`.

## Resultado

| Tela | Perf. antes | Perf. depois | CLS antes | CLS depois | A11y antes → depois |
|---|---|---|---|---|---|
| Início (cliente) | 97 | 95 | 0 | 0,007 | 100 → 100 |
| Minhas solicitações | 73 | **95** | 0,929 | **0** | 100 → 100 |
| Pagamentos | 73 | **96** | 0,929 | **0** | 100 → 100 |
| Meus projetos | 96 | 96 | 0,074 | **0** | 100 → 100 |
| Meu perfil | 96 | 96 | 0,074 | **0** | 100 → 100 |
| Início (admin) | 97 | 95 | 0 | **0** | 100 → 100 |
| Solicitações (admin) | 76 | **96** | 0,627 | **0** | 100 → 100 |
| Clientes (admin) | 72 | **95** | 0,281 | **0,01** | 95 → **100** |

LCP ficou entre 2,3 e 2,4 s em todas as telas (antes 1,8–3,9 s). Metas atingidas em todas: Performance ≥ 90, Acessibilidade ≥ 95, CLS < 0,1, LCP < 2,5 s.

O Início do cliente e o do admin caíram 2 pontos: a tela agora carrega mais conteúdo no primeiro quadro (KPIs, próximo passo, painel lateral) e pré-carrega mais dois pesos de fonte; a diferença está dentro da variação entre rodadas.

## O que segurou o layout (CLS)

| Causa | Correção |
|---|---|
| Menu (antes) e barra superior (agora) montados pelo JS empurravam a página inteira | `<header id="barra-topo">` vazio já no HTML; o JS só preenche. Reservar com margem não funcionou (colapsava com o `body`) |
| Listas e KPIs chegavam depois e mudavam de altura | Esqueletos com a altura real (primeiro KPI já com o formato de destaque; cards de projeto e solicitação com altura mínima) |
| Contadores de filtro e "x de y" entravam depois | Contador e linha de contagem já existem no HTML |
| Títulos e menus em Inter 600/700 trocavam de fonte no meio do carregamento | Preload desses dois pesos (23 KB cada) nas telas logadas |

## Verificação

- Varredura automática: 12 telas × 9 larguras (360, 390, 768, 1024, 1280, 1440, 1536, 1920 e 2560 px) × cliente e admin. Nenhuma rolagem horizontal, nenhum erro de console, conteúdo centralizado (sem sobra vazia só à direita).
- Fluxo do modal de validação (remover itens, adicionar do catálogo e personalizado, valor, resumo, aprovar, WhatsApp, comprovante) executado de ponta a ponta: sem regressão.
- Teclado: busca global (Ctrl+K e "/", setas, Enter, Esc devolve o foco), abas do perfil (setas, Home/End), gavetas e folha "Mais" com foco preso e Esc.
- `npm test`: 39/39.

---

# Parte 3 — Troca de tela (branch `otimizacao/navegacao`)

Queixa: "está demorando para trocar de tela". Medido clicando nos itens do menu, em sequência, com um
servidor que imita a Vercel (120 ms por requisição, ETag/304, os mesmos cabeçalhos do `vercel.json`)
e um Supabase simulado com 250 ms por consulta. Tempo do clique até a tela **pronta** (sem esqueleto).

| | Antes | Depois |
|---|---|---|
| Cliente (média de 6 trocas) | 1.020 ms | **453 ms** |
| Admin (média de 5 trocas) | 1.085 ms | **454 ms** |
| Início do admin | 1.177 ms | **431 ms** |
| Primeira pintura da nova tela | 316–480 ms | **120–320 ms** |

## Onde estava o tempo e o que mudou

| Causa | Correção |
|---|---|
| A cada troca o navegador revalidava todo CSS/JS (um 304 por arquivo) antes de pintar | CSS/JS com versão no endereço (`?v=<hash>`, `tools/versionar.mjs`) e cache de 1 ano; fontes 30 dias; imagens/ícones com `stale-while-revalidate` |
| A tela só buscava os dados depois de consultar o perfil no Supabase (2 idas em série) | Perfil guardado na aba (`sessionStorage`): a tela já busca os dados e o perfil é conferido em segundo plano. Papel diferente ou cadastro incompleto → recarrega; testado com perfil adulterado para "admin": volta ao Início do cliente. O RLS continua sendo quem libera dado |
| Sino, tempo real e contador do admin disputavam a rede com os dados da tela | Iniciados depois, no tempo ocioso |
| `/config.js` é uma função serverless (bloqueia a página e pode ter "partida a frio") | CDN da Vercel guarda por 1 h (`s-maxage`); trocar variável exige deploy, que limpa esse cache |
| Início do admin fazia duas consultas em sequência | Em paralelo |
| Nada era adiantado | Speculation Rules (`Speculation-Rules` no cabeçalho, `speculation-rules.json`): ao apontar o mouse ou tocar num item do menu, a próxima tela é pré-carregada. Fora: `continuar.html` (salva a solução vinda do site ao abrir) e páginas públicas |

O prerender (monta a tela inteira enquanto o mouse está sobre o link) não pôde ser medido aqui: o
Chromium de automação rebaixa para prefetch. Os números acima já incluem só o prefetch. No Chrome e no Edge
de verdade a troca tende a ficar perto de instantânea; Firefox e Safari ignoram as regras e ficam com os
demais ganhos.

Sem regressão: varredura de 12 telas × 9 larguras, fluxo completo do modal de validação e `npm test` (39/39).
