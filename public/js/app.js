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
    problema = 'A biblioteca do Supabase não carregou. Recarregue a página; se continuar, verifique a internet.';
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

// ---------------------------------------------------------------------
// Login único com o mvp.cmkcogit.com.br SEM cookie compartilhado: a sessão fica só neste endereço
// (padrão do supabase-js). "Entrar direto" usa um código de uso único entre os dois sites
// (sso.html + /api/sso, lib/sso.js). Nenhum outro subdomínio recebe ou lê a sessão.
// ---------------------------------------------------------------------
const SSO = {
  TENTADO: 'cogit_sso_tentado',  // sessionStorage: já tentou nesta aba (evita ir e voltar sem fim)
  SAIU: 'cogit_sso_saiu',        // localStorage: a pessoa clicou em "Sair" aqui; não entra sozinha de novo
  pode() {
    if (!CFG.mvpUrl) return false;
    try { return !sessionStorage.getItem(SSO.TENTADO) && !localStorage.getItem(SSO.SAIU); } catch (_) { return false; }
  },
  // Sem sessão aqui: pergunta ao mvp se a pessoa já está logada lá (volta sozinha nos dois casos)
  tentar(volta) {
    try { sessionStorage.setItem(SSO.TENTADO, '1'); } catch (_) {}
    window.location.replace(CFG.mvpUrl + '/sso.html?para=app&volta=' + encodeURIComponent(volta || '/'));
  },
  entrou() { try { localStorage.removeItem(SSO.SAIU); sessionStorage.removeItem(SSO.TENTADO); } catch (_) {} },
  saiu() { try { localStorage.setItem(SSO.SAIU, '1'); } catch (_) {} }
};

const db = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

// ---------------------------------------------------------------------
// Captcha (Cloudflare Turnstile) no cadastro, no login e na recuperação de senha.
// Ligado em Supabase > Authentication > Attack Protection (a chave secreta fica só lá); aqui só a
// chave pública (TURNSTILE_SITE_KEY). Sem a chave, os formulários funcionam como antes.
// ---------------------------------------------------------------------
const captcha = (function () {
  let carregando = null;
  const widgets = new Map();
  function carregar() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    carregando = carregando || new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => ok(window.turnstile);
      s.onerror = () => falha(new Error('Não foi possível carregar a verificação de segurança.'));
      document.head.appendChild(s);
    });
    return carregando;
  }
  async function montar(form) {
    if (!CFG.turnstileSiteKey || !form || widgets.has(form)) return;
    const caixa = document.createElement('div');
    caixa.className = 'captcha';
    (form.querySelector('[type=submit]') || form.lastElementChild).before(caixa);
    try {
      const t = await carregar();
      widgets.set(form, t.render(caixa, { sitekey: CFG.turnstileSiteKey, language: 'pt-br', appearance: 'interaction-only' }));
    } catch (e) { console.warn(e.message); }
  }
  return {
    ativo: () => Boolean(CFG.turnstileSiteKey),
    montar,
    // undefined = captcha desligado (o Supabase ignora); null = ainda não verificado
    token(form) {
      if (!CFG.turnstileSiteKey) return undefined;
      const id = widgets.get(form);
      return id !== undefined && window.turnstile ? window.turnstile.getResponse(id) || null : null;
    },
    reiniciar(form) {
      const id = widgets.get(form);
      if (id !== undefined && window.turnstile) window.turnstile.reset(id);
    }
  };
})();
const AVISO_CAPTCHA = 'Aguarde a verificação de segurança terminar e tente de novo.';

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
// CPF (11 números) ou CNPJ (14). A mesma regra roda no banco (documento_valido).
function documentoValido(valor) {
  const d = String(valor || '').replace(/\D/g, '');
  if (!/^(\d{11}|\d{14})$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const n = [...d].map(Number);
  const dv = (pesos) => {
    const s = pesos.reduce((t, p, i) => t + n[i] * p, 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  if (d.length === 11) {
    const p1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
    return dv(p1) === n[9] && dv([11, ...p1]) === n[10];
  }
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return dv(p1) === n[12] && dv([6, ...p1]) === n[13];
}
function formatarDocumento(valor) {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 14);
  const partes = d.length <= 11 ? [[3, ''], [3, '.'], [3, '.'], [2, '-']] : [[2, ''], [3, '.'], [3, '.'], [4, '/'], [2, '-']];
  let i = 0;
  return partes.map(([qtd, sep]) => {
    const pedaco = d.slice(i, i += qtd);
    return pedaco ? sep + pedaco : '';
  }).join('');
}
// Na tela o documento aparece mascarado: ***.456.789-** / **.345.678/0001-**
function mascararDocumento(valor) {
  const d = String(valor || '').replace(/\D/g, '');
  if (d.length === 11) return '***.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-**';
  if (d.length === 14) return '**.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-**';
  return '';
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

// Anel de progresso (preenche ao entrar na tela). Rótulo para leitores de tela.
function anelHtml(pct, rotulo, grande = false) {
  const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  return `<span class="anel" data-anel${grande ? ' data-grande' : ''} style="--pct:${n}" role="img" aria-label="${esc(rotulo || n + '% concluído')}"><span aria-hidden="true">${n}%</span></span>`;
}

// Card de indicador. k = { rotulo, valor (número), formato: 'numero'|'brl', icone, href,
// formato também 'pct'; nota, destaque, alerta: 'perigo'|'atencao', variacao: { pct, sentido: 'subiu'|'desceu', texto } }
function kpiHtml(k) {
  const valor = k.formato === 'brl' ? brl(k.valor) : (Number(k.valor) || 0) + (k.formato === 'pct' ? '%' : '');
  const variacao = k.variacao ? `<span class="kpi-variacao" data-sentido="${esc(k.variacao.sentido)}">${icone(k.variacao.sentido === 'desceu' ? 'desceu' : 'subiu')}${esc(k.variacao.texto)}</span>` : '';
  const corpo = `
    <span class="kpi-rotulo">${esc(k.rotulo)}</span>
    <span class="kpi-icone" aria-hidden="true">${icone(k.icone || 'info')}</span>
    <strong class="kpi-valor" data-contar="${Number(k.valor) || 0}" data-formato="${k.formato || 'numero'}">${esc(valor)}</strong>
    ${variacao || k.nota ? `<small class="kpi-nota">${variacao}${k.nota ? `<span>${esc(k.nota)}</span>` : ''}</small>` : ''}`;
  return `<li class="kpi"${k.destaque ? ' data-destaque' : ''}${k.alerta ? ` data-alerta="${esc(k.alerta)}"` : ''}>${k.href ? `<a href="${esc(k.href)}">${corpo}</a>` : `<div>${corpo}</div>`}</li>`;
}

// ---------------------------------------------------------------------
// Movimento: contadores, anéis e revelação ao rolar. Tudo já nasce com o
// valor final no HTML; a animação só acontece com movimento permitido.
// ---------------------------------------------------------------------
const MOVIMENTO_REDUZIDO = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!MOVIMENTO_REDUZIDO && 'IntersectionObserver' in window) document.documentElement.classList.add('anima');

function animarNumeros(raiz = document) {
  const alvos = [...raiz.querySelectorAll('[data-contar]:not([data-contado]), [data-anel]:not(.visivel)')];
  if (!alvos.length) return;
  const mostrar = (el) => {
    if (el.hasAttribute('data-anel')) { el.classList.add('visivel'); return; }
    el.setAttribute('data-contado', '');
    const fim = Number(el.dataset.contar) || 0;
    const fmt = (v) => (el.dataset.formato === 'brl' ? brl(v) : Math.round(v) + (el.dataset.formato === 'pct' ? '%' : ''));
    if (MOVIMENTO_REDUZIDO || !fim) { el.textContent = fmt(fim); return; }
    const inicio = performance.now();
    const dur = 900;
    const passo = (t) => {
      const x = Math.min(1, (t - inicio) / dur);
      const e = 1 - Math.pow(1 - x, 3);
      el.textContent = fmt(x < 1 ? (el.dataset.formato === 'brl' ? fim * e : Math.floor(fim * e)) : fim);
      if (x < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  };
  if (!('IntersectionObserver' in window)) { alvos.forEach(mostrar); return; }
  const io = new IntersectionObserver((entradas) => entradas.forEach((en) => {
    if (en.isIntersecting) { io.unobserve(en.target); mostrar(en.target); }
  }), { threshold: 0.3 });
  alvos.forEach((el) => io.observe(el));
}

// Revela ao rolar só o que começa fora da tela (o que já está visível não pisca).
function revelar(seletor = '.coluna-principal > *, .coluna-lateral > *, [data-revelar-grupo] > *') {
  if (!document.documentElement.classList.contains('anima')) return;
  const alvos = [...document.querySelectorAll(seletor)].filter((el) => !el.hasAttribute('data-revelar') && !el.hidden);
  const io = new IntersectionObserver((entradas) => entradas.forEach((en) => {
    if (en.isIntersecting) { io.unobserve(en.target); en.target.classList.add('visivel'); }
  }), { rootMargin: '0px 0px -8% 0px' });
  alvos.forEach((el, i) => {
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    el.setAttribute('data-revelar', '');
    el.style.setProperty('--atraso', Math.min(i % 4, 3) * 70 + 'ms');
    io.observe(el);
  });
}

// Lista de itens de uma solicitação (resumo calculado pelo servidor)
function itensHtml(resumo) {
  const r = resumo || {};
  const formato = (m) => (m === 'sob-medida' ? ' — sob medida' : m === 'modelos-prontos' ? ' — modelo pronto' : '');
  const preco = (p, t) => (p == null ? 'sob análise' : (t === 'from' ? 'a partir de ' : '') + brl(p));
  return [
    ...(r.itens || []).map((i) => `<li>${esc(i.nome)}${formato(i.modelo)} <small>(${preco(i.preco, i.tipo_preco)})</small></li>`),
    ...(r.complementos || []).map((c) => `<li>+ ${esc(c.nome)}${c.quantidade > 1 ? ' × ' + Number(c.quantidade) : ''} <small>(${preco(c.preco, c.tipo_preco)})</small></li>`),
    ...(r.mensais || []).map((m) => `<li>${esc(m.nome)} <small>(${m.cobranca === 'solicitação' ? 'por solicitação, a partir de' : 'mensalidade de'} ${m.preco != null ? brl(m.preco) : ''}, começa depois do 1º mês grátis)</small></li>`),
    ...(r.desconto ? [`<li>Desconto da combinação ${esc(r.desconto.nome)} <small>(${Number(r.desconto.percentual)}%: − ${brl(r.desconto.valor)})</small></li>`] : [])
  ].join('');
}

// Itens podem sair de uma solicitação (cliente dono ou admin) até ela ser paga.
// O servidor recalcula o preço; quem remove a última solução precisa cancelar a solicitação.
function solicitacaoEditavel(s) {
  return s.status === 'em_validacao' || s.status === 'aguardando_pagamento';
}
// Pílula de status: texto + cor (nunca só cor)
const TOM_STATUS = {
  solicitacao: { em_validacao: 'atencao', aguardando_pagamento: 'info', paga: 'ok', cancelada: 'neutro' },
  pagamento: { pendente: 'atencao', pago: 'ok', falhou: 'perigo', cancelado: 'neutro', reembolsado: 'neutro' },
  projeto: { em_andamento: 'info', aguardando_cliente: 'atencao', pausado: 'neutro', concluido: 'ok', cancelado: 'neutro' }
};
function etiquetaStatus(grupo, valor) {
  return `<span data-etiqueta="${(TOM_STATUS[grupo] || {})[valor] || 'neutro'}">${esc(rotulo(grupo, valor))}</span>`;
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

// Linha do tempo agrupada por dia, com ícone por tipo de evento
const ICONE_EVENTO = { etapa: 'avancar', arquivo: 'comprovante', pagamento: 'pagamentos', pendencia: 'alerta', solicitacao: 'solicitacoes', funcionalidade: 'adquirir', concluido: 'aprovar', mensagem: 'mensagens', tarefa: 'quadros', jornada: 'criar' };
function rotuloDia(data) {
  const d = new Date(data);
  const hoje = new Date();
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  const mesmo = (a, b) => a.toDateString() === b.toDateString();
  return mesmo(d, hoje) ? 'Hoje' : mesmo(d, ontem) ? 'Ontem' : fmtData(data);
}
function linhaDoTempoHtml(lista) {
  let dia = '';
  return lista.map((n) => {
    const r = rotuloDia(n.created_at);
    const cabeca = r !== dia ? `<li class="linha-tempo-dia" aria-hidden="true">${esc(r)}</li>` : '';
    dia = r;
    const titulo = linkInterno(n.link) ? `<a class="evento-titulo" href="${esc(n.link)}">${esc(n.titulo)}</a>` : `<strong class="evento-titulo">${esc(n.titulo)}</strong>`;
    return `${cabeca}<li class="evento" data-notificacao="${esc(n.id)}" data-tipo="${esc(n.tipo || '')}"${n.lida ? '' : ' data-nova'}>
      <span class="evento-icone" aria-hidden="true">${icone(ICONE_EVENTO[n.tipo] || 'notificacoes')}</span>
      ${titulo}<time class="evento-quando" datetime="${esc(n.created_at)}">${esc(tempoRelativo(n.created_at))}${n.lida ? '' : '<span class="so-leitor-tela"> (nova)</span>'}</time>
      ${n.mensagem ? `<p class="evento-texto">${esc(n.mensagem)}</p>` : ''}</li>`;
  }).join('');
}

// ---------------------------------------------------------------------
// Áreas por papel: o admin não compra nada, então as telas de cliente
// (compra, checkout, "meus" projetos) não existem para ele, e vice-versa.
// O banco (RLS) e as rotas /api também bloqueiam; isto é a navegação.
// ---------------------------------------------------------------------
const INICIO_ADMIN = 'admin-inicio.html';
const PAGINAS_SO_CLIENTE = ['inicio.html', 'continuar.html', 'pagamentos.html', 'projetos.html', 'funcionalidades.html', 'construir.html'];
const PAGINAS_SO_ADMIN = [INICIO_ADMIN, 'admin.html', 'admin-clientes.html', 'admin-quadros.html', 'admin-mentores.html'];

function ehAdmin(perfil) {
  return Boolean(perfil && perfil.role === 'admin');
}
function paginaAtual() {
  if (/^\/projeto\/[^/]+\/?$/.test(window.location.pathname)) return 'construir.html'; // vercel.json: /projeto/:id
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
// "Voltar para o site": o site manda ?volta=<página onde a pessoa estava> ao abrir a plataforma.
// Só vale endereço do próprio site (evita redirecionar para fora); fica nesta aba até ela fechar.
const CHAVE_VOLTA = 'cogit_volta_site';
function origensDoSite() {
  const base = new URL(CFG.siteUrl || 'https://www.cmkcogit.com.br');
  const host = base.hostname.replace(/^www\./, '');
  return new Set([base.origin, 'https://' + host, 'https://www.' + host, 'http://localhost:4173', 'http://127.0.0.1:4173']);
}
function enderecoDoSite(valor) {
  try {
    const u = new URL(valor);
    return origensDoSite().has(u.origin) && /^https?:$/.test(u.protocol) ? u.origin + u.pathname + u.search + u.hash : null;
  } catch (_) { return null; }
}
(function capturarVolta() {
  const params = new URLSearchParams(window.location.search);
  const pedido = enderecoDoSite(params.get('volta') || '');
  if (pedido) {
    try { sessionStorage.setItem(CHAVE_VOLTA, pedido); } catch (_) {}
    params.delete('volta');
    const limpa = window.location.pathname + (params.toString() ? '?' + params : '') + window.location.hash;
    history.replaceState(history.state, '', limpa); // o endereço da plataforma fica limpo
  }
})();
function voltarParaSite() {
  let guardado = null;
  try { guardado = enderecoDoSite(sessionStorage.getItem(CHAVE_VOLTA) || ''); } catch (_) {}
  // sem o parâmetro: quem veio do site (o navegador só informa o domínio) volta para a página inicial dele
  const veioDoSite = document.referrer && enderecoDoSite(document.referrer);
  return guardado || veioDoSite || urlSite('');
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
// "Construir com a CMK Cogit" (vindo do mvp) sem login: volta para /projeto/{id} depois de entrar
const CHAVE_CONSTRUIR = 'cogit_construir_v1';
function proximaPagina() {
  let construir = null;
  try { construir = localStorage.getItem(CHAVE_CONSTRUIR); } catch (_) {}
  if (construir && /^[0-9a-f-]{36}$/i.test(construir)) return 'projeto/' + construir;
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
    limparPerfilCache();
    // link do e-mail vencido: leva o motivo para o login explicar
    window.location.replace('login.html' + (ERRO_RETORNO_AUTH ? (window.location.hash || window.location.search) : ''));
    return null;
  }
  // Troca de tela rápida: com o perfil desta aba em memória, a página já monta e
  // busca os dados dela enquanto o perfil é conferido no banco em segundo plano.
  // O cache só decide a NAVEGAÇÃO; quem libera dado é o RLS/servidor, sempre.
  const guardado = lerPerfilCache(sessao.user.id);
  if (guardado) {
    if (!aplicarPerfil(guardado)) return null;
    getPerfil().then((atual) => {
      salvarPerfilCache(atual);
      if (!cadastroConcluido(atual) || ehAdmin(atual) !== ehAdmin(guardado)) { window.location.reload(); return; }
      if (atual.nome !== guardado.nome || atual.email !== guardado.email) montarMenu(atual);
    }).catch((e) => console.warn('Não foi possível conferir o perfil:', e.message));
    return guardado;
  }
  let perfil;
  try {
    perfil = await getPerfil();
  } catch (e) {
    mostrarFalhaDeAcesso(e.message);
    return null;
  }
  salvarPerfilCache(perfil);
  return aplicarPerfil(perfil) ? perfil : null;
}

// Regras de acesso por papel + menu. false = a página vai redirecionar.
function aplicarPerfil(perfil) {
  if (!cadastroConcluido(perfil)) {
    window.location.replace(PAGINA_CADASTRO);
    return false;
  }
  const pagina = paginaAtual();
  if (ehAdmin(perfil) && PAGINAS_SO_CLIENTE.includes(pagina)) {
    limparPendente(); // solução trazida do site não vale para o admin
    window.location.replace(INICIO_ADMIN);
    return false;
  }
  if (!ehAdmin(perfil) && PAGINAS_SO_ADMIN.includes(pagina)) {
    window.location.replace('inicio.html');
    return false;
  }
  montarMenu(perfil);
  return true;
}

// Perfil desta aba (sessionStorage: some ao fechar a aba e ao sair)
const CHAVE_PERFIL = 'cmk_perfil_v1';
function lerPerfilCache(usuarioId) {
  try {
    const p = JSON.parse(sessionStorage.getItem(CHAVE_PERFIL));
    return p && p.id === usuarioId ? p : null;
  } catch (_) { return null; }
}
function salvarPerfilCache(perfil) {
  // só perfil liberado vai para o cache (cadastro incompleto sempre confere no banco)
  try { if (cadastroConcluido(perfil)) sessionStorage.setItem(CHAVE_PERFIL, JSON.stringify(perfil)); else limparPerfilCache(); } catch (_) {}
}
function limparPerfilCache() {
  try { sessionStorage.removeItem(CHAVE_PERFIL); } catch (_) {}
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
  limparPerfilCache();
  SSO.saiu();   // o mvp continua logado; aqui não entra sozinho de novo até um login manual
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
  if (dados.codigo === 'documento_pendente') {
    window.location.href = 'perfil.html?falta=documento';
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
// ---------------------------------------------------------------------
// Shell da plataforma: menu lateral flutuante (desktop/tablet), barra
// superior (busca, sino, usuário), menu inferior com botão central e folha
// "Mais" (celular). Tudo montado aqui; as páginas só têm <nav id="menu"> e <main>.
// Pode ser chamado de novo (ex.: perfil salvo): substitui o que já existe.
// ---------------------------------------------------------------------
function itensMenu(perfil) {
  const admin = ehAdmin(perfil);
  const ajuda = linkWhatsApp(`Olá! Sou ${perfil?.nome || 'cliente'} (${perfil?.email || ''}) e preciso de ajuda na plataforma COGIT.`);
  return admin ? {
    rotulo: 'Painel de gestão',
    grupos: [{ titulo: 'Gestão', itens: [
      { href: INICIO_ADMIN, texto: 'Início', curto: 'Início', icone: 'painel' },
      { href: 'admin.html', texto: 'Solicitações', curto: 'Solicitações', icone: 'solicitacoes', contador: 'menu-cont-validacao' },
      { href: 'admin-clientes.html', texto: 'Clientes', curto: 'Clientes', icone: 'clientes' },
      { href: 'admin-quadros.html', texto: 'Quadros', curto: 'Quadros', icone: 'quadros' },
      { href: 'jornada.html', texto: 'Jornada MVP', curto: 'Jornada', icone: 'criar' },
      { href: 'admin-mentores.html', texto: 'Mentores e orçamentos MVP', curto: 'Mentores', icone: 'equipe' },
      { href: 'mensagens.html', texto: 'Mensagens', curto: 'Mensagens', icone: 'mensagens', contador: 'menu-cont-mensagens' }
    ] }],
    fab: { href: 'admin.html?filtro=em_validacao', texto: 'Solicitações em validação', curto: 'Validar', complemento: ' solicitações em validação', icone: 'aprovar' },
    inferior: [INICIO_ADMIN, 'admin.html', 'fab', 'mensagens.html'],
    ajuda
  } : {
    rotulo: 'Plataforma do cliente',
    grupos: [
      { titulo: 'Principal', itens: [
        { href: 'inicio.html', texto: 'Início', curto: 'Início', icone: 'inicio' },
        { href: 'continuar.html', texto: 'Minhas solicitações', curto: 'Solicitações', icone: 'solicitacoes' },
        { href: 'pagamentos.html', texto: 'Pagamentos', curto: 'Pagamentos', icone: 'pagamentos' },
        { href: 'projetos.html', texto: 'Meus projetos', curto: 'Projetos', icone: 'projetos' },
        { href: 'mensagens.html', texto: 'Mensagens', curto: 'Mensagens', icone: 'mensagens', contador: 'menu-cont-mensagens' }
      ] },
      { titulo: 'Crescer', itens: [
        { href: 'funcionalidades.html', texto: 'Adquirir nova funcionalidade', curto: 'Funcionalidades', icone: 'adquirir' },
        { href: 'jornada.html', texto: 'Jornada MVP', curto: 'Jornada', icone: 'criar' }
      ] }
    ],
    fab: { href: urlSite('monte-sua-solucao.html'), texto: 'Montar nova solução', curto: 'Nova', complemento: ' solução (abre o site)', icone: 'adicionar', externo: true },
    inferior: ['inicio.html', 'continuar.html', 'fab', 'mensagens.html'],
    ajuda
  };
}

function iniciais(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  return ((partes[0] || '?')[0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

function montarMenu(perfil) {
  const nav = document.getElementById('menu');
  const main = document.querySelector('body.app > main');
  if (!nav || !main) return;
  const admin = ehAdmin(perfil);
  const m = itensMenu(perfil);
  const tablet = window.matchMedia('(max-width: 1023.98px)').matches;
  const todos = m.grupos.flatMap((g) => g.itens);
  let atual = paginaAtual();
  if (atual === 'projeto.html') atual = admin ? 'admin-clientes.html' : 'projetos.html';
  const corrente = (href) => (href === atual ? ' aria-current="page"' : '');
  const link = (i) => `<a href="${esc(i.href)}"${corrente(i.href)} title="${esc(i.texto)}">${icone(i.icone)}<span data-rotulo>${esc(i.texto)}</span>${i.contador ? `<span class="menu-contador" id="${i.contador}" hidden></span>` : ''}</a>`;
  const externo = (i) => (i.externo ? ' target="_blank" rel="noopener"' : '');

  // ---- menu lateral ----
  nav.innerHTML = `
    <strong>CMKCOGIT</strong> · <span>${m.rotulo}</span>
    ${m.grupos.map((g, n) => `<p class="menu-grupo" id="menu-grupo-${n}" data-rotulo>${esc(g.titulo)}</p>
      <ul aria-labelledby="menu-grupo-${n}">${g.itens.map((i) => `<li>${link(i)}</li>`).join('')}</ul>`).join('')}
    <div class="menu-destaque" data-rotulo-bloco>
      <p><strong>${admin ? 'Validação' : 'Nova ideia?'}</strong>
        ${admin ? '<span id="menu-destaque-texto">Solicitações esperando revisão.</span>' : 'Monte outra solução no site e acompanhe tudo por aqui.'}</p>
      <a href="${esc(m.fab.href)}"${externo(m.fab)}>${icone(m.fab.icone)}<span>${admin ? 'Revisar agora' : 'Montar nova solução'}</span></a>
    </div>
    <ul class="menu-util" aria-label="Conta e ajuda">
      <li>${link({ href: 'perfil.html', texto: 'Meu perfil', icone: 'perfil' })}</li>
      <li><a href="${esc(m.ajuda)}" target="_blank" rel="noopener" title="Ajuda pelo WhatsApp">${icone('ajuda')}<span data-rotulo>Ajuda</span></a></li>
      <li><button type="button" id="btn-sair" title="Sair">${icone('sair')}<span data-rotulo>Sair</span></button></li>
    </ul>
    <button type="button" id="btn-recolher" aria-pressed="${tablet ? 'false' : menuRecolhido()}" title="${tablet ? 'Expandir menu' : 'Recolher menu'}">${icone('recolher')}<span data-rotulo>${tablet ? 'Expandir menu' : 'Recolher menu'}</span></button>`;

  // ---- barra superior ----
  // a barra já existe vazia no HTML (espaço reservado, sem salto de layout)
  let topo = document.getElementById('barra-topo');
  if (!topo) { topo = document.createElement('header'); topo.id = 'barra-topo'; main.before(topo); }
  topo.innerHTML = `
    <a class="topo-marca" href="${paginaInicial(perfil)}" aria-label="CMKCOGIT, ir para o início"></a>
    <button type="button" id="btn-busca" aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K">
      ${icone('buscar')}<span>Buscar</span><kbd>Ctrl K</kbd></button>
    ${sinoHtml()}
    <div id="usuario">
      <button type="button" id="btn-usuario" aria-expanded="false" aria-controls="menu-usuario">
        <span class="avatar" aria-hidden="true">${esc(iniciais(perfil?.nome || perfil?.email))}</span>
        <span class="usuario-nome">${esc(perfil?.nome || 'Meu perfil')}<small>${admin ? 'Administrador' : 'Cliente'}</small></span>
        ${icone('abrir-menu')}
      </button>
      <div id="menu-usuario" hidden>
        <p><strong>${esc(perfil?.nome || '')}</strong><small>${esc(perfil?.email || '')}</small></p>
        <a href="perfil.html">${icone('perfil')} Meu perfil</a>
        <a href="${esc(m.ajuda)}" target="_blank" rel="noopener">${icone('ajuda')} Ajuda</a>
        <button type="button" data-sair>${icone('sair')} Sair</button>
      </div>
    </div>`;

  // ---- menu inferior (celular) + folha "Mais" ----
  document.getElementById('menu-inferior')?.remove();
  document.getElementById('folha-mais')?.remove();
  const porHref = Object.fromEntries(todos.map((i) => [i.href, i]));
  const inferior = document.createElement('nav');
  inferior.id = 'menu-inferior';
  inferior.setAttribute('aria-label', 'Navegação rápida');
  inferior.innerHTML = `<span class="inferior-indicador" aria-hidden="true"></span><ul>
    ${m.inferior.map((h) => (h === 'fab'
      ? `<li class="inferior-fab"><a href="${esc(m.fab.href)}"${externo(m.fab)} title="${esc(m.fab.texto)}">${icone(m.fab.icone)}<span>${esc(m.fab.curto)}<span class="so-leitor-tela">${esc(m.fab.complemento)}</span></span></a></li>`
      : `<li><a href="${esc(h)}"${corrente(h)}>${icone(porHref[h].icone)}<span>${esc(porHref[h].curto)}</span>${porHref[h].contador ? `<span class="inferior-contador" data-contador="${porHref[h].contador}" hidden></span>` : ''}</a></li>`)).join('')}
    <li><button type="button" id="btn-mais" aria-haspopup="dialog" aria-controls="folha-mais"${m.inferior.includes(atual) ? '' : ' aria-current="page"'}>${icone('mais')}<span>Mais</span></button></li>
  </ul>`;
  document.body.appendChild(inferior);

  const folha = document.createElement('dialog');
  folha.id = 'folha-mais';
  folha.setAttribute('aria-labelledby', 'folha-mais-titulo');
  folha.innerHTML = `
    <div class="folha-alca" aria-hidden="true"><span></span></div>
    <header><h2 id="folha-mais-titulo">Menu</h2>
      <button type="button" data-fechar aria-label="Fechar menu">${icone('fechar')}</button></header>
    <p class="folha-usuario"><span class="avatar" aria-hidden="true">${esc(iniciais(perfil?.nome || perfil?.email))}</span>
      <span><strong>${esc(perfil?.nome || '')}</strong><small>${esc(perfil?.email || '')}</small></span></p>
    <ul>
      ${todos.filter((i) => !m.inferior.includes(i.href)).map((i) => `<li>${link(i)}</li>`).join('')}
      <li>${link({ href: 'perfil.html', texto: 'Meu perfil', icone: 'perfil' })}</li>
      <li><a href="${esc(m.ajuda)}" target="_blank" rel="noopener">${icone('ajuda')}<span>Ajuda pelo WhatsApp</span></a></li>
      <li><button type="button" data-sair>${icone('sair')}<span>Sair</span></button></li>
    </ul>`;
  document.body.appendChild(folha);

  ligarShell(perfil, todos, m);
  // secundários (sino, tempo real, contador do admin) depois dos dados da página
  depoisDoPrincipal(() => {
    if (perfil) iniciarSino(perfil);
    if (admin) contarEmValidacao();
    contarMensagensNaoLidas();
    if (admin && window.AssistenteIA) window.AssistenteIA.montar(perfil); // js/assistente.js (só nas telas do admin)
  });
}

function depoisDoPrincipal(fn) {
  if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 1500 });
  else setTimeout(fn, 600);
}

// Admin: quantas solicitações esperam validação (menu e cartão de destaque)
async function contarEmValidacao() {
  const { count, error } = await db.from('solicitacoes').select('id', { count: 'exact', head: true }).eq('status', 'em_validacao');
  if (error || typeof count !== 'number') return;
  const cont = document.getElementById('menu-cont-validacao');
  if (cont) { cont.hidden = !count; cont.textContent = count > 99 ? '99+' : String(count); cont.setAttribute('aria-label', count + ' em validação'); }
  const texto = document.getElementById('menu-destaque-texto');
  if (texto) texto.textContent = count ? `${count} ${count === 1 ? 'solicitação espera' : 'solicitações esperam'} revisão.` : 'Nenhuma solicitação esperando revisão.';
}

// Mensagens não lidas (menu lateral, menu inferior e folha "Mais"). A tela de mensagens
// também chama ao ler uma conversa. Sem o sql/25 a função não existe: fica escondido.
async function contarMensagensNaoLidas() {
  const { data, error } = await db.rpc('mensagens_nao_lidas');
  const n = error ? 0 : Number(data) || 0;
  document.querySelectorAll('#menu-cont-mensagens, [data-contador="menu-cont-mensagens"]').forEach((el) => {
    el.hidden = !n;
    el.textContent = n > 99 ? '99+' : String(n);
    el.setAttribute('aria-label', n + (n === 1 ? ' mensagem não lida' : ' mensagens não lidas'));
  });
  return n;
}

let SHELL_GLOBAL = false;
function ligarShell(perfil, todos, m) {
  document.getElementById('btn-sair').addEventListener('click', sair);
  document.querySelectorAll('[data-sair]').forEach((b) => b.addEventListener('click', sair));
  document.getElementById('btn-recolher').addEventListener('click', (e) => {
    if (window.matchMedia('(max-width: 1023.98px)').matches) { // tablet: expande por cima do conteúdo
      const aberto = document.documentElement.classList.toggle('menu-aberto');
      e.currentTarget.setAttribute('aria-pressed', String(aberto));
      e.currentTarget.title = aberto ? 'Recolher menu' : 'Expandir menu';
      e.currentTarget.querySelector('[data-rotulo]').textContent = e.currentTarget.title;
      return;
    }
    const recolher = !menuRecolhido();
    document.documentElement.classList.toggle('menu-recolhido', recolher);
    e.currentTarget.setAttribute('aria-pressed', String(recolher));
    try { localStorage.setItem(CHAVE_MENU, recolher ? '1' : '0'); } catch (_) {}
  });

  // menu do usuário
  const btnUsuario = document.getElementById('btn-usuario');
  const menuUsuario = document.getElementById('menu-usuario');
  const abrirUsuario = (abrir) => { menuUsuario.hidden = !abrir; btnUsuario.setAttribute('aria-expanded', String(abrir)); };
  btnUsuario.addEventListener('click', () => {
    abrirUsuario(menuUsuario.hidden);
    if (!menuUsuario.hidden) menuUsuario.querySelector('a').focus();
  });
  menuUsuario.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { abrirUsuario(false); btnUsuario.focus(); }
  });

  // folha "Mais"
  const folha = document.getElementById('folha-mais');
  document.getElementById('btn-mais').addEventListener('click', () => abrirFolha(folha));
  folha.querySelector('[data-fechar]').addEventListener('click', () => fecharFolha(folha));
  folha.addEventListener('click', (e) => { if (e.target === folha) fecharFolha(folha); });
  folha.addEventListener('cancel', (e) => { e.preventDefault(); fecharFolha(folha); });
  arrastarParaFechar(folha);

  // indicador deslizante do menu inferior: nasce onde estava na tela anterior e desliza até a atual
  iniciarIndicador();

  // busca global
  const destinos = [
    ...todos.map((i) => ({ texto: i.texto, href: i.href, icone: i.icone, tipo: 'Ir para' })),
    { texto: 'Meu perfil', href: 'perfil.html', icone: 'perfil', tipo: 'Ir para' },
    { texto: m.fab.texto, href: m.fab.href, icone: m.fab.icone, tipo: 'Ação', externo: m.fab.externo },
    { texto: 'Ajuda pelo WhatsApp', href: m.ajuda, icone: 'whatsapp', tipo: 'Ação', externo: true }
  ];
  const buscaEm = ehAdmin(perfil)
    ? [{ rotulo: 'Solicitações', href: 'admin.html', icone: 'solicitacoes' }, { rotulo: 'Clientes', href: 'admin-clientes.html', icone: 'clientes' }, { rotulo: 'Quadros', href: 'admin-quadros.html', icone: 'quadros' }]
    : [{ rotulo: 'Minhas solicitações', href: 'continuar.html', icone: 'solicitacoes' }];
  document.getElementById('btn-busca').addEventListener('click', () => abrirBusca(destinos, buscaEm));

  if (SHELL_GLOBAL) return;
  SHELL_GLOBAL = true;
  document.addEventListener('click', (e) => {
    if (document.documentElement.classList.contains('menu-aberto') && !e.target.closest('#menu')) {
      document.documentElement.classList.remove('menu-aberto');
      document.getElementById('btn-recolher')?.setAttribute('aria-pressed', 'false');
    }
    const caixa = document.getElementById('usuario');
    const mu = document.getElementById('menu-usuario');
    if (mu && !mu.hidden && caixa && !caixa.contains(e.target)) {
      mu.hidden = true;
      document.getElementById('btn-usuario').setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (e) => {
    const alvo = e.target;
    const digitando = alvo && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName));
    if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !digitando)) {
      if (document.querySelector('dialog[open]:not(#busca-global)')) return;
      e.preventDefault();
      document.getElementById('btn-busca')?.click();
    }
  });
  window.addEventListener('resize', () => posicionarIndicador(), { passive: true });
  window.addEventListener('pagehide', guardarIndicador);
  // menu inferior: recolhe ao rolar para baixo, volta ao rolar para cima
  let ultimoY = window.scrollY;
  let agendado = false;
  window.addEventListener('scroll', () => {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      const nav = document.getElementById('menu-inferior');
      if (nav) nav.classList.toggle('recolhido', y > ultimoY + 4 && y > 120);
      if (y < ultimoY - 4 && nav) nav.classList.remove('recolhido');
      ultimoY = y;
      agendado = false;
    });
  }, { passive: true });
}

// Indicador do menu inferior (celular). Posição medida em relação à lista; "animar" desliza,
// senão vai direto (sem transição). Ao tocar num item ele já desliza antes da página trocar.
const CHAVE_INDICADOR = 'cmk_indicador_v1';
function posicionarIndicador(alvo = null, { animar = false } = {}) {
  const nav = document.getElementById('menu-inferior');
  if (!nav) return false;
  const ind = nav.querySelector('.inferior-indicador');
  const ativo = alvo || nav.querySelector('li:not(.inferior-fab) > [aria-current=page]');
  if (!ind) return false;
  if (!ativo) { ind.hidden = true; return false; }
  const a = ativo.getBoundingClientRect();
  const u = nav.querySelector('ul').getBoundingClientRect();
  if (!a.width) return false;
  ind.hidden = false;
  ind.classList.toggle('sem-transicao', !animar || MOVIMENTO_REDUZIDO);
  ind.style.width = a.width + 'px';
  ind.style.transform = `translateX(${a.left - u.left}px)`;
  if (!animar) { void ind.offsetWidth; ind.classList.remove('sem-transicao'); }
  return true;
}
function guardarIndicador() {
  const ind = document.querySelector('#menu-inferior .inferior-indicador');
  try {
    if (ind && !ind.hidden && ind.style.transform) sessionStorage.setItem(CHAVE_INDICADOR, JSON.stringify({ t: ind.style.transform, w: ind.style.width }));
    else sessionStorage.removeItem(CHAVE_INDICADOR);
  } catch (_) {}
}
function iniciarIndicador() {
  const nav = document.getElementById('menu-inferior');
  if (!nav || !window.matchMedia('(max-width: 767.98px)').matches) { posicionarIndicador(); return; }
  const ind = nav.querySelector('.inferior-indicador');
  let antes = null;
  try { antes = JSON.parse(sessionStorage.getItem(CHAVE_INDICADOR)); } catch (_) {}
  if (antes && antes.t && !MOVIMENTO_REDUZIDO && nav.querySelector('li:not(.inferior-fab) > [aria-current=page]')) {
    ind.hidden = false;
    ind.classList.add('sem-transicao');
    ind.style.transform = antes.t;
    ind.style.width = antes.w;
    void ind.offsetWidth;
    requestAnimationFrame(() => requestAnimationFrame(() => posicionarIndicador(null, { animar: true })));
  } else {
    posicionarIndicador();
  }
  // as fontes mudam a largura dos itens: reposiciona sem animar
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => posicionarIndicador(null, { animar: true }));
  // toque: o indicador vai para o item na hora (a página troca em seguida)
  nav.addEventListener('click', (e) => {
    const link = e.target.closest('li:not(.inferior-fab) > a[href]');
    if (!link || link.target === '_blank' || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
    if (link.getAttribute('aria-current') === 'page') return;
    nav.querySelectorAll('li > [aria-current=page]').forEach((x) => x.removeAttribute('aria-current'));
    link.setAttribute('aria-current', 'page');
    posicionarIndicador(link, { animar: true });
  });
}

// Folha inferior (<dialog>): abre com showModal (foco preso, ESC) e fecha com animação
function abrirFolha(folha) {
  folha.classList.remove('fechando');
  folha.style.removeProperty('--arraste');
  folha.showModal();
}
function fecharFolha(folha) {
  if (!folha.open || folha.classList.contains('fechando')) return;
  const reduzir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduzir) { folha.close(); return; }
  folha.classList.add('fechando');
  setTimeout(() => { folha.classList.remove('fechando'); folha.style.removeProperty('--arraste'); folha.close(); }, 220);
}
function arrastarParaFechar(folha) {
  const alca = folha.querySelector('.folha-alca');
  let inicio = null;
  alca.addEventListener('pointerdown', (e) => { inicio = e.clientY; alca.setPointerCapture(e.pointerId); folha.classList.add('arrastando'); });
  alca.addEventListener('pointermove', (e) => {
    if (inicio === null) return;
    folha.style.setProperty('--arraste', Math.max(0, e.clientY - inicio) + 'px');
  });
  const soltar = (e) => {
    if (inicio === null) return;
    const dist = e.clientY - inicio;
    inicio = null;
    folha.classList.remove('arrastando');
    if (dist > 80) fecharFolha(folha); else folha.style.removeProperty('--arraste');
  };
  alca.addEventListener('pointerup', soltar);
  alca.addEventListener('pointercancel', soltar);
}

// Busca global (Ctrl+K ou "/"): páginas, ações e "buscar X em ..."
function abrirBusca(destinos, buscaEm) {
  let dlg = document.getElementById('busca-global');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'busca-global';
    dlg.setAttribute('aria-label', 'Buscar na plataforma');
    dlg.innerHTML = `
      <form method="dialog" role="search">
        ${icone('buscar')}
        <label class="so-leitor-tela" for="busca-global-campo">Buscar páginas, ações, códigos ou clientes</label>
        <input type="search" id="busca-global-campo" autocomplete="off" placeholder="Buscar páginas, códigos, clientes..."
          role="combobox" aria-expanded="true" aria-controls="busca-global-lista" aria-autocomplete="list">
        <kbd>Esc</kbd>
      </form>
      <ul id="busca-global-lista" role="listbox" aria-label="Resultados"></ul>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => document.getElementById('btn-busca')?.focus());
  }
  const campo = dlg.querySelector('input');
  const lista = dlg.querySelector('ul');
  let ativo = 0;
  const normal = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function resultados() {
    const q = campo.value.trim();
    const nq = normal(q);
    const achados = destinos.filter((d) => !nq || normal(d.texto).includes(nq));
    const extras = q ? buscaEm.map((b) => ({ texto: `Buscar “${q}” em ${b.rotulo}`, href: b.href + '?busca=' + encodeURIComponent(q), icone: b.icone, tipo: 'Busca' })) : [];
    return [...achados, ...extras];
  }
  function render() {
    const itens = resultados();
    ativo = Math.min(ativo, Math.max(0, itens.length - 1));
    lista.innerHTML = itens.length ? itens.map((d, n) => `
      <li role="option" id="busca-op-${n}" aria-selected="${n === ativo}">
        <a href="${esc(d.href)}"${d.externo ? ' target="_blank" rel="noopener"' : ''} tabindex="-1">${icone(d.icone)}<span>${esc(d.texto)}</span><small>${esc(d.tipo)}</small></a></li>`).join('')
      : '<li data-vazio>Nada encontrado. Tente o código (ex.: PLN-2026-0013) ou o nome do cliente.</li>';
    campo.setAttribute('aria-activedescendant', itens.length ? 'busca-op-' + ativo : '');
  }
  campo.oninput = () => { ativo = 0; render(); };
  campo.onkeydown = (e) => {
    const n = lista.querySelectorAll('[role=option]').length;
    if (e.key === 'ArrowDown') { e.preventDefault(); ativo = (ativo + 1) % Math.max(n, 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); ativo = (ativo - 1 + n) % Math.max(n, 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); lista.querySelector(`#busca-op-${ativo} a`)?.click(); dlg.close(); }
    else if (e.key === 'Escape') { e.preventDefault(); dlg.close(); } // o campo de busca consumiria o primeiro Esc
  };
  campo.value = '';
  ativo = 0;
  render();
  dlg.showModal();
  campo.focus();
}

// Menu lateral recolhido (só no desktop; preferência deste navegador)
const CHAVE_MENU = 'cmk_menu_recolhido';
function menuRecolhido() {
  return document.documentElement.classList.contains('menu-recolhido');
}
try { if (localStorage.getItem(CHAVE_MENU) === '1') document.documentElement.classList.add('menu-recolhido'); } catch (_) {}

// Ícone do Bootstrap Icons pelo NOME DO CONCEITO (assets/icons/icones.json).
// Decorativo por padrão; botão só com ícone precisa de aria-label próprio.
function icone(nome, classe = '') {
  return `<svg class="i${classe ? ' ' + classe : ''}" aria-hidden="true" focusable="false"><use href="/assets/icons/bi.svg#${nome}"></use></svg>`;
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
const INTERVALO_SINO = 45000;

function sinoHtml() {
  return `<div id="sino">
      <button type="button" id="btn-sino" aria-expanded="false" aria-controls="painel-sino" aria-label="Notificações">
        ${icone('notificacoes', 'i-sino')}<span id="sino-contador" hidden></span>
      </button>
      <section id="painel-sino" aria-labelledby="painel-sino-titulo" hidden>
        <header>
          <h2 id="painel-sino-titulo">Notificações</h2>
          <button type="button" id="sino-marcar-todas" hidden>Marcar todas como lidas</button>
        </header>
        <ul id="sino-lista" aria-live="polite"><li data-esqueleto-linha></li><li data-esqueleto-linha></li><li data-esqueleto-linha></li></ul>
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
      contarMensagensNaoLidas();
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
  Sino.atualizar();
  if (Sino.ligado) return; // menu remontado (ex.: nome alterado): o resto já está ligado
  Sino.ligado = true;
  document.addEventListener('click', (e) => {
    const p = document.getElementById('painel-sino');
    if (p && !p.hidden && !document.getElementById('sino').contains(e.target)) Sino.abrir(false);
  });
  document.addEventListener('keydown', (e) => {
    const p = document.getElementById('painel-sino');
    if (e.key === 'Escape' && p && !p.hidden) { Sino.abrir(false); document.getElementById('btn-sino').focus(); }
  });

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

// Carregamento da marca: o C do ícone se desenha em volta do MK (mesmo desenho do guia de movimento)
const SVG_CARREGANDO = '<svg viewBox="0 0 1010 1000" aria-hidden="true" focusable="false"><path class="arco" d="M815.5 781.5A438 438 0 1 1 815.5 218.5"/><g class="mk"><path d="M230 750V250L450 470L670 250V750H590V431.8L450 571.8L310 431.8V750Z"/><path d="M670 469.1L889.1 250H990.9L740.9 500L990.9 750H889.1L690 550.9L670 570.9Z"/></g></svg>';
function carregandoCogit(texto) {
  return `<div class="cogit-carregando" role="status">${SVG_CARREGANDO}<span>${esc(texto || 'Carregando...')}</span></div>`;
}
// Tela inteira (ex.: depois de entrar, enquanto a próxima página abre)
function telaCarregando(texto) {
  let el = document.getElementById('tela-carregando');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tela-carregando';
    document.body.appendChild(el);
  }
  el.innerHTML = carregandoCogit(texto);
  return el;
}

// Botão em andamento: desabilita (evita clique duplo), mostra o indicador e troca o texto
const CONTEUDO_BOTAO = new WeakMap();
function ocupado(botao, sim, textoCarregando) {
  if (!botao) return;
  if (sim) {
    CONTEUDO_BOTAO.set(botao, botao.innerHTML); // guarda ícone + texto
    if (textoCarregando) botao.textContent = textoCarregando;
    botao.disabled = true;
    botao.setAttribute('aria-busy', 'true');
  } else {
    if (CONTEUDO_BOTAO.has(botao)) botao.innerHTML = CONTEUDO_BOTAO.get(botao);
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
