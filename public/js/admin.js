// =====================================================================
// admin.js — o administrador valida o sob medida (define o valor e libera
// o pagamento) ou cancela. O banco também bloqueia quem não é admin.
// =====================================================================
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;

  const lista = document.getElementById('lista-admin');
  const filtro = document.getElementById('filtro');

  if (perfil.role !== 'admin') {
    lista.innerHTML = '<p>Acesso restrito a administradores.</p>';
    filtro.disabled = true;
    return;
  }

  filtro.addEventListener('change', carregar);
  document.getElementById('btn-recarregar').addEventListener('click', () => { carregar(); carregarEventos(); });
  await Promise.all([carregar(), carregarEventos()]);

  async function carregar() {
    mostrarErro('');
    lista.innerHTML = '<p>Carregando...</p>';
    let q = db
      .from('solicitacoes')
      .select('*, cliente:profiles(nome, email, telefone), pagamentos(id, status, valor, metodo, pago_em, mp_ultimo_status)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (filtro.value !== 'todas') q = q.eq('status', filtro.value);
    const { data, error } = await q;
    if (error) {
      mostrarErro('Não foi possível carregar: ' + error.message);
      lista.innerHTML = '';
      return;
    }
    render(data || []);
  }

  function pagamentosHtml(pags) {
    if (!pags || !pags.length) return '';
    return `<details data-cobrancas><summary>Cobranças (${pags.length})</summary><ul>` + pags.map((p) =>
      `<li>${brl(p.valor)} — ${esc(rotulo('pagamento', p.status))}${p.metodo ? ' (' + esc(rotulo('metodo', p.metodo)) + ')' : ''}${p.pago_em ? ' em ' + fmtDataHora(p.pago_em) : ''}${p.status === 'pendente' && p.mp_ultimo_status ? ' · última tentativa MP: ' + esc(rotulo('mp', p.mp_ultimo_status)) : ''}</li>`
    ).join('') + '</ul></details>';
  }

  function render(solicitacoes) {
    if (!solicitacoes.length) {
      lista.innerHTML = '<p>Nada por aqui.</p>';
      return;
    }
    lista.innerHTML = solicitacoes.map((s) => {
      const c = s.cliente || {};
      const fone = String(c.telefone || '').replace(/\D/g, '');
      const zap = fone
        ? `<a href="https://wa.me/55${esc(fone)}?text=${encodeURIComponent('Olá ' + (c.nome || '') + '! Aqui é da CMK COGIT, sobre sua solicitação ' + s.codigo + '.')}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`
        : '';
      const podeDefinir = solicitacaoEditavel(s);
      const valorSugerido = s.valor_final != null ? s.valor_final : (Number(s.valor_calculado) > 0 ? s.valor_calculado : '');
      const decisao = podeDefinir ? `
        <fieldset data-decisao>
          <legend>${s.status === 'em_validacao' ? 'Validar e liberar pagamento' : 'Ajustar valor ou cancelar'}</legend>
          <p><label for="valor-${esc(s.id)}">Valor final (R$)</label>
            <input type="number" id="valor-${esc(s.id)}" min="1" step="0.01" data-valor="${esc(s.id)}" value="${esc(valorSugerido)}"></p>
          <p><label for="obs-${esc(s.id)}">Mensagem ao cliente (opcional)</label>
            <input type="text" id="obs-${esc(s.id)}" maxlength="500" data-obs="${esc(s.id)}" placeholder="Ex.: valor com as integrações confirmadas"></p>
          <p data-botoes>
            <button type="button" data-aprovar="${esc(s.id)}">${s.status === 'em_validacao' ? 'Aprovar e liberar' : 'Salvar novo valor'}</button>
            <button type="button" data-cancelar="${esc(s.id)}">Cancelar solicitação</button>
          </p>
        </fieldset>` : '';

      return `
        <article data-solicitacao="${esc(s.id)}">
          <header>
            <h2>${esc(s.codigo)}</h2>
            <span data-etiqueta="${ETIQUETA_STATUS[s.status] || 'neutro'}">${esc(rotulo('solicitacao', s.status))}</span>
            <span data-etiqueta="neutro">${s.estruturado ? 'Preço fechado' : 'Sob medida'}</span>
            <span data-valores>
              <small>Estimativa</small> <strong>${s.tipo_preco === 'from' ? 'a partir de ' : ''}${brl(s.valor_calculado)}</strong>
              <small>· Liberado</small> <strong>${s.valor_final != null ? brl(s.valor_final) : '—'}</strong>
            </span>
          </header>
          <p data-cliente-sol><strong>${esc(c.nome || '-')}</strong> · ${esc(c.email || '-')}${c.telefone ? ' · ' + esc(formatarTelefone(c.telefone)) : ''}${zap ? ' · ' + zap : ''}
            <small>· ${s.origem === 'diagnostico' ? 'Diagnóstico da home' : 'Monte sua solução'} · ${fmtDataHora(s.created_at)}</small></p>
          ${itensEditaveisHtml(s)}
          ${s.notas ? `<details data-contexto><summary>Contexto informado pelo cliente</summary><p>${esc(s.notas)}</p></details>` : ''}
          ${s.observacao_admin ? `<p data-msg-enviada><small>Mensagem enviada:</small> ${esc(s.observacao_admin)}</p>` : ''}
          ${pagamentosHtml(s.pagamentos)}
          ${decisao}
        </article>
        <hr>`;
    }).join('');

    lista.querySelectorAll('[data-aprovar]').forEach((b) => b.addEventListener('click', () => decidir(b, 'aprovar')));
    lista.querySelectorAll('[data-cancelar]').forEach((b) => b.addEventListener('click', () => decidir(b, 'cancelar')));
    ligarRemoverItens(lista, async (r) => {
      // o status pode ter mudado (ex.: virou preço fechado): segue a solicitação no filtro
      if (filtro.value !== 'todas' && filtro.value !== r.solicitacao.status) filtro.value = r.solicitacao.status;
      await carregar();
    });
  }

  async function decidir(btn, acao) {
    const id = btn.dataset.aprovar || btn.dataset.cancelar;
    const valorEl = lista.querySelector(`[data-valor="${CSS.escape(id)}"]`);
    const obsEl = lista.querySelector(`[data-obs="${CSS.escape(id)}"]`);
    const valor = valorEl ? Number(valorEl.value) : null;

    if (acao === 'aprovar' && !(valor > 0)) return mostrarErro('Informe um valor maior que zero.');
    if (acao === 'aprovar' && !window.confirm('Liberar o pagamento de ' + brl(valor) + ' para o cliente?')) return;
    if (acao === 'cancelar' && !window.confirm('Cancelar esta solicitação?')) return;

    mostrarErro('');
    btn.disabled = true;
    const { error } = await db.rpc('admin_decidir_solicitacao', {
      p_id: id,
      p_acao: acao,
      p_valor: acao === 'aprovar' ? valor : null,
      p_observacao: obsEl && obsEl.value.trim() ? obsEl.value.trim() : null
    });
    if (error) {
      mostrarErro('Não foi possível salvar: ' + error.message);
      btn.disabled = false;
      return;
    }
    avisar(acao === 'aprovar' ? 'Pagamento liberado para o cliente.' : 'Solicitação cancelada.');
    await carregar();
  }

  async function carregarEventos() {
    const corpo = document.getElementById('tabela-eventos');
    const { data, error } = await db.from('pagamento_eventos').select('*').order('created_at', { ascending: false }).limit(30);
    if (error) {
      corpo.innerHTML = `<tr><td colspan="6">Erro: ${esc(error.message)}</td></tr>`;
      return;
    }
    corpo.innerHTML = data.length ? data.map((e) => `<tr>
        <td>${fmtDataHora(e.created_at)}</td><td>${esc(e.origem)}</td><td>${esc(e.mp_payment_id || '-')}</td>
        <td>${esc(e.status_mp || '-')}${e.status_detalhe ? ' <small>(' + esc(e.status_detalhe) + ')</small>' : ''}</td>
        <td>${e.valor_mp != null ? brl(e.valor_mp) : '-'}</td><td><strong>${esc(e.resultado || '-')}</strong></td>
      </tr>`).join('') : '<tr><td colspan="6">Nenhum aviso ainda.</td></tr>';
  }
})();

// Cor da etiqueta de status (texto sempre junto)
const ETIQUETA_STATUS = { em_validacao: 'atencao', aguardando_pagamento: 'info', paga: 'ok', cancelada: 'neutro' };
