// Valida o que chega do site (cmkcogit.com.br) e calcula o preço NO SERVIDOR.
//
// O site entrega um objeto "cfg" (ver js/handoff.js no repositório do site):
//   { v: 1, ref, origem: 'configurador' | 'diagnostico',
//     objetivos: ['atrair-vender'], servicos: [{ id, modelo }], complementos: [{ id, qtd }],
//     notas, diagnostico: { objetivo, direcao } }
// Nomes e preços que vierem junto são ignorados: só os IDs valem, e o preço sai
// da tabela catalogo_precos do banco.

const SLUG = /^[a-z0-9-]{1,60}$/;
const REF = /^[A-Za-z0-9_-]{16,64}$/;
const MODELOS = ['modelos-prontos', 'sob-medida'];

export function texto(valor, max) {
  if (typeof valor !== 'string') return '';
  // remove caracteres de controle (mantém quebras de linha) e limita o tamanho
  // eslint-disable-next-line no-control-regex
  return valor.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

export function sanitizarCfg(bruto) {
  const b = bruto && typeof bruto === 'object' ? bruto : null;
  if (!b || b.v !== 1) return { ok: false, erro: 'Configuração inválida. Monte sua solução novamente no site.' };
  if (typeof b.ref !== 'string' || !REF.test(b.ref)) return { ok: false, erro: 'Configuração inválida.' };

  const origem = b.origem === 'diagnostico' ? 'diagnostico' : 'configurador';
  const objetivos = Array.isArray(b.objetivos) ? b.objetivos : [];
  const servicos = Array.isArray(b.servicos) ? b.servicos : [];
  const complementos = Array.isArray(b.complementos) ? b.complementos : [];

  if (servicos.length < 1 || servicos.length > 8) return { ok: false, erro: 'Escolha de 1 a 8 soluções.' };
  if (objetivos.length > 8 || complementos.length > 8) return { ok: false, erro: 'Configuração inválida.' };

  const cfg = { v: 1, ref: b.ref, origem, objetivos: [], servicos: [], complementos: [], notas: '', diagnostico: null };

  for (const o of objetivos) {
    if (typeof o !== 'string' || !SLUG.test(o)) return { ok: false, erro: 'Objetivo inválido.' };
    if (!cfg.objetivos.includes(o)) cfg.objetivos.push(o);
  }
  for (const s of servicos) {
    if (!s || typeof s.id !== 'string' || !SLUG.test(s.id)) return { ok: false, erro: 'Solução inválida.' };
    const modelo = MODELOS.includes(s.modelo) ? s.modelo : null;
    cfg.servicos.push({ id: s.id, modelo });
  }
  for (const c of complementos) {
    if (!c || typeof c.id !== 'string' || !SLUG.test(c.id)) return { ok: false, erro: 'Complemento inválido.' };
    const q = Number(c.qtd);
    cfg.complementos.push({ id: c.id, qtd: Number.isInteger(q) && q >= 1 && q <= 99 ? q : 1 });
  }

  cfg.notas = texto(b.notas, 2000);
  if (b.diagnostico && typeof b.diagnostico === 'object') {
    const objetivo = texto(b.diagnostico.objetivo, 120);
    const direcao = texto(b.diagnostico.direcao, 160);
    if (objetivo || direcao) cfg.diagnostico = { objetivo, direcao };
  }
  return { ok: true, cfg };
}

// catalogo: linhas da tabela catalogo_precos
export function calcular(cfg, catalogo) {
  const porId = new Map(
    catalogo.filter((i) => i.ativo !== false).map((i) => [i.id + ':' + i.tipo, i])
  );
  const resumo = { itens: [], complementos: [], mensais: [], total: 0 };

  let total = 0;
  let temFrom = false;
  let temSobAnalise = false;
  const vistos = new Set();
  const permitidos = new Set();
  let mensalEscolhido = false;

  for (const s of cfg.servicos) {
    if (vistos.has(s.id)) return { ok: false, erro: 'Solução repetida na seleção.' };
    vistos.add(s.id);

    const item = porId.get(s.id + ':servico');
    if (!item) return { ok: false, erro: 'Solução indisponível: ' + s.id };
    (item.complementos_permitidos || []).forEach((id) => permitidos.add(id));

    if (item.mensal) {
      // o site só deixa escolher um plano mensal; ele começa depois dos 3 meses grátis
      if (mensalEscolhido) return { ok: false, erro: 'Escolha apenas um plano mensal.' };
      mensalEscolhido = true;
      resumo.mensais.push({ id: item.id, nome: item.nome, preco: num(item.preco), tipo_preco: item.tipo_preco, ...marca(s) });
      continue;
    }

    let modelo = null;
    let preco = num(item.preco);
    let tipo = item.tipo_preco;

    if (item.presenca_digital) {
      if (!s.modelo) return { ok: false, erro: 'Escolha o formato de ' + item.nome + ' (modelo pronto ou sob medida).' };
      modelo = s.modelo;
      if (modelo === 'sob-medida') {
        preco = num(item.preco_sob_medida);
        tipo = 'from'; // sob medida sempre passa pela validação da equipe
      }
    }

    if (tipo === 'analysis' || tipo === 'custom' || preco == null) {
      temSobAnalise = true;
      resumo.itens.push({ id: item.id, nome: item.nome, modelo, preco: null, tipo_preco: 'custom', ...marca(s) });
      continue;
    }
    total += preco;
    if (tipo === 'from') temFrom = true;
    resumo.itens.push({ id: item.id, nome: item.nome, modelo, preco, tipo_preco: tipo, ...marca(s) });
  }

  // itens personalizados da equipe (fora do catálogo): preço fechado, entram como solução
  for (const p of cfg.personalizados || []) {
    const preco = num(p.valor);
    if (preco == null || preco <= 0) return { ok: false, erro: 'Item personalizado sem valor: ' + p.nome };
    total += preco;
    resumo.itens.push({ id: p.id, nome: p.nome, descricao: p.descricao || null, preco, tipo_preco: 'fixed', personalizado: true, adicionado: 'equipe' });
  }

  // mesma regra do site: quem já escolheu Automação não precisa do complemento de automação
  if (vistos.has('automacao')) permitidos.delete('automacao-extra');

  const compVistos = new Set();
  for (const c of cfg.complementos) {
    if (compVistos.has(c.id)) return { ok: false, erro: 'Complemento repetido na seleção.' };
    compVistos.add(c.id);

    const item = porId.get(c.id + ':complemento');
    if (!item) return { ok: false, erro: 'Complemento indisponível: ' + c.id };
    if (!permitidos.has(item.id)) return { ok: false, erro: 'Complemento incompatível com a seleção: ' + item.nome };

    const preco = num(item.preco);
    if (item.tipo_preco === 'analysis' || item.tipo_preco === 'custom' || preco == null) {
      temSobAnalise = true;
      resumo.complementos.push({ id: item.id, nome: item.nome, quantidade: c.qtd, preco: null, tipo_preco: 'custom', ...marca(c) });
      continue;
    }
    total += preco * c.qtd;
    if (item.tipo_preco === 'from') temFrom = true;
    resumo.complementos.push({ id: item.id, nome: item.nome, quantidade: c.qtd, preco, tipo_preco: item.tipo_preco, ...marca(c) });
  }

  total = Math.round(total * 100) / 100;
  resumo.total = total;

  let tipo_preco;
  if (total > 0) tipo_preco = temFrom || temSobAnalise ? 'from' : 'fixed';
  else if (!temSobAnalise && resumo.itens.some((i) => i.id === 'diagnostico')) tipo_preco = 'free';
  else tipo_preco = 'custom';

  // Estruturada = preço fechado e maior que zero: o cliente paga direto.
  const estruturado = tipo_preco === 'fixed';

  return { ok: true, resumo, valor: total, tipo_preco, estruturado };
}

// "adicionado pela equipe" acompanha o item até o resumo (só o servidor marca)
function marca(item) {
  return item && item.adicionado === 'equipe' ? { adicionado: 'equipe' } : {};
}

// ---------------------------------------------------------------------
// Itens editados pelo admin no modal de validação. Valida o formato e decide
// no SERVIDOR o que é "adicionado pela equipe": tudo que não estava na seleção
// salva (o navegador não consegue marcar nem desmarcar isso).
// ---------------------------------------------------------------------
const CUSTOM = /^custom-[a-z0-9]{6,24}$/;
export function validarItensAdmin(bruto, selecaoAtual = {}) {
  const b = bruto && typeof bruto === 'object' ? bruto : null;
  if (!b) return { ok: false, erro: 'Itens inválidos.' };
  const servicos = Array.isArray(b.servicos) ? b.servicos : [];
  const complementos = Array.isArray(b.complementos) ? b.complementos : [];
  const personalizados = Array.isArray(b.personalizados) ? b.personalizados : [];
  if (servicos.length > 12 || complementos.length > 8 || personalizados.length > 20) return { ok: false, erro: 'Itens demais na solicitação.' };

  const antes = (lista) => new Map((Array.isArray(lista) ? lista : []).filter((x) => x && x.id).map((x) => [x.id, x]));
  const servAntes = antes(selecaoAtual.servicos);
  const compAntes = antes(selecaoAtual.complementos);
  const flag = (mapa, id) => {
    const velho = mapa.get(id);
    return velho ? (velho.adicionado === 'equipe' ? { adicionado: 'equipe' } : {}) : { adicionado: 'equipe' };
  };

  const out = { servicos: [], complementos: [], personalizados: [] };
  for (const s of servicos) {
    if (!s || typeof s.id !== 'string' || !SLUG.test(s.id)) return { ok: false, erro: 'Solução inválida.' };
    out.servicos.push({ id: s.id, modelo: MODELOS.includes(s.modelo) ? s.modelo : null, ...flag(servAntes, s.id) });
  }
  for (const c of complementos) {
    if (!c || typeof c.id !== 'string' || !SLUG.test(c.id)) return { ok: false, erro: 'Complemento inválido.' };
    const q = Number(c.qtd);
    out.complementos.push({ id: c.id, qtd: Number.isInteger(q) && q >= 1 && q <= 99 ? q : 1, ...flag(compAntes, c.id) });
  }
  for (const p of personalizados) {
    if (!p || typeof p.id !== 'string' || !CUSTOM.test(p.id)) return { ok: false, erro: 'Item personalizado inválido.' };
    const nome = texto(p.nome, 120);
    if (nome.length < 2) return { ok: false, erro: 'Dê um nome ao item personalizado.' };
    const valor = Math.round(Number(p.valor) * 100) / 100;
    if (!(valor > 0) || valor > 1000000) return { ok: false, erro: 'Valor inválido em "' + nome + '".' };
    if (out.personalizados.some((x) => x.id === p.id)) return { ok: false, erro: 'Item personalizado repetido.' };
    out.personalizados.push({ id: p.id, nome, descricao: texto(p.descricao, 300) || null, valor, adicionado: 'equipe' });
  }
  if (!out.servicos.length && !out.personalizados.length) return { ok: false, erro: 'A solicitação precisa de pelo menos um item.' };
  return { ok: true, itens: out };
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
