// =====================================================================
// admin-projetos.js — aba "Projetos" do admin: todos os projetos (o que
// nasceu do pagamento de uma solicitação), com etapa, progresso, prazo,
// pagamento e pendências abertas. Atrasados primeiro. O detalhe e as
// ações (avançar etapa, prazo, pendências, repositório) ficam em projeto.html.
// =====================================================================
(async function () {
  const perfil = await protegerPagina();
  if (!perfil) return;

  const params = new URLSearchParams(window.location.search);
  const busca = document.getElementById('busca');
  const tabela = document.getElementById('tabela-projetos');
  const contagem = document.getElementById('contagem');
  const SITUACOES = ['ativos', 'atrasados', 'semana', 'aguardando_cliente', 'concluido', 'todos'];
  let situacao = SITUACOES.includes(params.get('filtro')) ? params.get('filtro') : 'ativos';
  busca.value = params.get('busca') || '';
  const hoje = new Date().toISOString().slice(0, 10);
  const em7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const [projs, pends] = await Promise.all([
    db.from('projetos')
      .select('*, cliente:profiles!projetos_cliente_id_fkey(id, nome, email), projeto_etapas(ordem, nome, status), solicitacao:solicitacoes!projetos_solicitacao_fk(id, codigo)')
      .order('created_at', { ascending: false }),
    db.from('pendencias').select('projeto_id').eq('resolvida', false)
  ]);
  if (projs.error) {
    mostrarErro('Não foi possível carregar: ' + projs.error.message);
    tabela.innerHTML = '';
    return;
  }
  const pendentes = {};
  (pends.data || []).forEach((p) => { pendentes[p.projeto_id] = (pendentes[p.projeto_id] || 0) + 1; });

  const projetos = (projs.data || []).map((p) => {
    const c = p.cliente || {};
    const ativo = !['concluido', 'cancelado'].includes(p.status_projeto);
    const etapa = (p.projeto_etapas || []).find((e) => e.ordem === p.etapa_atual);
    return {
      ...p,
      ativo,
      atrasado: Boolean(ativo && p.previsao_entrega && p.previsao_entrega < hoje),
      semana: Boolean(ativo && p.previsao_entrega && p.previsao_entrega >= hoje && p.previsao_entrega <= em7),
      pct: progressoProjeto(p),
      etapaNome: etapa ? etapa.nome : '',
      pendencias: pendentes[p.id] || 0,
      texto: normalizar([p.nome, p.codigo, p.solicitacao && p.solicitacao.codigo, c.nome, c.email, p.dominio].join(' '))
    };
  });

  resumo();
  const grupo = document.getElementById('filtro-situacao');
  const botoes = [...grupo.querySelectorAll('[data-situacao]')];
  const marcar = () => botoes.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.situacao === situacao)));
  marcar();
  botoes.forEach((b) => b.addEventListener('click', () => { situacao = b.dataset.situacao; marcar(); render(); }));
  busca.addEventListener('input', render);
  document.getElementById('barra-projetos').addEventListener('submit', (e) => e.preventDefault());
  render();

  function resumo() {
    const ativos = projetos.filter((p) => p.ativo);
    const atrasados = ativos.filter((p) => p.atrasado);
    const semana = ativos.filter((p) => p.semana);
    const esperando = ativos.filter((p) => p.status_projeto === 'aguardando_cliente');
    const el = document.getElementById('resumo-projetos');
    el.innerHTML = [
      { rotulo: 'Em desenvolvimento', valor: ativos.length, icone: 'projetos', destaque: true, nota: projetos.length + ' no total' },
      { rotulo: 'Atrasados', valor: atrasados.length, icone: 'alerta', href: 'admin-projetos.html?filtro=atrasados', alerta: atrasados.length ? 'perigo' : null, nota: atrasados.length ? 'previsão já passou' : 'tudo no prazo' },
      { rotulo: 'Entregas em 7 dias', valor: semana.length, icone: 'prazo', href: 'admin-projetos.html?filtro=semana', alerta: semana.length ? 'atencao' : null },
      { rotulo: 'Aguardando o cliente', valor: esperando.length, icone: 'clientes', href: 'admin-projetos.html?filtro=aguardando_cliente' }
    ].map(kpiHtml).join('');
    animarNumeros(el);
  }

  function filtra(p) {
    switch (situacao) {
      case 'ativos': return p.ativo;
      case 'atrasados': return p.atrasado;
      case 'semana': return p.semana;
      case 'aguardando_cliente': return p.ativo && p.status_projeto === 'aguardando_cliente';
      case 'concluido': return p.status_projeto === 'concluido';
      default: return true;
    }
  }

  function render() {
    const q = normalizar(busca.value.trim());
    const visiveis = projetos.filter((p) => filtra(p) && (!q || p.texto.includes(q)))
      .sort((a, b) => (Number(b.atrasado) - Number(a.atrasado)) || String(a.previsao_entrega || '9999').localeCompare(String(b.previsao_entrega || '9999')));
    contagem.textContent = projetos.length ? `${visiveis.length} de ${projetos.length} projetos` : '';
    if (!visiveis.length) {
      tabela.innerHTML = `<tr><td colspan="7"><p class="widget-vazio">${projetos.length ? 'Nenhum projeto com esse filtro.' : 'Nenhum projeto ainda. Eles nascem quando o pagamento de uma solicitação é confirmado.'}</p></td></tr>`;
      return;
    }
    tabela.innerHTML = visiveis.map((p) => {
      const c = p.cliente || {};
      const entrega = p.status_projeto === 'concluido'
        ? 'Entregue' + (p.concluido_em ? ' em ' + fmtData(p.concluido_em) : '')
        : p.previsao_entrega ? fmtData(p.previsao_entrega) : 'Sem previsão';
      return `<tr>
        <td data-rotulo="Projeto" class="celula-cobranca"><span class="codigo">${esc(p.codigo || '')}${p.solicitacao ? ' · ' + esc(p.solicitacao.codigo) : ''}</span><strong>${esc(p.nome)}</strong>
          ${p.pendencias ? `<small>${p.pendencias} pendência(s) aberta(s)</small>` : ''}</td>
        <td data-rotulo="Cliente" class="celula-cliente">${esc(c.nome || '-')}<small>${esc(c.email || '')}</small></td>
        <td data-rotulo="Etapa">${etiquetaStatus('projeto', p.status_projeto)}<small>${p.status_projeto === 'concluido' ? '8 de 8' : 'Etapa ' + Number(p.etapa_atual || 1) + ' de 8' + (p.etapaNome ? ': ' + esc(p.etapaNome) : '')}</small></td>
        <td data-rotulo="Progresso">${barraProgresso(p.pct)}</td>
        <td data-rotulo="Entrega">${p.atrasado ? `<span data-etiqueta="perigo">Atrasado</span><small>${esc(entrega)}</small>` : p.semana ? `<span data-etiqueta="atencao">${esc(entrega)}</span>` : esc(entrega)}</td>
        <td data-rotulo="Pagamento">${esc(rotulo('status_pagamento', p.status_pagamento))}<small>${p.valor_total != null ? brl(p.valor_total) : ''}</small></td>
        <td data-rotulo="Ações" class="acoes"><a class="botao-link" href="projeto.html?id=${encodeURIComponent(p.id)}">Abrir ${icone('avancar')}</a></td>
      </tr>`;
    }).join('');
  }
})();

function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
