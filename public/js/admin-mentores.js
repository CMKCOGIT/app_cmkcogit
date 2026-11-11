// =====================================================================
// admin-mentores.js — "Mentores e orçamentos MVP" (só admin).
// Pedidos para ser mentor vêm do mvp.cmkcogit.com.br (perfil / boas-vindas). Aprovar concede a
// permissão de mentor (user_roles) pela função do banco admin_decidir_mentoria, que confere se
// quem chama é admin: a tela é só a navegação, quem decide é o banco.
// Orçamentos detalhados (R$ 30): status, custo de IA, reprocessar e estornar (rota /api/mvp).
// =====================================================================
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;

  const listaMentoria = document.getElementById('lista-mentoria');
  const listaOrc = document.getElementById('lista-orcamentos');
  const tabelaMargem = document.getElementById('tabela-margem');
  let filtro = 'pending';

  const STATUS_PEDIDO = { pending: 'Pendente', approved: 'Aprovado', rejected: 'Recusado' };
  const TOM_PEDIDO = { pending: 'atencao', approved: 'ok', rejected: 'neutro' };
  const STATUS_ORC = {
    pending_payment: ['Aguardando pagamento', 'atencao'], paid: ['Pago, na fila', 'info'], generating: ['Gerando', 'info'],
    ready: ['Pronto', 'ok'], failed: ['Falhou', 'perigo'], refunded: ['Estornado', 'neutro']
  };

  async function carregarMentoria() {
    listaMentoria.setAttribute('aria-busy', 'true');
    const { data, error } = await db.rpc('admin_listar_mentoria', { p_status: filtro });
    listaMentoria.removeAttribute('aria-busy');
    if (error) { listaMentoria.innerHTML = ''; return mostrarErro('Não foi possível carregar os pedidos: ' + error.message); }
    if (!data.length) { listaMentoria.innerHTML = '<p data-vazio>Nenhum pedido ' + esc(STATUS_PEDIDO[filtro].toLowerCase()) + '.</p>'; return; }
    listaMentoria.innerHTML = data.map((r) => `
      <article class="card" data-id="${esc(r.id)}">
        <header>
          <h3>${esc(r.nome || 'Sem nome')}</h3>
          <span data-etiqueta="${TOM_PEDIDO[r.status]}">${esc(STATUS_PEDIDO[r.status])}</span>
        </header>
        <p class="nota">${esc(r.email || '')} · pedido em ${esc(fmtDataHora(r.created_at))}</p>
        ${r.message ? `<p>${esc(r.message)}</p>` : '<p class="nota">Sem mensagem.</p>'}
        ${r.status !== 'pending' ? `<p class="nota">Decidido por ${esc(r.revisor || 'admin')} em ${esc(fmtDataHora(r.reviewed_at))}${r.status === 'approved' && !r.mentor_ativo ? ' · permissão retirada depois' : ''}</p>` : ''}
        <p class="pagina-acoes">
          ${r.status === 'pending' ? `<button type="button" data-acao="aprovar">${icone('aprovar')} Aprovar mentor</button>
            <button type="button" class="botao-secundario" data-acao="recusar">Recusar</button>` : ''}
          ${r.mentor_ativo ? `<button type="button" class="botao-secundario" data-acao="revogar" data-user="${esc(r.user_id)}">Retirar permissão de mentor</button>` : ''}
        </p>
      </article>`).join('');
  }

  listaMentoria.addEventListener('click', async (ev) => {
    const botao = ev.target.closest('button[data-acao]');
    if (!botao) return;
    const id = botao.closest('[data-id]').dataset.id;
    const acao = botao.dataset.acao;
    const textos = {
      aprovar: 'Aprovar este mentor? Ele passa a ver, no mvp, os projetos que forem compartilhados com ele.',
      recusar: 'Recusar este pedido?',
      revogar: 'Retirar a permissão de mentor? Ele deixa de ver todos os projetos compartilhados.'
    };
    if (!window.confirm(textos[acao])) return;
    ocupado(botao, true);
    const r = acao === 'revogar'
      ? await db.rpc('admin_revogar_mentor', { p_user: botao.dataset.user })
      : await db.rpc('admin_decidir_mentoria', { p_id: id, p_aprovar: acao === 'aprovar' });
    ocupado(botao, false);
    if (r.error) return mostrarErro(r.error.message);
    toast(acao === 'aprovar' ? 'Mentor aprovado.' : acao === 'recusar' ? 'Pedido recusado.' : 'Permissão retirada.');
    carregarMentoria();
  });

  document.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
    filtro = b.dataset.status;
    document.querySelectorAll('[data-status]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    carregarMentoria();
  }));

  async function carregarMargem() {
    const { data, error } = await db.rpc('admin_mvp_margem', {});
    if (error) { tabelaMargem.innerHTML = '<p class="nota">Rode o sql/31 para ver a margem.</p>'; return; }
    if (!data.length) { tabelaMargem.innerHTML = '<p data-vazio>Nenhum orçamento pago ainda.</p>'; return; }
    tabelaMargem.innerHTML = `<div class="tabela-rolagem"><table class="tabela-limpa">
      <thead><tr><th>Mês</th><th>Pagos</th><th>Receita</th><th>Custo de IA</th><th>Margem</th></tr></thead>
      <tbody>${data.map((m) => `<tr><td>${esc(new Date(m.mes + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }))}</td>
        <td>${Number(m.pedidos_pagos)}</td><td>${brl(m.receita_brl)}</td><td>${brl(m.custo_brl)}</td>
        <td><strong>${brl(m.margem_brl)}</strong>${m.margem_pct != null ? ' <small>(' + Number(m.margem_pct) + '%)</small>' : ''}</td></tr>`).join('')}</tbody>
    </table></div>`;
  }

  async function carregarOrcamentos() {
    let dados;
    try { dados = await api('mvp?acao=admin_pedidos', null, 'GET'); } catch (e) { listaOrc.innerHTML = ''; return mostrarErro(e.message); }
    listaOrc.removeAttribute('aria-busy');
    if (!dados.pedidos.length) { listaOrc.innerHTML = '<p data-vazio>Nenhum orçamento detalhado vendido ainda.</p>'; return; }
    listaOrc.innerHTML = `<div class="tabela-rolagem"><table class="tabela-limpa">
      <thead><tr><th>Projeto</th><th>Status</th><th>Pago em</th><th>Custo de IA</th><th>Ações</th></tr></thead>
      <tbody>${dados.pedidos.map((p) => {
        const [rot, tom] = STATUS_ORC[p.status] || [p.status, 'neutro'];
        return `<tr data-pedido="${esc(p.id)}"><td>${esc(p.titulo)}<br><small class="nota">${esc(p.id.slice(0, 8).toUpperCase())}</small></td>
          <td><span data-etiqueta="${tom}">${esc(rot)}</span>${p.erro ? `<br><small class="nota">${esc(p.erro)}</small>` : ''}</td>
          <td>${p.paid_at ? esc(fmtDataHora(p.paid_at)) : '-'}</td>
          <td>${brl(p.custo_brl)}</td>
          <td>${p.tem_pdf ? `<button type="button" class="botao-secundario" data-acao="pdf">${icone('pdf')} PDF</button> ` : ''}
            ${['paid', 'failed', 'generating'].includes(p.status) ? '<button type="button" class="botao-secundario" data-acao="admin_reprocessar">Gerar de novo</button> ' : ''}
            ${['paid', 'failed', 'ready'].includes(p.status) && p.paid_at ? '<button type="button" class="botao-secundario" data-acao="admin_estornar">Estornar</button>' : ''}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  listaOrc.addEventListener('click', async (ev) => {
    const botao = ev.target.closest('button[data-acao]');
    if (!botao) return;
    const id = botao.closest('[data-pedido]').dataset.pedido;
    const acao = botao.dataset.acao;
    if (acao === 'admin_estornar' && !window.confirm('Estornar o pagamento deste orçamento no Mercado Pago? Não dá para desfazer.')) return;
    ocupado(botao, true, acao === 'admin_reprocessar' ? 'Gerando...' : undefined);
    try {
      if (acao === 'pdf') {
        const r = await api('mvp?acao=pdf&pedido_id=' + encodeURIComponent(id), null, 'GET');
        window.open(r.url, '_blank', 'noopener');
      } else {
        await api('mvp?acao=' + acao, { pedido_id: id });
        toast(acao === 'admin_estornar' ? 'Estorno pedido ao Mercado Pago.' : 'Pedido processado.');
        await Promise.all([carregarOrcamentos(), carregarMargem()]);
      }
    } catch (e) {
      mostrarErro(e.message);
    } finally {
      ocupado(botao, false);
    }
  });

  await Promise.all([carregarMentoria(), carregarMargem(), carregarOrcamentos()]);
})();
