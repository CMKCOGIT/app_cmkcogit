// =====================================================================
// funcionalidades.js — o cliente escolhe um projeto, escolhe a funcionalidade
// e paga pelo Mercado Pago. O preço vem do catálogo (função SQL
// solicitar_funcionalidade); quando o pagamento é aprovado o pedido vira "Paga".
// =====================================================================
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;

  const select = document.getElementById('projeto');
  const lista = document.getElementById('lista-funcionalidades');
  document.getElementById('falar-conosco').href = linkWhatsApp(
    `Olá! Sou ${perfil.nome || 'cliente'} (${perfil.email || ''}) e quero uma funcionalidade nova no meu projeto.`
  );

  const [projs, cat] = await Promise.all([
    db.from('projetos').select('id, nome, codigo, status_projeto, cliente_id').neq('status_projeto', 'cancelado').order('created_at', { ascending: false }),
    db.from('funcionalidades').select('*').eq('ativo', true).order('preco')
  ]);
  if (projs.error || cat.error) {
    mostrarErro('Não foi possível carregar: ' + (projs.error || cat.error).message);
    lista.innerHTML = '';
    return;
  }
  // admin enxerga projetos de todos; aqui cada um compra só para os próprios
  const meus = projs.data.filter((p) => p.cliente_id === perfil.id);
  const pedidoItem = document.getElementById('pedido-item');
  const btnPagar = document.getElementById('btn-pagar-pedido');
  const busca = document.getElementById('busca');
  lista.removeAttribute('aria-busy');
  document.getElementById('barra-catalogo').addEventListener('submit', (e) => e.preventDefault());
  if (!meus.length) {
    select.innerHTML = '<option value="">Nenhum projeto</option>';
    select.disabled = true;
    lista.innerHTML = `<p data-vazio>Você ainda não tem um projeto ativo. As funcionalidades extras ficam disponíveis depois da primeira compra.<br>
      <a href="${esc(urlSite('monte-sua-solucao.html'))}">Monte sua solução</a></p>`;
    return;
  }
  select.innerHTML = meus.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)}${p.codigo ? ' (' + esc(p.codigo) + ')' : ''}</option>`).join('');
  const params = new URLSearchParams(window.location.search);
  if (params.get('projeto') && meus.some((p) => p.id === params.get('projeto'))) select.value = params.get('projeto');
  // vinda de uma dica do Início: já escolhe a funcionalidade sugerida
  let escolhida = cat.data.find((f) => f.id === params.get('f')) || null;
  let categoria = 'todas';
  let contratadas = [];

  const categorias = ['todas', ...new Set(cat.data.map(categoriaDe))];
  const filtros = document.getElementById('filtro-categoria');
  filtros.innerHTML = categorias.map((c) => `<button type="button" data-categoria="${esc(c)}" aria-pressed="${c === 'todas'}">${c === 'todas' ? 'Todas' : esc(c)}</button>`).join('');
  filtros.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    categoria = b.dataset.categoria;
    filtros.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderCatalogo();
  }));
  busca.addEventListener('input', renderCatalogo);
  select.addEventListener('change', carregarContratadas);
  btnPagar.addEventListener('click', adquirir);
  await carregarContratadas();

  function statusDe(fid) {
    const s = contratadas.filter((c) => c.funcionalidade_id === fid).map((c) => c.status);
    if (s.some((x) => ['paga', 'em_andamento', 'entregue'].includes(x))) return 'contratada';
    if (s.includes('aguardando_pagamento')) return 'aguardando';
    return null;
  }

  async function carregarContratadas() {
    const { data, error } = await db.from('projeto_funcionalidades').select('funcionalidade_id, status').eq('projeto_id', select.value);
    if (error) return mostrarErro(error.message);
    contratadas = data || [];
    if (escolhida && statusDe(escolhida.id) === 'contratada') escolhida = null;
    renderCatalogo();
    renderPedido();
  }

  function renderCatalogo() {
    const normal = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const q = normal(busca.value.trim());
    const visiveis = cat.data.filter((f) => (categoria === 'todas' || categoriaDe(f) === categoria)
      && (!q || normal(f.nome).includes(q) || normal(f.descricao).includes(q)));
    if (!cat.data.length) { lista.innerHTML = '<p data-vazio>Nenhuma funcionalidade disponível no momento.</p>'; return; }
    if (!visiveis.length) { lista.innerHTML = '<p data-vazio>Nada encontrado com esse filtro.</p>'; return; }
    lista.innerHTML = visiveis.map((f) => {
      const st = statusDe(f.id);
      const sel = escolhida && escolhida.id === f.id;
      return `<article class="func-card"${sel ? ' aria-current="true"' : ''}>
          <span class="func-icone" aria-hidden="true">${icone(ICONE_FUNC[f.slug] || 'adquirir')}</span>
          <p class="func-categoria">${esc(categoriaDe(f))}</p>
          <h2>${esc(f.nome)}</h2>
          ${f.descricao ? `<p>${esc(f.descricao)}</p>` : ''}
          <footer>
            <p class="sol-valor"><small>Investimento</small><strong>${brl(f.preco)}</strong></p>
            ${st === 'contratada'
              ? `<span data-etiqueta="ok">${icone('concluido')} Já contratada</span>`
              : `<button type="button" data-escolher="${esc(f.id)}" aria-pressed="${sel}">${sel ? icone('concluido') + ' Escolhida' : icone('adicionar') + (st === 'aguardando' ? ' Continuar' : ' Adicionar')}</button>`}
          </footer>
        </article>`;
    }).join('');
    lista.querySelectorAll('[data-escolher]').forEach((b) => b.addEventListener('click', () => {
      escolhida = cat.data.find((f) => f.id === b.dataset.escolher);
      renderCatalogo();
      renderPedido();
      if (window.matchMedia('(max-width: 1279.98px)').matches) document.getElementById('resumo-pedido').scrollIntoView({ behavior: MOVIMENTO_REDUZIDO ? 'auto' : 'smooth', block: 'start' });
    }));
  }

  function renderPedido() {
    btnPagar.disabled = !escolhida;
    if (!escolhida) {
      pedidoItem.innerHTML = '<p class="widget-vazio">Escolha uma funcionalidade no catálogo.</p>';
      return;
    }
    const st = statusDe(escolhida.id);
    pedidoItem.innerHTML = `<div class="widget-item">${icone(ICONE_FUNC[escolhida.slug] || 'adquirir')}
        <span><strong>${esc(escolhida.nome)}</strong><small>${esc(select.options[select.selectedIndex]?.text || '')}</small></span>
        <button type="button" class="botao-icone" id="tirar-pedido" aria-label="Tirar ${esc(escolhida.nome)} do pedido">${icone('fechar')}</button></div>
      <p class="pedido-total"><span>Total</span><strong>${brl(escolhida.preco)}</strong></p>
      ${st === 'aguardando' ? '<p class="nota">Você já pediu esta funcionalidade; o pagamento continua de onde parou.</p>' : ''}`;
    btnPagar.textContent = st === 'aguardando' ? 'Continuar pagamento' : 'Adquirir e pagar';
    document.getElementById('tirar-pedido').addEventListener('click', () => { escolhida = null; renderCatalogo(); renderPedido(); });
  }

  async function adquirir() {
    if (!escolhida) return;
    if (!window.confirm(`Adquirir "${escolhida.nome}" por ${brl(escolhida.preco)} para este projeto? Você será levado ao Mercado Pago.`)) return;
    ocupado(btnPagar, true, 'Preparando o pagamento...');
    mostrarErro('');
    const { data: pagamentoId, error: e1 } = await db.rpc('solicitar_funcionalidade', {
      p_projeto_id: select.value, p_funcionalidade_id: escolhida.id
    });
    if (e1) { mostrarErro('Não foi possível solicitar: ' + e1.message); toast('Não foi possível solicitar: ' + e1.message, 'erro'); ocupado(btnPagar, false); return; }
    try {
      await irParaCheckout({ pagamento_id: pagamentoId });
    } catch (e) {
      avisar('Pedido registrado. Você pode pagar depois em "Pagamentos".');
      mostrarErro(e.message);
      ocupado(btnPagar, false);
    }
  }
})();

// Categoria e ícone por funcionalidade (só apresentação; o catálogo do banco não tem categoria)
const CATEGORIA_FUNC = {
  'portal-clientes': 'Experiência do cliente', 'whatsapp-crm': 'Vendas', 'pagamentos-online': 'Vendas',
  dashboard: 'Gestão', 'blog-seo': 'Marketing'
};
const ICONE_FUNC = { 'portal-clientes': 'perfil', 'whatsapp-crm': 'whatsapp', 'pagamentos-online': 'pagamentos', dashboard: 'painel', 'blog-seo': 'editar' };
function categoriaDe(f) {
  return CATEGORIA_FUNC[f.slug] || 'Outros';
}
