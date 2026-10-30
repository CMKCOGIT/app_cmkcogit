// =====================================================================
// comprovante-render.js — monta o HTML do comprovante de pedido.
// Usado pela página pública (comprovante.html) e pela prévia no modal de
// validação (admin.html). Não depende do app.js (a página pública não loga).
// =====================================================================
const Comprovante = (function () {
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const data = (d, hora) => (d ? new Date(d).toLocaleString('pt-BR', hora
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
  const fone = (t) => {
    const d = String(t || '').replace(/\D/g, '');
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return d || '—';
  };
  const preco = (i) => (i.preco == null ? 'sob análise'
    : i.tipo_preco === 'mensal' ? brl(i.preco) + '/mês'
      : (i.tipo_preco === 'from' ? 'a partir de ' : '') + brl(i.preco));

  // Mesma montagem do servidor (lib/comprovante.js), para a prévia antes de aprovar
  function previa({ codigo, criadoEm, cliente, resumo, valorFinal, mensagem, aprovadoPor }) {
    const r = resumo || {};
    const formato = (m) => (m === 'sob-medida' ? 'Sob medida' : m === 'modelos-prontos' ? 'Modelo pronto' : null);
    return {
      codigo, criado_em: criadoEm, emitido_em: new Date().toISOString(), aprovado_por: aprovadoPor || null,
      cliente: { nome: cliente.nome || null, email: cliente.email || null, telefone: cliente.telefone || null },
      itens: [
        ...(r.itens || []).map((i) => ({ nome: i.nome, detalhe: i.personalizado ? i.descricao || 'Item personalizado' : formato(i.modelo), preco: i.preco, tipo_preco: i.tipo_preco, equipe: i.adicionado === 'equipe' })),
        ...(r.complementos || []).map((c) => ({ nome: c.nome, detalhe: 'Complemento' + (c.quantidade > 1 ? ' × ' + c.quantidade : ''), preco: c.preco == null ? null : c.preco * (c.quantidade || 1), tipo_preco: c.tipo_preco, equipe: c.adicionado === 'equipe' })),
        ...(r.mensais || []).map((m) => ({ nome: m.nome, detalhe: 'Mensalidade (começa após os 3 meses grátis, fora do valor inicial)', preco: m.preco, tipo_preco: 'mensal', equipe: m.adicionado === 'equipe' }))
      ],
      estimativa: r.total != null ? Number(r.total) : null,
      valor_final: Number(valorFinal),
      mensagem: mensagem || null
    };
  }

  // c = comprovante gravado; pagamento = { codigo: 'liberado'|'pago'|'cancelado'|'revisao', texto }
  function html(c, pagamento) {
    const pg = pagamento || { codigo: 'liberado', texto: 'Aprovado · pagamento liberado' };
    return `
      <article data-comprovante>
        <header data-comp-topo>
          <img src="/assets/images/logo-white.png" alt="CMKCOGIT" width="168" height="38">
          <div>
            <small>Comprovante de pedido</small>
            <strong>${esc(c.codigo)}</strong>
          </div>
        </header>
        <div data-comp-corpo>
          <dl data-comp-meta>
            <div><dt>Emitido em</dt><dd>${esc(data(c.emitido_em, true))}</dd></div>
            <div><dt>Pedido feito em</dt><dd>${esc(data(c.criado_em))}</dd></div>
            <div><dt>Pagamento</dt><dd><span data-comp-status="${esc(pg.codigo)}">${esc(pg.texto)}</span></dd></div>
          </dl>
          <section data-comp-cliente aria-label="Cliente">
            <h2>Cliente</h2>
            <p><strong>${esc(c.cliente.nome || '—')}</strong><br>${esc(c.cliente.email || '')}${c.cliente.telefone ? ' · ' + esc(fone(c.cliente.telefone)) : ''}</p>
          </section>
          ${c.mensagem ? `<section data-comp-mensagem aria-label="Mensagem da equipe"><h2>Mensagem da equipe</h2><p>${esc(c.mensagem)}</p></section>` : ''}
          <table data-comp-itens>
            <caption>Itens do pedido</caption>
            <thead><tr><th scope="col">Item</th><th scope="col">Valor</th></tr></thead>
            <tbody>${c.itens.map((i) => `<tr>
                <td><strong>${esc(i.nome)}</strong>${i.detalhe ? `<br><small>${esc(i.detalhe)}</small>` : ''}${i.equipe ? ' <small data-comp-equipe>incluído pela equipe</small>' : ''}</td>
                <td>${esc(preco(i))}</td></tr>`).join('')}</tbody>
            <tfoot>
              ${c.estimativa != null && Number(c.estimativa) !== Number(c.valor_final) ? `<tr><th scope="row">Valores de referência dos itens</th><td>${esc(brl(c.estimativa))}</td></tr>` : ''}
              <tr data-comp-total><th scope="row">Valor final</th><td>${esc(brl(c.valor_final))}</td></tr>
            </tfoot>
          </table>
          <footer data-comp-rodape>
            <p>CMKCOGIT · cmkcogit.com.br${c.aprovado_por ? ' · Aprovado por ' + esc(c.aprovado_por) : ''}</p>
            <p><small>Comprovante de pedido. Não é nota fiscal. O valor final é o que vale para o pagamento.</small></p>
          </footer>
        </div>
      </article>`;
  }

  return { html, previa };
})();
