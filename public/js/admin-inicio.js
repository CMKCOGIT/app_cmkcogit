// =====================================================================
// admin-inicio.js — Início do admin = painel de gestão.
// Tudo vem agregado do banco (admin_dashboard e admin_vendas_periodo, sql/13);
// faturamento conta só pagamentos confirmados ("pago"). Gráficos em SVG/HTML
// puro (a CSP não permite bibliotecas de fora).
// =====================================================================
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;

  document.getElementById('saudacao').textContent = 'Olá, ' + (perfil.nome || 'admin') + '!';

  const CHAVE_PERIODO = 'cogit_painel_periodo_v1';
  const botoes = [...document.querySelectorAll('[data-periodo]')];
  const personalizado = document.getElementById('periodo-personalizado');
  const inpInicio = document.getElementById('data-inicio');
  const inpFim = document.getElementById('data-fim');
  let periodo = lerPeriodoSalvo();
  let dados = null;
  let pedido = 0;

  botoes.forEach((b) => b.addEventListener('click', () => {
    periodo = { tipo: b.dataset.periodo, inicio: inpInicio.value, fim: inpFim.value };
    marcarBotoes();
    if (periodo.tipo === 'personalizado') {
      if (!inpInicio.value) inpInicio.value = isoData(somarDias(hoje(), -29));
      if (!inpFim.value) inpFim.value = isoData(hoje());
      inpInicio.focus();
      return;
    }
    carregar();
  }));
  document.getElementById('filtro-periodo').addEventListener('submit', (e) => {
    e.preventDefault();
    periodo = { tipo: 'personalizado', inicio: inpInicio.value, fim: inpFim.value };
    carregar();
  });
  document.getElementById('btn-exportar').addEventListener('click', exportarCsv);

  if (periodo.tipo === 'personalizado') { inpInicio.value = periodo.inicio || ''; inpFim.value = periodo.fim || ''; }
  marcarBotoes();
  await carregar();

  let largura = 0;
  new ResizeObserver(() => {
    const g = document.getElementById('grafico-faturamento');
    if (dados && Math.abs(g.clientWidth - largura) > 8) { largura = g.clientWidth; graficoFaturamento(dados); }
  }).observe(document.getElementById('grafico-faturamento'));

  // ---------------- período ----------------
  function intervalo() {
    const fim = hoje();
    switch (periodo.tipo) {
      case 'hoje': return { inicio: fim, fim };
      case '7d': return { inicio: somarDias(fim, -6), fim };
      case 'mes': return { inicio: new Date(fim.getFullYear(), fim.getMonth(), 1), fim };
      case 'personalizado': {
        const i = dataDeIso(periodo.inicio);
        const f = dataDeIso(periodo.fim);
        return i && f ? { inicio: i, fim: f } : null;
      }
      default: return { inicio: somarDias(fim, -29), fim };
    }
  }

  function marcarBotoes() {
    botoes.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.periodo === periodo.tipo)));
    personalizado.hidden = periodo.tipo !== 'personalizado';
  }

  function lerPeriodoSalvo() {
    try {
      const p = JSON.parse(localStorage.getItem(CHAVE_PERIODO));
      if (p && ['hoje', '7d', '30d', 'mes', 'personalizado'].includes(p.tipo)) return p;
    } catch (_) {}
    return { tipo: '30d' };
  }

  // ---------------- carregar ----------------
  async function carregar() {
    mostrarErro('');
    const iv = intervalo();
    if (!iv) return mostrarErro('Escolha as duas datas do período.');
    if (iv.fim < iv.inicio) return mostrarErro('A data final precisa ser depois da inicial.');
    try { localStorage.setItem(CHAVE_PERIODO, JSON.stringify(periodo)); } catch (_) {}

    const meu = ++pedido;
    esqueleto();
    const { data, error } = await db.rpc('admin_dashboard', { p_inicio: isoData(iv.inicio), p_fim: isoData(iv.fim) });
    if (meu !== pedido) return; // o admin trocou o período enquanto carregava
    if (error) {
      mostrarErro(/admin_dashboard|function/i.test(error.message)
        ? 'O painel ainda não foi instalado no banco: rode o sql/13_painel_admin.sql no Supabase.'
        : 'Não foi possível carregar o painel: ' + error.message);
      limparEsqueleto();
      return;
    }
    dados = data;
    render(data);
  }

  function esqueleto() {
    document.getElementById('kpis').innerHTML = '<li data-esqueleto></li>'.repeat(5);
    document.getElementById('kpis-projetos').innerHTML = '<li data-esqueleto></li>'.repeat(4);
    ['grafico-faturamento', 'barras-solucoes', 'top-clientes', 'lista-atividades'].forEach((id) => {
      const el = document.getElementById(id);
      el.setAttribute('data-carregando', '');
      el.innerHTML = '';
    });
    document.getElementById('mais-vendido').hidden = true;
  }
  function limparEsqueleto() {
    document.querySelectorAll('[data-carregando]').forEach((el) => el.removeAttribute('data-carregando'));
    document.getElementById('kpis').innerHTML = '';
    document.getElementById('kpis-projetos').innerHTML = '';
  }

  function render(d) {
    document.querySelectorAll('[data-carregando]').forEach((el) => el.removeAttribute('data-carregando'));
    const p = d.periodo;
    document.getElementById('periodo-rotulo').textContent =
      `${fmtData(p.inicio)} a ${fmtData(p.fim)} · comparado com ${fmtData(p.anterior_inicio)} a ${fmtData(p.anterior_fim)}`;

    maisVendido(d.mais_vendido);
    kpis(d);
    kpisProjetos(d.projetos || {});
    graficoFaturamento(d);
    solucoes(d.por_solucao || [], Number(d.faturamento));
    topClientes(d.top_clientes || []);
    atividades(d.atividades || []);
  }

  // ---------------- números ----------------
  function variacao(atual, anterior, rotuloAnterior) {
    atual = Number(atual); anterior = Number(anterior);
    if (!anterior) return atual ? `<small data-delta="neutro">sem vendas no período anterior</small>` : '';
    const pct = Math.round((atual - anterior) / anterior * 100);
    const dir = pct > 0 ? 'sobe' : pct < 0 ? 'desce' : 'neutro';
    const seta = pct > 0 ? '▲' : pct < 0 ? '▼' : '=';
    return `<small data-delta="${dir}"><span aria-hidden="true">${seta}</span> ${pct > 0 ? '+' : ''}${pct}% ${esc(rotuloAnterior)}</small>`;
  }

  function kpis(d) {
    const vendas = Number(d.vendas);
    const ticket = vendas ? Number(d.faturamento) / vendas : 0;
    const sol = d.solicitacoes || { criadas: 0, pagas: 0 };
    const conversao = sol.criadas ? Math.round(sol.pagas / sol.criadas * 100) : null;
    const pend = d.pendentes || { quantidade: 0, valor: 0 };
    document.getElementById('kpis').innerHTML = `
      <li data-destaque><span>Faturamento</span><strong>${brl(d.faturamento)}</strong>${variacao(d.faturamento, d.faturamento_anterior, 'vs. período anterior')}</li>
      <li><span>Vendas</span><strong>${vendas}</strong>${variacao(vendas, d.vendas_anterior, 'vs. período anterior')}</li>
      <li><span>Ticket médio</span><strong>${vendas ? brl(ticket) : '—'}</strong><small>faturamento ÷ vendas</small></li>
      <li><span>Taxa de conversão</span><strong>${conversao == null ? '—' : conversao + '%'}</strong>
        <small>${Number(sol.pagas)} de ${Number(sol.criadas)} solicitações do período já pagas</small></li>
      <li><a href="admin.html"><span>Pagamentos pendentes</span><strong>${brl(pend.valor)}</strong>
        <small>${Number(pend.quantidade)} ${Number(pend.quantidade) === 1 ? 'cobrança aguardando' : 'cobranças aguardando'} pagamento</small></a></li>`;
  }

  function kpisProjetos(pr) {
    const item = (filtro, rotulo, valor, extra, alerta) => `<li${alerta && Number(valor) ? ` data-alerta="${alerta}"` : ''}>
        <a href="admin-clientes.html?filtro=${filtro}"><span>${rotulo}</span><strong>${Number(valor) || 0}</strong>${extra ? `<small>${extra}</small>` : ''}</a></li>`;
    document.getElementById('kpis-projetos').innerHTML =
      item('andamento', 'Em andamento', pr.em_andamento) +
      item('concluido', 'Concluídos', pr.concluidos, `${Number(pr.concluidos_periodo) || 0} no período`) +
      item('atrasado', 'Atrasados', pr.atrasados, 'prazo de entrega vencido', 'perigo') +
      item('prazo7', 'Entrega nos próximos 7 dias', pr.prazo_7_dias, 'prazo chegando', 'atencao');
  }

  function maisVendido(m) {
    const box = document.getElementById('mais-vendido');
    if (!m) { box.hidden = true; return; }
    box.innerHTML = `
      <small>Mais vendido no período</small>
      <h2 id="mais-vendido-titulo">${esc(m.solucao)}</h2>
      <p><strong>${Number(m.quantidade)}</strong> ${Number(m.quantidade) === 1 ? 'venda' : 'vendas'} · <strong>${brl(m.valor)}</strong></p>`;
    box.hidden = false;
  }

  // ---------------- gráfico de faturamento (linha + área, SVG) ----------------
  function rotuloPeriodo(iso, gran, longo) {
    const dt = dataDeIso(iso);
    if (gran === 'month') return dt.toLocaleDateString('pt-BR', { month: longo ? 'long' : 'short', year: '2-digit' }).replace('.', '');
    const dia = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return gran === 'week' ? (longo ? 'Semana de ' : 'sem. ') + dia : dia;
  }

  function graficoFaturamento(d) {
    const caixa = document.getElementById('grafico-faturamento');
    const serie = (d.serie || []).map((s) => ({ ...s, valor: Number(s.valor), vendas: Number(s.vendas) }));
    const gran = d.periodo.granularidade;
    document.querySelector('#tabela-faturamento tbody').innerHTML = serie.length ? serie.map((s) =>
      `<tr><td>${esc(rotuloPeriodo(s.periodo, gran, true))}</td><td>${s.vendas}</td><td>${brl(s.valor)}</td></tr>`).join('')
      : '<tr><td colspan="3">Sem dados no período.</td></tr>';

    if (!serie.some((s) => s.valor > 0)) {
      caixa.innerHTML = '<p data-vazio>Nenhuma venda confirmada no período.</p>';
      return;
    }

    const W = Math.max(caixa.clientWidth, 280);
    const H = W < 500 ? 220 : 260;
    const m = { t: 16, r: 16, b: 32, l: W < 500 ? 52 : 68 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const passoY = passoBonito(Math.max(...serie.map((s) => s.valor)) / 4);
    const max = passoY * Math.max(1, Math.ceil(Math.max(...serie.map((s) => s.valor)) / passoY));
    const x = (i) => m.l + (serie.length === 1 ? iw / 2 : (i / (serie.length - 1)) * iw);
    const y = (v) => m.t + ih - (v / max) * ih;

    const ticks = [];
    for (let t = 0; t <= max + 1e-9; t += passoY) ticks.push(t);
    const grade = ticks.map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" data-grade/>
      <text x="${m.l - 8}" y="${y(t)}" dy="0.32em" text-anchor="end">${esc(compacto(t))}</text>`).join('');
    const passo = Math.max(1, Math.ceil(serie.length / (W < 500 ? 4 : 7)));
    const rotulosX = serie.map((s, i) => (i % passo === 0 || i === serie.length - 1) && !(i !== serie.length - 1 && serie.length - 1 - i < passo / 2)
      ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(rotuloPeriodo(s.periodo, gran))}</text>` : '').join('');
    const linha = serie.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.valor).toFixed(1)}`).join(' ');
    const area = `${linha} L${x(serie.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
    const ult = serie.length - 1;

    caixa.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" tabindex="0"
           aria-label="Faturamento por ${gran === 'day' ? 'dia' : gran === 'week' ? 'semana' : 'mês'}: total ${brl(d.faturamento)}. Use as setas para percorrer os valores.">
        ${grade}${rotulosX}
        <path d="${area}" data-area/>
        <path d="${linha}" data-linha/>
        <circle cx="${x(ult)}" cy="${y(serie[ult].valor)}" r="4" data-ponto/>
        <g data-mira hidden><line y1="${m.t}" y2="${m.t + ih}"/><circle r="5"/></g>
        <rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" data-alvo/>
      </svg>`;

    const svg = caixa.querySelector('svg');
    const mira = svg.querySelector('[data-mira]');
    let atual = -1;
    const mostrar = (i) => {
      atual = Math.max(0, Math.min(ult, i));
      const s = serie[atual];
      mira.hidden = false;
      mira.querySelector('line').setAttribute('x1', x(atual));
      mira.querySelector('line').setAttribute('x2', x(atual));
      mira.querySelector('circle').setAttribute('cx', x(atual));
      mira.querySelector('circle').setAttribute('cy', y(s.valor));
      const r = svg.getBoundingClientRect();
      const escala = r.width / W;
      Dica.mostrar(`<strong>${esc(rotuloPeriodo(s.periodo, gran, true))}</strong><br>${brl(s.valor)} · ${s.vendas} ${s.vendas === 1 ? 'venda' : 'vendas'}`,
        r.left + x(atual) * escala, r.top + y(s.valor) * escala);
    };
    const esconder = () => { mira.hidden = true; Dica.esconder(); };
    svg.querySelector('[data-alvo]').addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left) * (W / r.width);
      mostrar(serie.length === 1 ? 0 : Math.round(((px - m.l) / iw) * ult));
    });
    svg.addEventListener('pointerleave', esconder);
    svg.addEventListener('blur', esconder);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        mostrar(atual < 0 ? ult : atual + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key === 'Escape') esconder();
    });
  }

  // ---------------- o que vendemos (barras horizontais + tabela) ----------------
  function solucoes(lista, total) {
    const ol = document.getElementById('barras-solucoes');
    const corpo = document.querySelector('#tabela-solucoes tbody');
    if (!lista.length) {
      ol.innerHTML = '<li data-vazio>Nenhuma venda no período.</li>';
      corpo.innerHTML = '<tr><td colspan="5">Nenhuma venda no período.</td></tr>';
      return;
    }
    const max = Math.max(...lista.map((s) => Number(s.valor)));
    const pct = (v) => (total ? Math.round(Number(v) / total * 100) : 0);
    ol.innerHTML = lista.map((s, i) => `
      <li data-i="${i}">
        <span data-rotulo>${esc(s.solucao)}${s.categoria === 'funcionalidade' ? ' <small>extra</small>' : ''}</span>
        <span data-barra><span style="width:${Math.max(2, Number(s.valor) / max * 100).toFixed(1)}%"></span></span>
        <span data-valor>${brl(s.valor)} <small>· ${Number(s.quantidade)} ${Number(s.quantidade) === 1 ? 'venda' : 'vendas'}</small></span>
      </li>`).join('');
    ol.querySelectorAll('li[data-i]').forEach((li) => {
      const s = lista[Number(li.dataset.i)];
      li.addEventListener('pointermove', (e) => Dica.mostrar(
        `<strong>${esc(s.solucao)}</strong><br>${Number(s.quantidade)} ${Number(s.quantidade) === 1 ? 'venda' : 'vendas'} · ${brl(s.valor)} · ${pct(s.valor)}% do faturamento`,
        e.clientX, e.clientY));
      li.addEventListener('pointerleave', () => Dica.esconder());
    });
    corpo.innerHTML = lista.map((s) => `<tr><td>${esc(s.solucao)}</td><td>${s.categoria === 'funcionalidade' ? 'Funcionalidade extra' : 'Solução'}</td>
      <td>${Number(s.quantidade)}</td><td>${brl(s.valor)}</td><td>${pct(s.valor)}%</td></tr>`).join('');
  }

  function topClientes(lista) {
    const ol = document.getElementById('top-clientes');
    if (!lista.length) { ol.innerHTML = '<li data-vazio>Nenhuma venda no período.</li>'; return; }
    const max = Number(lista[0].valor) || 1;
    ol.innerHTML = lista.map((c) => `
      <li>
        <a href="admin-clientes.html?busca=${encodeURIComponent(c.email || c.nome || '')}">${esc(c.nome || c.email || 'Cliente')}</a>
        <small>${esc(c.email || '')} · ${Number(c.compras)} ${Number(c.compras) === 1 ? 'compra' : 'compras'}</small>
        <span data-barra><span style="width:${(Number(c.valor) / max * 100).toFixed(1)}%"></span></span>
        <strong>${brl(c.valor)}</strong>
      </li>`).join('');
  }

  function atividades(lista) {
    const ul = document.getElementById('lista-atividades');
    if (!lista.length) { ul.innerHTML = '<li data-vazio>Nada por aqui ainda.</li>'; return; }
    const ROTULO = { pagamento: 'Pagamento', arquivo: 'Arquivo', solicitacao: 'Solicitação' };
    ul.innerHTML = lista.map((a) => `
      <li data-tipo="${esc(a.tipo)}">
        <span data-etiqueta>${esc(ROTULO[a.tipo] || a.tipo)}</span>
        ${linkInterno(a.link) ? `<a href="${esc(a.link)}">${esc(a.titulo)}</a>` : `<strong>${esc(a.titulo)}</strong>`}
        <p>${esc(a.detalhe || '')}</p>
        <small>${esc(tempoRelativo(a.quando))}</small>
      </li>`).join('');
  }

  // ---------------- exportar CSV (vendas confirmadas do período) ----------------
  async function exportarCsv() {
    const iv = intervalo();
    if (!iv) return mostrarErro('Escolha as duas datas do período.');
    const botao = document.getElementById('btn-exportar');
    botao.disabled = true;
    mostrarErro('');
    const { data, error } = await db.rpc('admin_vendas_periodo', { p_inicio: isoData(iv.inicio), p_fim: isoData(iv.fim) });
    botao.disabled = false;
    if (error) return mostrarErro('Não foi possível exportar: ' + error.message);

    const linhas = [['Data', 'Cliente', 'E-mail', 'Solução', 'Tipo', 'Descrição', 'Projeto', 'Método', 'Valor (R$)']].concat(
      data.map((v) => [
        new Date(v.pago_em).toLocaleString('pt-BR'), v.cliente_nome, v.cliente_email, v.solucao,
        v.categoria === 'funcionalidade' ? 'Funcionalidade extra' : 'Solução', v.descricao, v.projeto_codigo,
        rotulo('metodo', v.metodo), Number(v.valor).toFixed(2).replace('.', ',')
      ]));
    const total = data.reduce((t, v) => t + Number(v.valor), 0);
    linhas.push([], ['Total', '', '', '', '', '', '', String(data.length) + ' vendas', total.toFixed(2).replace('.', ',')]);
    // ";" e BOM: abre certo no Excel em português
    const csv = '﻿' + linhas.map((l) => l.map(celulaCsv).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `vendas_${isoData(iv.inicio)}_a_${isoData(iv.fim)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    avisar(data.length ? `CSV com ${data.length} ${data.length === 1 ? 'venda' : 'vendas'} exportado.` : 'Nenhuma venda no período — o CSV saiu só com o cabeçalho.');
  }
})();

// Célula de CSV com aspas e sem fórmula (evita injeção ao abrir no Excel)
function celulaCsv(v) {
  let t = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}

// Datas locais (o período é o dia do calendário de quem está vendo)
function hoje() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function somarDias(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function isoData(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function dataDeIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// Eixo: passo "redondo" (1, 2, 2,5, 5 × 10^n) e valores compactos (R$ 1,2 mil)
function passoBonito(v) {
  if (!(v > 0)) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((f) => f * base).find((t) => t >= v);
}
function compacto(v) {
  if (v >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
  if (v >= 1e3) return 'R$ ' + (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return 'R$ ' + Math.round(v);
}

// Tooltip único dos gráficos (fica preso à janela)
const Dica = {
  el: null,
  mostrar(html, x, y) {
    this.el = this.el || document.getElementById('dica-grafico');
    this.el.innerHTML = html;
    this.el.hidden = false;
    const r = this.el.getBoundingClientRect();
    const esquerda = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8);
    const topo = y - r.height - 14 < 8 ? y + 18 : y - r.height - 14;
    this.el.style.left = esquerda + 'px';
    this.el.style.top = topo + 'px';
  },
  esconder() { if (this.el) this.el.hidden = true; }
};
