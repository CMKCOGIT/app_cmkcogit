// =====================================================================
// admin-clientes.js — visão do admin: cada cliente, o que comprou
// (projetos e funcionalidades), quanto pagou/deve e o progresso.
// =====================================================================
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;
  const lista = document.getElementById('lista-clientes');
  if (perfil.role !== 'admin') {
    lista.innerHTML = '<p>Acesso restrito a administradores.</p>';
    document.getElementById('busca').disabled = true;
    return;
  }

  const [perfis, projs, pags, sols, funcs] = await Promise.all([
    db.from('profiles').select('id, nome, email, telefone, role, created_at').order('created_at', { ascending: false }),
    db.from('projetos').select('*, projeto_etapas(status)').order('created_at', { ascending: false }),
    db.from('pagamentos').select('cliente_id, valor, status'),
    db.from('solicitacoes').select('cliente_id, status'),
    db.from('projeto_funcionalidades').select('projeto_id, valor, status, funcionalidades(nome)')
  ]);
  const falha = [perfis, projs, pags, sols, funcs].find((r) => r.error);
  if (falha) {
    mostrarErro('Não foi possível carregar: ' + falha.error.message);
    lista.innerHTML = '';
    return;
  }

  const soma = (arr) => arr.reduce((t, p) => t + Number(p.valor || 0), 0);
  const clientes = perfis.data.filter((c) => c.role !== 'admin').map((c) => {
    const projetos = projs.data.filter((p) => p.cliente_id === c.id);
    const pagamentos = pags.data.filter((p) => p.cliente_id === c.id);
    return {
      ...c,
      projetos,
      pago: soma(pagamentos.filter((p) => p.status === 'pago')),
      aberto: soma(pagamentos.filter((p) => p.status === 'pendente')),
      solicitacoesAbertas: sols.data.filter((s) => s.cliente_id === c.id && (s.status === 'em_validacao' || s.status === 'aguardando_pagamento')).length
    };
  });

  const ativos = projs.data.filter((p) => !['concluido', 'cancelado'].includes(p.status_projeto)).length;
  document.getElementById('resumo-admin').innerHTML = `
    <p>Clientes: <strong>${clientes.length}</strong> ·
       Com projeto: <strong>${clientes.filter((c) => c.projetos.length).length}</strong> ·
       Projetos em andamento: <strong>${ativos}</strong> ·
       Recebido: <strong>${brl(soma(pags.data.filter((p) => p.status === 'pago')))}</strong> ·
       A receber: <strong>${brl(soma(pags.data.filter((p) => p.status === 'pendente')))}</strong></p>`;

  const busca = document.getElementById('busca');
  busca.addEventListener('input', render);
  render();

  function render() {
    const termo = busca.value.trim().toLowerCase();
    const filtrados = clientes.filter((c) => !termo || (c.nome || '').toLowerCase().includes(termo) || (c.email || '').toLowerCase().includes(termo));
    if (!filtrados.length) { lista.innerHTML = '<p>Nenhum cliente encontrado.</p>'; return; }

    lista.innerHTML = filtrados.map((c) => {
      const fone = String(c.telefone || '').replace(/\D/g, '');
      const zap = fone ? ` · <a href="https://wa.me/55${esc(fone)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : '';
      const projetos = c.projetos.length ? '<ul>' + c.projetos.map((p) => {
        const extras = funcs.data.filter((f) => f.projeto_id === p.id);
        return `<li>
            <a href="projeto.html?id=${encodeURIComponent(p.id)}"><strong>${esc(p.nome)}</strong></a> ${esc(p.codigo || '')} ·
            ${esc(rotulo('tipo', p.tipo))} · ${brl(p.valor_total)} · pagamento ${esc(rotulo('status_pagamento', p.status_pagamento))}<br>
            ${barraProgresso(progressoProjeto(p))} — ${esc(rotulo('projeto', p.status_projeto))}, etapa ${Number(p.etapa_atual)}/8
            ${p.previsao_entrega ? ' · entrega ' + fmtData(p.previsao_entrega) : ''}${p.dominio ? ' · ' + linkDominio(p.dominio) : ''}
            ${extras.length ? '<br><small>Funcionalidades: ' + extras.map((f) => esc(f.funcionalidades ? f.funcionalidades.nome : '?') + ' (' + esc(rotulo('funcionalidade', f.status)) + ')').join(', ') + '</small>' : ''}
          </li>`;
      }).join('') + '</ul>' : '<p><small>Sem projetos ainda.</small></p>';

      return `<article>
          <h2>${esc(c.nome || '(sem nome)')}</h2>
          <p>${esc(c.email || '')}${c.telefone ? ' · ' + esc(c.telefone) : ''}${zap} · cliente desde ${fmtData(c.created_at)}</p>
          <p>Pago: <strong>${brl(c.pago)}</strong> · Em aberto: ${brl(c.aberto)}
             ${c.solicitacoesAbertas ? ` · <a href="admin.html">${c.solicitacoesAbertas} solicitação(ões) aberta(s)</a>` : ''}</p>
          ${projetos}
        </article><hr>`;
    }).join('');
  }
})();
