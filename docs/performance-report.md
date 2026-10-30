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
