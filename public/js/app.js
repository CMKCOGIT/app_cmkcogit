// =====================================================================
// app.js — base de todas as páginas: conexão com o Supabase, sessão,
// menu, chamadas à /api, solução "pendente" vinda do site e formatação.
// Ordem dos scripts em cada página:
//   supabase-js (CDN)  ->  /config.js  ->  js/app.js  ->  js/<página>.js
// =====================================================================

const CFG = window.COGIT_CONFIG || {};

(function diagnosticarConfig() {
  let problema = null;
  if (!window.COGIT_CONFIG) {
    problema = 'O arquivo /config.js não carregou. Abra a plataforma pelo servidor (<code>npm run dev</code> e depois ' +
      '<code>http://localhost:3000</code>), não com duplo clique no HTML nem com o Live Server do VS Code.';
  } else if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) {
    problema = 'O servidor está rodando, mas não encontrou ' +
      [!CFG.supabaseUrl && 'SUPABASE_URL', !CFG.supabaseAnonKey && 'SUPABASE_ANON_KEY'].filter(Boolean).join(' e ') +
      '. No computador: confira o arquivo <code>.env.local</code> na MESMA pasta do <code>package.json</code> e reinicie o ' +
      '<code>npm run dev</code>. Na Vercel: Settings → Environment Variables e faça um novo deploy.';
  } else if (!window.supabase) {
    problema = 'A biblioteca do Supabase (cdn.jsdelivr.net) não carregou. Verifique a internet ou desative o bloqueador de anúncios para este site.';
  }
  if (!problema) return;
  const mostrar = () => document.body.insertAdjacentHTML('afterbegin',
    '<p role="alert"><strong>Plataforma não configurada.</strong> ' + problema + '</p>');
  if (document.body) mostrar(); else document.addEventListener('DOMContentLoaded', mostrar);
  throw new Error('Configuração incompleta');
})();

// Erro devolvido pelo login social (ex.: cancelou no Google). Lido ANTES de criar o
// cliente do Supabase, que também lê a URL ao iniciar.
const ERRO_RETORNO_AUTH = (function () {
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const codigo = params.get('error') || hash.get('error');
  if (!codigo) return null;
  return {
    codigo,
    detalhe: params.get('error_code') || hash.get('error_code') || '',
    descricao: params.get('error_description') || hash.get('error_description') || ''
  };
})();

const db = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

// ---------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------
function esc(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function brl(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(data) {
  if (!data) return '-';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(data) ? new Date(data + 'T00:00:00') : new Date(data);
  return d.toLocaleDateString('pt-BR');
}
// (17) 98156-8889 enquanto digita
function formatarTelefone(valor) {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 11);
  if (d.length > 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  if (d.length > 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  if (d.length > 2) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
  return d;
}
function fmtDataHora(data) {
  return data ? new Date(data).toLocaleString('pt-BR') : '-';
}

const ROTULOS = {
  solicitacao: {
    em_validacao: 'Em validação pela equipe',
    aguardando_pagamento: 'Aguardando pagamento',
    paga: 'Paga',
    cancelada: 'Cancelada'
  },
  pagamento: { pendente: 'Pendente', pago: 'Pago', falhou: 'Falhou', cancelado: 'Cancelado', reembolsado: 'Reembolsado' },
  mp: {
    approved: 'aprovado', pending: 'aguardando pagamento', in_process: 'em análise',
    authorized: 'autorizado', rejected: 'recusado', cancelled: 'cancelado',
    refunded: 'estornado', charged_back: 'contestado'
  },
  metodo: { pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto', outro: 'Outro' },
  projeto: {
    em_andamento: 'Em andamento', aguardando_cliente: 'Aguardando você', concluido: 'Concluído',
    pausado: 'Pausado', cancelado: 'Cancelado'
  },
  status_pagamento: { pendente: 'Pendente', parcial: 'Parcial', pago: 'Pago', atrasado: 'Atrasado', reembolsado: 'Reembolsado' },
  etapa: { pendente: 'Pendente', em_andamento: 'Em andamento', concluida: 'Concluída' },
  funcionalidade: {
    aguardando_pagamento: 'Aguardando pagamento', paga: 'Paga — na fila', em_andamento: 'Em desenvolvimento',
    entregue: 'Entregue', cancelada: 'Cancelada'
  },
  tipo: {
    portfolio: 'Portfólio', landing_page: 'Landing Page', institucional: 'Site institucional', loja: 'Loja virtual',
    saas: 'Produto digital / plataforma', sistema: 'Sistema', automacao: 'Automação / integração',
    consultoria: 'Consultoria', identidade: 'Identidade visual', outro: 'Outro'
  }
};
function rotulo(grupo, valor) {
  return (ROTULOS[grupo] && ROTULOS[grupo][valor]) || valor || '-';
}

// Progresso do projeto em %: o definido pelo admin (sql/13) ou etapas concluídas de 8
// (ou pela etapa atual, se as etapas não vierem)
function progressoProjeto(p) {
  if (p.status_projeto === 'concluido') return 100;
  if (p.progresso != null) return Math.min(100, Math.max(0, Math.round(Number(p.progresso))));
  const etapas = p.projeto_etapas || [];
  if (etapas.length) return Math.round(etapas.filter((e) => e.status === 'concluida').length / etapas.length * 100);
  return Math.round(((p.etapa_atual || 1) - 1) / 8 * 100);
}
function barraProgresso(pct) {
  return `<progress max="100" value="${Number(pct)}">${Number(pct)}%</progress> <strong>${Number(pct)}%</strong>`;
}

// Lista de itens de uma solicitação (resumo calculado pelo servidor)
function itensHtml(resumo) {
  const r = resumo || {};
  const formato = (m) => (m === 'sob-medida' ? ' — sob medida' : m === 'modelos-prontos' ? ' — modelo pronto' : '');
  const preco = (p, t) => (p == null ? 'sob análise' : (t === 'from' ? 'a partir de ' : '') + brl(p));
  return [
    ...(r.itens || []).map((i) => `<li>${esc(i.nome)}${formato(i.modelo)} <small>(${preco(i.preco, i.tipo_preco)})</small></li>`),
    ...(r.complementos || []).map((c) => `<li>+ ${esc(c.nome)}${c.quantidade > 1 ? ' × ' + Number(c.quantidade) : ''} <small>(${preco(c.preco, c.tipo_preco)})</small></li>`),
    ...(r.mensais || []).map((m) => `<li>${esc(m.nome)} <small>(mensalidade${m.preco != null ? ' de ' + brl(m.preco) : ''}, começa depois dos 3 meses grátis)</small></li>`)
  ].join('');
}

// Itens de uma solicitação com o botão "Remover" (cliente dono ou admin, antes de pagar).
// O servidor recalcula o preço; quem remove a última solução precisa cancelar a solicitação.
function solicitacaoEditavel(s) {
  return s.status === 'em_validacao' || s.status === 'aguardando_pagamento';
}
function itensEditaveisHtml(s) {
  const r = s.resumo || {};
  const editavel = solicitacaoEditavel(s);
  const qtdSolucoes = (r.itens || []).length + (r.mensais || []).length;
  const formato = (m) => (m === 'sob-medida' ? 'sob medida' : m === 'modelos-prontos' ? 'modelo pronto' : '');
  const preco = (p, t) => (p == null ? 'sob análise' : (t === 'from' ? 'a partir de ' : '') + brl(p));
  const botao = (tipo, item, ultimo) => (!editavel ? '' : ultimo
    ? `<button type="button" disabled title="É a última solução. Para tirar tudo, cancele a solicitação.">Remover</button>`
    : `<button type="button" data-remover-item data-sol="${esc(s.id)}" data-tipo="${tipo}" data-id="${esc(item.id)}"
         data-nome="${esc(item.nome)}" aria-label="Remover ${esc(item.nome)}">Remover</button>`);
  const linha = (tipo, item, detalhe, valor, ultimo) => `<li data-item-tipo="${tipo}">
      <span data-item-nome>${esc(item.nome)}${detalhe ? ` <small>${esc(detalhe)}</small>` : ''}${item.adicionado === 'equipe' ? ' <small data-tag-equipe>adicionado pela equipe</small>' : ''}</span>
      <span data-item-preco>${esc(valor)}</span>${botao(tipo, item, ultimo)}</li>`;
  const itens = [
    ...(r.itens || []).map((i) => linha('servico', i, i.personalizado ? i.descricao || 'personalizado' : formato(i.modelo), preco(i.preco, i.tipo_preco), qtdSolucoes <= 1)),
    ...(r.mensais || []).map((m) => linha('servico', m, 'mensalidade após 3 meses grátis', m.preco != null ? brl(m.preco) + '/mês' : 'mensal', qtdSolucoes <= 1)),
    ...(r.complementos || []).map((c) => linha('complemento', c, (c.quantidade > 1 ? '× ' + Number(c.quantidade) + ' · ' : '') + 'complemento', preco(c.preco, c.tipo_preco), false))
  ].join('');
  const removidos = (r.removidos || []).slice(-5).map((x) =>
    `<li>${esc(x.nome)} <small>— tirado pel${x.por === 'equipe' ? 'a equipe' : 'o cliente'} em ${fmtData(x.em)}${x.motivo ? ' (' + esc(x.motivo) + ')' : ''}</small></li>`).join('');
  return `<ul data-itens-solicitacao>${itens}</ul>${removidos ? `<details data-removidos><summary>Itens retirados (${(r.removidos || []).length})</summary><ul>${removidos}</ul></details>` : ''}`;
}

// Liga os botões "Remover" dentro de `raiz`; depoisDeRemover(resposta) recarrega a tela.
function ligarRemoverItens(raiz, depoisDeRemover) {
  raiz.querySelectorAll('[data-remover-item]').forEach((btn) => btn.addEventListener('click', async () => {
    const { sol, tipo, id, nome } = btn.dataset;
    if (!window.confirm(`Tirar "${nome}" desta solicitação?\n\nO valor é recalculado. Se a solicitação for sob medida, ela volta para a validação da equipe.`)) return;
    btn.disabled = true;
    mostrarErro('');
    try {
      const r = await api('solicitacao-itens', { solicitacao_id: sol, tipo, id });
      const junto = r.removidos_junto && r.removidos_junto.length ? ` Também saiu: ${r.removidos_junto.join(', ')} (dependia dele).` : '';
      avisar(`"${nome}" foi retirado.${junto} ` + (r.solicitacao.valor_final != null
        ? 'Novo valor: ' + brl(r.solicitacao.valor_final) + '.'
        : 'A solicitação voltou para a validação da equipe.'));
      await depoisDeRemover(r);
    } catch (e) {
      mostrarErro(e.message);
      btn.disabled = false;
    }
  }));
}

function valorSolicitacao(s) {
  if (s.valor_final != null) return brl(s.valor_final);
  if (s.tipo_preco === 'free') return 'Gratuito';
  if (Number(s.valor_calculado) > 0) return 'A partir de ' + brl(s.valor_calculado) + ' (confirmado na validação)';
  return 'Definido na validação';
}

// Só links da própria plataforma (as notificações são geradas pelo banco)
function linkInterno(link) {
  return /^[a-z-]+\.html([?#][\w=&%#.-]*)?$/i.test(link || '');
}

function tempoRelativo(data) {
  const min = Math.round((Date.now() - new Date(data).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return 'há ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return 'há ' + h + ' h';
  const d = Math.round(h / 24);
  return d < 7 ? 'há ' + d + (d === 1 ? ' dia' : ' dias') : fmtData(data);
}

// ---------------------------------------------------------------------
// Áreas por papel: o admin não compra nada, então as telas de cliente
// (compra, checkout, "meus" projetos) não existem para ele, e vice-versa.
// O banco (RLS) e as rotas /api também bloqueiam; isto é a navegação.
// ---------------------------------------------------------------------
const INICIO_ADMIN = 'admin-inicio.html';
const PAGINAS_SO_CLIENTE = ['inicio.html', 'continuar.html', 'pagamentos.html', 'projetos.html', 'funcionalidades.html'];
const PAGINAS_SO_ADMIN = [INICIO_ADMIN, 'admin.html', 'admin-clientes.html'];

function ehAdmin(perfil) {
  return Boolean(perfil && perfil.role === 'admin');
}
function paginaAtual() {
  return window.location.pathname.split('/').pop() || 'index.html';
}
function paginaInicial(perfil) {
  return ehAdmin(perfil) ? INICIO_ADMIN : 'inicio.html';
}

// ---------------------------------------------------------------------
// Links externos
// ---------------------------------------------------------------------
function urlSite(caminho) {
  return (CFG.siteUrl || 'https://www.cmkcogit.com.br') + '/' + String(caminho || '').replace(/^\/+/, '');
}
function linkWhatsApp(mensagem) {
  return 'https://wa.me/' + (CFG.whatsapp || '5517981568889') + '?text=' + encodeURIComponent(mensagem);
}
// Domínio do cliente como link seguro (só http/https)
function linkDominio(dominio) {
  const d = String(dominio || '').trim();
  if (!d) return '';
  const url = /^https?:\/\//i.test(d) ? d : 'https://' + d;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return esc(d);
    return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${esc(d)}</a>`;
  } catch (_) {
    return esc(d);
  }
}
function urlMercadoPagoValida(url) {
  return /^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(\.[a-z]{2})?\//i.test(url || '');
}

// ---------------------------------------------------------------------
// Solução "pendente": o que o visitante montou no site e trouxe no link
// app.cmkcogit.com.br/continuar.html#cfg=...  Fica guardada NESTE navegador
// até o cliente entrar/cadastrar (inclusive se precisar confirmar o e-mail).
// ---------------------------------------------------------------------
const CHAVE_PENDENTE = 'cogit_solucao_pendente_v1';
const VALIDADE_PENDENTE = 7 * 24 * 60 * 60 * 1000;

function decodificarCfg(b64) {
  try {
    const bin = atob(String(b64).replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const cfg = JSON.parse(new TextDecoder().decode(bytes));
    if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.servicos) || !cfg.servicos.length || typeof cfg.ref !== 'string') return null;
    return cfg;
  } catch (_) {
    return null;
  }
}

// Lê #cfg=... da barra de endereço, guarda e limpa a URL. Devolve true se achou.
function capturarCfgDaUrl() {
  const m = window.location.hash.match(/[#&]cfg=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  const cfg = decodificarCfg(m[1]);
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (!cfg) return false;
  salvarPendente(cfg);
  return true;
}
function salvarPendente(cfg) {
  try { localStorage.setItem(CHAVE_PENDENTE, JSON.stringify({ cfg, expira: Date.now() + VALIDADE_PENDENTE })); } catch (_) {}
}
function lerPendente() {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_PENDENTE));
    if (v && v.cfg && v.expira > Date.now()) return v.cfg;
  } catch (_) {}
  limparPendente();
  return null;
}
function limparPendente() {
  try { localStorage.removeItem(CHAVE_PENDENTE); } catch (_) {}
}
function resumoPendenteHtml(cfg) {
  const itens = (cfg.servicos || []).map((s) => {
    const formato = s.modelo === 'sob-medida' ? ' — sob medida' : s.modelo === 'modelos-prontos' ? ' — modelo pronto' : '';
    return '<li>' + esc(s.nome || s.id) + formato + '</li>';
  });
  (cfg.complementos || []).forEach((c) => itens.push('<li>+ ' + esc(c.nome || c.id) + '</li>'));
  return '<ul>' + itens.join('') + '</ul>' + (cfg.estimativa ? '<p>Estimativa vista no site: ' + esc(cfg.estimativa) + '</p>' : '');
}

// Depois do login: continuar a solução do site ou ir para o início
function proximaPagina() {
  return lerPendente() ? 'continuar.html' : 'inicio.html';
}

// ---------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------
async function getSessao() {
  const { data } = await db.auth.getSession();
  return data.session;
}

// Perfil lido do BANCO (RLS: só o próprio). Sem perfil (ex.: o cadastro automático
// falhou) -> cria pelo garantir_perfil(). Falha de consulta -> lança erro: sem o
// perfil não dá para saber se o cadastro foi concluído, então nada é liberado.
async function getPerfil() {
  const sessao = await getSessao();
  if (!sessao) return null;
  const consultar = () => db.from('profiles')
    .select('id, nome, email, telefone, role, created_at, aceite_termos_em, cadastro_concluido_em')
    .eq('id', sessao.user.id).maybeSingle();
  let { data, error } = await consultar();
  if (!error && !data) {
    const criado = await db.rpc('garantir_perfil');
    if (criado.error) error = criado.error;
    else ({ data, error } = await consultar());
  }
  if (error || !data) {
    console.error('Erro ao carregar perfil:', error ? error.message : 'perfil não encontrado');
    throw new Error('Não foi possível carregar seu cadastro agora. Verifique sua conexão e tente novamente.');
  }
  return data;
}

// Cadastro concluído = gravado no banco por concluir_cadastro() (ou contas antigas).
const PAGINA_CADASTRO = 'completar-cadastro.html';
function cadastroConcluido(perfil) {
  return Boolean(perfil && perfil.cadastro_concluido_em);
}

// Chame no começo de toda página protegida. Sem login -> vai para o login;
// cadastro incompleto -> vai para "Concluir cadastro" (replace: o "voltar" não retorna aqui).
async function protegerPagina() {
  const sessao = await getSessao();
  if (!sessao) {
    window.location.replace('login.html');
    return null;
  }
  let perfil;
  try {
    perfil = await getPerfil();
  } catch (e) {
    mostrarFalhaDeAcesso(e.message);
    return null;
  }
  if (!cadastroConcluido(perfil)) {
    window.location.replace(PAGINA_CADASTRO);
    return null;
  }
  const pagina = paginaAtual();
  if (ehAdmin(perfil) && PAGINAS_SO_CLIENTE.includes(pagina)) {
    limparPendente(); // solução trazida do site não vale para o admin
    window.location.replace(INICIO_ADMIN);
    return null;
  }
  if (!ehAdmin(perfil) && PAGINAS_SO_ADMIN.includes(pagina)) {
    window.location.replace('inicio.html');
    return null;
  }
  montarMenu(perfil);
  return perfil;
}

// Sem perfil não há página: troca o conteúdo por um aviso com "tentar de novo" e "sair".
function mostrarFalhaDeAcesso(texto) {
  const main = document.querySelector('main');
  if (!main) return;
  main.innerHTML = `<p id="erro" role="alert">${esc(texto)}</p>
    <p><button type="button" id="btn-recarregar">Tentar de novo</button> <button type="button" id="btn-sair-falha">Sair</button></p>`;
  document.getElementById('btn-recarregar').addEventListener('click', () => window.location.reload());
  document.getElementById('btn-sair-falha').addEventListener('click', sair);
}

async function sair() {
  await db.auth.signOut();
  window.location.href = 'login.html';
}

// ---------------------------------------------------------------------
// Chamada às funções do servidor (/api/...) com o token do cliente
// ---------------------------------------------------------------------
// metodo 'GET': sem corpo (parâmetros vão na URL do caminho)
async function api(caminho, corpo, metodo = 'POST') {
  const sessao = await getSessao();
  if (!sessao) throw Object.assign(new Error('Sua sessão expirou. Entre novamente.'), { status: 401 });
  let resp;
  try {
    resp = await fetch('/api/' + caminho, metodo === 'GET'
      ? { method: 'GET', headers: { Authorization: 'Bearer ' + sessao.access_token } }
      : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sessao.access_token },
        body: JSON.stringify(corpo || {})
      });
  } catch (_) {
    throw Object.assign(new Error('Sem conexão. Verifique sua internet e tente novamente.'), { status: 0 });
  }
  const dados = await resp.json().catch(() => ({}));
  if (resp.status === 403 && dados.codigo === 'cadastro_incompleto') {
    window.location.replace(PAGINA_CADASTRO);
  }
  if (!resp.ok || dados.ok === false) {
    throw Object.assign(new Error(dados.erro || 'Não foi possível concluir agora.'), { status: resp.status });
  }
  return dados;
}

// Abre o checkout do Mercado Pago para uma solicitação ou cobrança
async function irParaCheckout(corpo) {
  const dados = await api('checkout', corpo);
  if (!urlMercadoPagoValida(dados.url)) throw new Error('Não foi possível iniciar o pagamento.');
  window.location.href = dados.url;
}

// ---------------------------------------------------------------------
// Menu (cada página protegida tem <nav id="menu"></nav>)
// Cliente: telas de compra e acompanhamento. Admin: painel de gestão.
// ---------------------------------------------------------------------
function montarMenu(perfil) {
  const nav = document.getElementById('menu');
  if (!nav) return;
  const admin = ehAdmin(perfil);
  const itens = admin ? [
    { href: INICIO_ADMIN, texto: 'Início' },
    { href: 'admin.html', texto: 'Solicitações' },
    { href: 'admin-clientes.html', texto: 'Clientes' },
    { href: 'perfil.html', texto: 'Meu perfil' }
  ] : [
    { href: 'inicio.html', texto: 'Início' },
    { href: 'continuar.html', texto: 'Minhas solicitações' },
    { href: 'pagamentos.html', texto: 'Pagamentos' },
    { href: 'projetos.html', texto: 'Meus projetos' },
    { href: 'funcionalidades.html', texto: 'Adquirir nova funcionalidade' },
    { href: 'perfil.html', texto: 'Meu perfil' }
  ];
  let atual = paginaAtual();
  if (atual === 'projeto.html') atual = admin ? 'admin-clientes.html' : 'projetos.html';

  nav.innerHTML = `
    <strong>CMKCOGIT</strong> · <span>${admin ? 'Painel de gestão' : 'Plataforma do cliente'}</span>
    ${sinoHtml()}
    <ul>
      ${itens.map((i) => `<li><a href="${i.href}"${i.href === atual ? ' aria-current="page"' : ''}>${i.texto}</a></li>`).join('')}
      ${admin ? '' : `<li><a href="${esc(urlSite('monte-sua-solucao.html'))}" data-externo>Montar nova solução (site)</a></li>`}
    </ul>
    <p><a href="perfil.html" title="Meu perfil">${esc(perfil?.nome || 'Meu perfil')}</a> <small>${esc(perfil?.email || '')}</small>
      <button type="button" id="btn-sair">Sair</button></p>
    <hr>`;
  document.getElementById('btn-sair').addEventListener('click', sair);
  if (perfil) iniciarSino(perfil);
}

// Contador do sino. Mantido com este nome: o Início do cliente chama depois de
// "Marcar todas como lidas".
function mostrarNaoLidas() {
  return Sino.atualizar();
}

// ---------------------------------------------------------------------
// Sino de notificações (cliente e admin): contador de não lidas, lista e
// "marcar como lida". Dados pela rota /api/notificacoes; atualiza em tempo
// real (Supabase Realtime, sql/13) e, por garantia, a cada 45 s com a aba visível.
// ---------------------------------------------------------------------
const ICONE_SINO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const INTERVALO_SINO = 45000;

function sinoHtml() {
  return `<div id="sino">
      <button type="button" id="btn-sino" aria-expanded="false" aria-controls="painel-sino" aria-label="Notificações">
        ${ICONE_SINO}<span id="sino-contador" hidden></span>
      </button>
      <section id="painel-sino" aria-labelledby="painel-sino-titulo" hidden>
        <header>
          <h2 id="painel-sino-titulo">Notificações</h2>
          <button type="button" id="sino-marcar-todas" hidden>Marcar todas como lidas</button>
        </header>
        <ul id="sino-lista" aria-live="polite"><li data-carregando>Carregando...</li></ul>
      </section>
    </div>`;
}

const Sino = {
  lista: [],
  naoLidas: 0,
  disponivel: true,
  timer: null,

  async atualizar() {
    if (!this.disponivel || !document.getElementById('btn-sino')) return;
    try {
      const r = await api('notificacoes?limite=20', null, 'GET');
      this.lista = r.notificacoes || [];
      this.naoLidas = Number(r.nao_lidas) || 0;
    } catch (e) {
      if (e.status === 404) this.disponivel = false; // rota ausente: desliga
      console.warn('Notificações indisponíveis:', e.message);
      this.renderizar(e.message);
      return;
    }
    this.renderizar();
  },

  renderizar(falha) {
    const contador = document.getElementById('sino-contador');
    const botao = document.getElementById('btn-sino');
    const ul = document.getElementById('sino-lista');
    if (!contador || !ul) return;
    contador.hidden = !this.naoLidas;
    contador.textContent = this.naoLidas > 99 ? '99+' : String(this.naoLidas);
    botao.setAttribute('aria-label', this.naoLidas
      ? `Notificações: ${this.naoLidas} ${this.naoLidas === 1 ? 'não lida' : 'não lidas'}` : 'Notificações');
    document.getElementById('sino-marcar-todas').hidden = !this.naoLidas;

    if (falha && !this.lista.length) {
      ul.innerHTML = `<li data-vazio>Não foi possível carregar agora. Tente de novo em instantes.</li>`;
      return;
    }
    if (!this.lista.length) {
      ul.innerHTML = '<li data-vazio>Nenhuma notificação por enquanto.</li>';
      return;
    }
    ul.innerHTML = this.lista.map((n) => `
      <li data-notificacao="${esc(n.id)}"${n.lida ? '' : ' data-nova'} data-tipo="${esc(n.tipo)}">
        ${n.link && linkInterno(n.link) ? `<a href="${esc(n.link)}">${esc(n.titulo)}</a>` : `<strong>${esc(n.titulo)}</strong>`}
        ${n.mensagem ? `<p>${esc(n.mensagem)}</p>` : ''}
        <small>${esc(tempoRelativo(n.created_at))}${n.lida ? '' : ' · <span>nova</span>'}</small>
        ${n.lida ? '' : `<button type="button" data-marcar-lida="${esc(n.id)}" aria-label="Marcar “${esc(n.titulo)}” como lida">Marcar como lida</button>`}
      </li>`).join('');
  },

  async marcar(ids) {
    try {
      const r = await api('notificacoes', ids ? { acao: 'marcar_lida', ids } : { acao: 'marcar_todas' });
      this.naoLidas = Number(r.nao_lidas) || 0;
      this.lista.forEach((n) => { if (!ids || ids.includes(n.id)) n.lida = true; });
      this.renderizar();
    } catch (e) {
      console.warn('Não foi possível marcar como lida:', e.message);
    }
  },

  abrir(abrir) {
    const painel = document.getElementById('painel-sino');
    const botao = document.getElementById('btn-sino');
    painel.hidden = !abrir;
    botao.setAttribute('aria-expanded', String(abrir));
    if (abrir) {
      this.atualizar();
      painel.querySelector('h2').setAttribute('tabindex', '-1');
      painel.querySelector('h2').focus({ preventScroll: true });
    }
  }
};

function iniciarSino(perfil) {
  const caixa = document.getElementById('sino');
  const botao = document.getElementById('btn-sino');
  const painel = document.getElementById('painel-sino');

  botao.addEventListener('click', () => Sino.abrir(painel.hidden));
  document.getElementById('sino-marcar-todas').addEventListener('click', () => Sino.marcar(null));
  painel.addEventListener('click', async (e) => {
    const marcar = e.target.closest('[data-marcar-lida]');
    if (marcar) { marcar.disabled = true; await Sino.marcar([marcar.dataset.marcarLida]); return; }
    const link = e.target.closest('a');
    const item = link && link.closest('li[data-nova]');
    if (item) { // abrir uma nova também marca como lida
      e.preventDefault();
      await Sino.marcar([item.dataset.notificacao]);
      window.location.href = link.getAttribute('href');
    }
  });
  document.addEventListener('click', (e) => { if (!painel.hidden && !caixa.contains(e.target)) Sino.abrir(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !painel.hidden) { Sino.abrir(false); botao.focus(); }
  });

  Sino.atualizar();
  clearInterval(Sino.timer);
  Sino.timer = setInterval(() => { if (!document.hidden) Sino.atualizar(); }, INTERVALO_SINO);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Sino.atualizar(); });

  // Tempo real: a notificação nova chega sem esperar o próximo ciclo
  try {
    db.channel('notificacoes-' + perfil.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notificacoes', filter: 'usuario_id=eq.' + perfil.id },
        () => Sino.atualizar())
      .subscribe();
  } catch (e) {
    console.warn('Tempo real indisponível; usando atualização periódica.', e.message);
  }
}

// Aviso flutuante (toast). Dentro de um <dialog> aberto vai para ele (camada de cima).
function toast(texto, tipo = 'ok') {
  const dono = document.querySelector('dialog[open]') || document.body;
  let caixa = dono.querySelector(':scope > [data-toasts]');
  if (!caixa) {
    caixa = document.createElement('div');
    caixa.setAttribute('data-toasts', '');
    dono.appendChild(caixa);
  }
  if (tipo !== 'erro') caixa.querySelectorAll('[data-tipo=erro]').forEach((x) => x.remove()); // deu certo: some o erro antigo
  const el = document.createElement('p');
  el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  el.dataset.tipo = tipo;
  el.textContent = texto;
  caixa.appendChild(el);
  while (caixa.children.length > 2) caixa.firstElementChild.remove(); // só os 2 mais recentes
  setTimeout(() => el.remove(), tipo === 'erro' ? 8000 : 4500);
}

// Botão em andamento: desabilita (evita clique duplo) e troca o texto
function ocupado(botao, sim, textoCarregando) {
  if (!botao) return;
  if (sim) {
    botao.dataset.textoOriginal = botao.textContent;
    if (textoCarregando) botao.textContent = textoCarregando;
    botao.disabled = true;
    botao.setAttribute('aria-busy', 'true');
  } else {
    if (botao.dataset.textoOriginal) botao.textContent = botao.dataset.textoOriginal;
    botao.disabled = false;
    botao.removeAttribute('aria-busy');
  }
}

// Mensagens de status/erro padrão das páginas (<p id="aviso"> e <p id="erro">)
function avisar(texto) {
  const el = document.getElementById('aviso');
  if (el) el.textContent = texto || '';
}
function mostrarErro(texto) {
  const el = document.getElementById('erro');
  if (el) el.textContent = texto || '';
}
