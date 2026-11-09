// SEO da plataforma (app.cmkcogit.com.br), no mesmo padrão do site (tools/seo.py de lá):
// - Em cada HTML, um bloco entre <!-- seo --> e <!-- /seo --> logo depois do <title>, com
//   descrição, robots, Open Graph e Twitter; nas páginas indexáveis, também canonical e
//   dados estruturados (JSON-LD @graph ligado à organização do site, #org).
// - Só a entrada pública (login/cadastro) é indexável; o resto é área logada (noindex).
// - Gera public/robots.txt e public/sitemap.xml.
// Uso: node tools/seo.mjs          (atualiza)
//      node tools/seo.mjs --check  (só confere; usado pelo npm test)
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public');
const conferir = process.argv.includes('--check');
const APP = 'https://app.cmkcogit.com.br';
const SITE = 'https://www.cmkcogit.com.br';
const LASTMOD = '2026-11-06';
const OG = { url: APP + '/assets/marca/cogit-og-icone.png', w: 600, h: 600, alt: 'Ícone da CMKCOGIT' }; // quadrada: a prévia do link mostra só o ícone
const DESC_PADRAO = 'Plataforma do cliente CMKCOGIT: acompanhe solicitações, projetos, pagamentos e comprovantes em um só lugar.';

// página -> [título, descrição, robots]; indexável = robots sem "noindex"
const PAGINAS = {
  'login.html': ['Área do cliente: entrar ou criar conta | CMKCOGIT',
    'Entre ou crie sua conta na área do cliente CMKCOGIT para acompanhar solicitações, projetos, pagamentos e comprovantes do seu site, sistema ou produto digital.',
    'index, follow, max-image-preview:large'],
  'index.html': ['Plataforma do cliente | CMKCOGIT', DESC_PADRAO, 'noindex, follow'],
  'inicio.html': ['Início | CMKCOGIT', DESC_PADRAO, 'noindex'],
  'continuar.html': ['Minhas solicitações | CMKCOGIT', 'Revise e envie a solução que você montou no site da CMKCOGIT.', 'noindex'],
  'projetos.html': ['Meus projetos | CMKCOGIT', 'Acompanhe as etapas e entregas dos seus projetos com a CMKCOGIT.', 'noindex'],
  'projeto.html': ['Projeto | CMKCOGIT', 'Detalhes, etapas e entregas do seu projeto com a CMKCOGIT.', 'noindex'],
  'pagamentos.html': ['Pagamentos | CMKCOGIT', 'Pagamentos e cobranças dos seus projetos com a CMKCOGIT.', 'noindex'],
  'funcionalidades.html': ['Adquirir nova funcionalidade | CMKCOGIT', 'Adicione novas funcionalidades ao seu projeto com a CMKCOGIT.', 'noindex'],
  'mensagens.html': ['Mensagens | CMKCOGIT', 'Converse com a equipe CMKCOGIT sobre os seus projetos.', 'noindex'],
  'perfil.html': ['Meu perfil | CMKCOGIT', 'Seus dados de cadastro na plataforma CMKCOGIT.', 'noindex'],
  'completar-cadastro.html': ['Concluir cadastro | CMKCOGIT', 'Conclua seu cadastro na plataforma CMKCOGIT.', 'noindex'],
  'redefinir-senha.html': ['Nova senha | CMKCOGIT', 'Defina uma nova senha para sua conta na plataforma CMKCOGIT.', 'noindex'],
  'comprovante.html': ['Comprovante de pedido | CMKCOGIT', 'Comprovante de pedido CMKCOGIT.', 'noindex, nofollow'],
  'admin-inicio.html': ['Painel de gestão | CMKCOGIT', 'Painel de gestão CMKCOGIT.', 'noindex, nofollow'],
  'admin.html': ['Solicitações | CMKCOGIT', 'Painel de gestão CMKCOGIT.', 'noindex, nofollow'],
  'admin-clientes.html': ['Clientes | CMKCOGIT', 'Painel de gestão CMKCOGIT.', 'noindex, nofollow'],
  '404.html': ['Página não encontrada | CMKCOGIT', 'A página que você procurou não existe na plataforma CMKCOGIT.', 'noindex'],
  'styleguide.html': ['Styleguide | CMKCOGIT', 'Guia visual interno da plataforma CMKCOGIT.', 'noindex, nofollow'],
};
const PRIORIDADE = { 'login.html': '0.8' };

const url = (rel) => APP + '/' + (rel === 'index.html' ? '' : rel);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function grafo(rel, titulo, desc) {
  const u = url(rel);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': ['Organization', 'ProfessionalService'], '@id': SITE + '/#org', name: 'CMKCOGIT', alternateName: ['COGIT', 'CMK COGIT'],
        url: SITE + '/', logo: { '@type': 'ImageObject', url: SITE + '/assets/images/icon-512.png', width: 512, height: 512 },
        email: 'contato@cmkcogit.com.br', telephone: '+55-17-98156-8889',
        sameAs: ['https://www.instagram.com/cmkcogit', 'https://www.linkedin.com/in/cmkcogit'] },
      { '@type': 'WebSite', '@id': APP + '/#website', url: APP + '/', name: 'Plataforma CMKCOGIT', inLanguage: 'pt-BR', publisher: { '@id': SITE + '/#org' } },
      { '@type': 'WebApplication', '@id': APP + '/#app', name: 'Plataforma do cliente CMKCOGIT', url: u, applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web', inLanguage: 'pt-BR', description: desc, provider: { '@id': SITE + '/#org' },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL', description: 'Acesso gratuito para clientes CMKCOGIT.' } },
      { '@type': 'WebPage', '@id': u + '#webpage', url: u, name: titulo, description: desc, inLanguage: 'pt-BR',
        isPartOf: { '@id': APP + '/#website' }, about: { '@id': APP + '/#app' }, breadcrumb: { '@id': u + '#breadcrumb' },
        primaryImageOfPage: { '@type': 'ImageObject', url: OG.url } },
      { '@type': 'BreadcrumbList', '@id': u + '#breadcrumb', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Início', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Área do cliente', item: u }] },
    ],
  };
}

function bloco(rel) {
  const [titulo, desc, robots] = PAGINAS[rel];
  const indexavel = !robots.includes('noindex');
  const l = [
    `<meta name="description" content="${esc(desc)}">`,
    `<meta name="robots" content="${robots}">`,
  ];
  if (indexavel) l.push(`<link rel="canonical" href="${url(rel)}">`);
  l.push(
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${esc(titulo)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${url(rel)}">`,
    '<meta property="og:site_name" content="CMKCOGIT">',
    '<meta property="og:locale" content="pt_BR">',
    `<meta property="og:image" content="${OG.url}">`,
    `<meta property="og:image:width" content="${OG.w}">`,
    `<meta property="og:image:height" content="${OG.h}">`,
    `<meta property="og:image:alt" content="${esc(OG.alt)}">`,
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${esc(titulo)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${OG.url}">`,
  );
  if (indexavel) l.push('<script type="application/ld+json">' + JSON.stringify(grafo(rel, titulo, desc)).replace(/</g, '\\u003c') + '</script>');
  return '<!-- seo -->\n  ' + l.join('\n  ') + '\n  <!-- /seo -->';
}

const pendentes = [];
const grava = (arq, novo) => {
  const atual = fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8') : null;
  if (atual === novo) return;
  pendentes.push(path.relative(raiz, arq));
  if (!conferir) fs.writeFileSync(arq, novo);
};

// googleXXXX.html é o arquivo de verificação do Search Console: fica como o Google entregou
const html = fs.readdirSync(raiz).filter((f) => f.endsWith('.html') && !/^google[\w]+\.html$/.test(f)).sort();
const semConfig = html.filter((f) => !PAGINAS[f]);
if (semConfig.length) { console.error('Páginas sem SEO definido em tools/seo.mjs: ' + semConfig.join(', ')); process.exit(1); }

for (const rel of html) {
  const arq = path.join(raiz, rel);
  let s = fs.readFileSync(arq, 'utf8');
  s = s.replace(/\n\s*<!-- seo -->[\s\S]*?<!-- \/seo -->/, '');
  s = s.replace(/\n\s*<meta name="(?:robots|description)"[^>]*>/g, '');
  s = s.replace(/<title>[^<]*<\/title>/, `<title>${esc(PAGINAS[rel][0])}</title>\n  ${bloco(rel)}`);
  grava(arq, s);
}

const indexaveis = html.filter((f) => !PAGINAS[f][2].includes('noindex'));
grava(path.join(raiz, 'sitemap.xml'), ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...indexaveis.flatMap((f) => ['  <url>', `    <loc>${url(f)}</loc>`, `    <lastmod>${LASTMOD}</lastmod>`, `    <priority>${PRIORIDADE[f] || '0.5'}</priority>`, '  </url>']),
  '</urlset>', ''].join('\n'));
// API fora do rastreamento. As páginas da área logada NÃO entram no Disallow: o robô precisa
// lê-las para ver o noindex (bloqueadas, poderiam aparecer na busca só com o endereço).
grava(path.join(raiz, 'robots.txt'), ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /config.js', '',
  `Sitemap: ${APP}/sitemap.xml`, ''].join('\n'));

if (conferir && pendentes.length) { console.error('SEO desatualizado em: ' + pendentes.join(', ') + '\nRode: node tools/seo.mjs'); process.exit(1); }
console.log(`SEO ${conferir ? 'conferido' : 'gerado'} (${indexaveis.length} página(s) no sitemap)` + (!conferir && pendentes.length ? ': ' + pendentes.join(', ') : ''));
