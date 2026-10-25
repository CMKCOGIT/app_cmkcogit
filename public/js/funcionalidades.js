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
  if (!meus.length) {
    select.innerHTML = '<option value="">Nenhum projeto</option>';
    select.disabled = true;
    lista.innerHTML = `<p>Você ainda não tem um projeto ativo. As funcionalidades extras ficam disponíveis depois da primeira compra.
      <a href="${esc(urlSite('monte-sua-solucao.html'))}">Monte sua solução</a></p>`;
    return;
  }
  select.innerHTML = meus.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)}${p.codigo ? ' (' + esc(p.codigo) + ')' : ''}</option>`).join('');
  const pedido = new URLSearchParams(window.location.search).get('projeto');
  if (pedido && meus.some((p) => p.id === pedido)) select.value = pedido;
  select.addEventListener('change', render);
  await render();

  async function render() {
    const { data: contratadas, error } = await db.from('projeto_funcionalidades')
      .select('funcionalidade_id, status').eq('projeto_id', select.value);
    if (error) return mostrarErro(error.message);
    const statusDe = (fid) => {
      const s = contratadas.filter((c) => c.funcionalidade_id === fid).map((c) => c.status);
      if (s.some((x) => ['paga', 'em_andamento', 'entregue'].includes(x))) return 'contratada';
      if (s.includes('aguardando_pagamento')) return 'aguardando';
      return null;
    };

    lista.innerHTML = cat.data.length ? cat.data.map((f) => {
      const st = statusDe(f.id);
      const acao = st === 'contratada'
        ? '<p><strong>Já contratada neste projeto.</strong></p>'
        : `<p><button type="button" data-adquirir="${esc(f.id)}" data-nome="${esc(f.nome)}" data-preco="${esc(f.preco)}">
             ${st === 'aguardando' ? 'Continuar pagamento' : 'Adquirir e pagar'}</button></p>`;
      return `<article>
          <h2>${esc(f.nome)}</h2>
          ${f.descricao ? `<p>${esc(f.descricao)}</p>` : ''}
          <p>Investimento: <strong>${brl(f.preco)}</strong></p>
          ${acao}
        </article><hr>`;
    }).join('') : '<p>Nenhuma funcionalidade disponível no momento.</p>';

    lista.querySelectorAll('[data-adquirir]').forEach((b) => b.addEventListener('click', async () => {
      if (!window.confirm(`Adquirir "${b.dataset.nome}" por ${brl(b.dataset.preco)} para este projeto? Você será levado ao Mercado Pago.`)) return;
      b.disabled = true;
      mostrarErro('');
      avisar('Preparando o pagamento...');
      const { data: pagamentoId, error: e1 } = await db.rpc('solicitar_funcionalidade', {
        p_projeto_id: select.value, p_funcionalidade_id: b.dataset.adquirir
      });
      if (e1) { avisar(''); mostrarErro('Não foi possível solicitar: ' + e1.message); b.disabled = false; return; }
      try {
        await irParaCheckout({ pagamento_id: pagamentoId });
      } catch (e) {
        avisar('Pedido registrado. Você pode pagar depois em "Pagamentos".');
        mostrarErro(e.message);
        b.disabled = false;
      }
    }));
  }
})();
