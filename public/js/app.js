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

// Progresso do projeto em %: etapas concluídas de 8 (ou pela etapa atual, se as etapas não vierem)
function progressoProjeto(p) {
  if (p.status_projeto === 'concluido') return 100;
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

function valorSolicitacao(s) {
  if (s.valor_final != null) return brl(s.valor_final);
  if (s.tipo_preco === 'free') return 'Gratuito';
  if (Number(s.valor_calculado) > 0) return 'A partir de ' + brl(s.valor_calculado) + ' (confirmado na validação)';
  return 'Definido na validação';
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

async function getPerfil() {
  const sessao = await getSessao();
  if (!sessao) return null;
  const { data, error } = await db.from('profiles').select('id, nome, email, telefone, role, created_at').eq('id', sessao.user.id).single();
  if (error) {
    console.error('Erro ao carregar perfil:', error.message);
    return { id: sessao.user.id, email: sessao.user.email, nome: '', role: 'cliente' };
  }
  return data;
}

// Chame no começo de toda página protegida. Sem login -> vai para o login.
async function protegerPagina() {
  const sessao = await getSessao();
  if (!sessao) {
    window.location.replace('login.html');
    return null;
  }
  const perfil = await getPerfil();
  montarMenu(perfil);
  return perfil;
}

async function sair() {
  await db.auth.signOut();
  window.location.href = 'login.html';
}

// ---------------------------------------------------------------------
// Chamada às funções do servidor (/api/...) com o token do cliente
// ---------------------------------------------------------------------
async function api(caminho, corpo) {
  const sessao = await getSessao();
  if (!sessao) throw Object.assign(new Error('Sua sessão expirou. Entre novamente.'), { status: 401 });
  let resp;
  try {
    resp = await fetch('/api/' + caminho, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sessao.access_token },
      body: JSON.stringify(corpo || {})
    });
  } catch (_) {
    throw Object.assign(new Error('Sem conexão. Verifique sua internet e tente novamente.'), { status: 0 });
  }
  const dados = await resp.json().catch(() => ({}));
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
// ---------------------------------------------------------------------
function montarMenu(perfil) {
  const nav = document.getElementById('menu');
  if (!nav) return;
  const itens = [
    { href: 'inicio.html', texto: 'Início' },
    { href: 'continuar.html', texto: 'Minhas solicitações' },
    { href: 'pagamentos.html', texto: 'Pagamentos' },
    { href: 'projetos.html', texto: 'Meus projetos' },
    { href: 'funcionalidades.html', texto: 'Adquirir nova funcionalidade' },
    { href: 'perfil.html', texto: 'Meu perfil' }
  ];
  if (perfil && perfil.role === 'admin') {
    itens.push({ href: 'admin.html', texto: 'Admin · Solicitações' });
    itens.push({ href: 'admin-clientes.html', texto: 'Admin · Clientes e projetos' });
  }
  let atual = window.location.pathname.split('/').pop() || 'inicio.html';
  if (atual === 'projeto.html') atual = 'projetos.html';

  nav.innerHTML = `
    <strong>CMK COGIT</strong> · <span>Plataforma do cliente</span>
    <ul>
      ${itens.map((i) => `<li><a href="${i.href}"${i.href === atual ? ' aria-current="page"' : ''}>${i.texto}</a></li>`).join('')}
      <li><a href="${esc(urlSite('monte-sua-solucao.html'))}">Montar nova solução (site)</a></li>
    </ul>
    <p><a href="perfil.html" title="Meu perfil">${esc(perfil?.nome || 'Meu perfil')}</a> <small>${esc(perfil?.email || '')}</small>
      <button type="button" id="btn-sair">Sair</button></p>
    <hr>`;
  document.getElementById('btn-sair').addEventListener('click', sair);
  if (perfil) mostrarNaoLidas(perfil.id);
}

// Contador de notificações não lidas ao lado de "Início"
async function mostrarNaoLidas(usuarioId) {
  const { count, error } = await db.from('notificacoes')
    .select('id', { count: 'exact', head: true }).eq('usuario_id', usuarioId).eq('lida', false);
  const link = document.querySelector('#menu a[href="inicio.html"]');
  if (!link) return;
  const antigo = link.querySelector('[data-contador]');
  if (antigo) antigo.remove();
  if (error || !count) return;
  link.insertAdjacentHTML('beforeend',
    `<span data-contador aria-label="${count} ${count === 1 ? 'notificação nova' : 'notificações novas'}">${count > 9 ? '9+' : count}</span>`);
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
