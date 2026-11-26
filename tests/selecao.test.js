// Testes do cálculo de preço feito no servidor. Rode: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sanitizarCfg, calcular } from '../lib/selecao.js';

const catalogo = JSON.parse(fs.readFileSync(new URL('./catalogo.fixture.json', import.meta.url)));
const REF = 'abcdefghijklmnop1234';

function calc(servicos, complementos = [], extra = {}) {
  const s = sanitizarCfg({ v: 1, ref: REF, servicos, complementos, ...extra });
  assert.ok(s.ok, s.erro);
  return calcular(s.cfg, catalogo);
}

test('modelo pronto tem preço fechado e vai direto para pagamento', () => {
  const r = calc([{ id: 'landing-page', modelo: 'modelos-prontos' }]);
  assert.equal(r.valor, 600);
  assert.equal(r.tipo_preco, 'fixed');
  assert.equal(r.estruturado, true);
});

test('sob medida usa o preço "a partir de" e passa pela validação', () => {
  const r = calc([{ id: 'site-institucional', modelo: 'sob-medida' }]);
  assert.equal(r.valor, 900);
  assert.equal(r.tipo_preco, 'from');
  assert.equal(r.estruturado, false);
});

test('combinação Conversão (identidade + landing pronta + automação): 1.990 com 10% = 1.790 "a partir de", igual ao site', () => {
  const r = calc([{ id: 'identidade-essencial' }, { id: 'landing-page', modelo: 'modelos-prontos' }, { id: 'automacao' }]);
  assert.equal(r.valor, 1790);
  assert.equal(r.tipo_preco, 'from');
  assert.deepEqual([r.resumo.desconto.id, r.resumo.desconto.base, r.resumo.desconto.valor], ['conversao', 1990, 200]);
});

test('combinações Presença Essencial (1.080) e Operação Conectada (3.580); sem desconto se faltar serviço ou se for sob medida', () => {
  const p = calc([{ id: 'identidade-essencial' }, { id: 'site-institucional', modelo: 'modelos-prontos' }]);
  assert.equal(p.valor, 1080); assert.equal(p.tipo_preco, 'fixed'); assert.equal(p.estruturado, true);
  assert.equal(calc([{ id: 'sistema' }, { id: 'integracao' }]).valor, 3580);
  const falta = calc([{ id: 'sistema' }]);
  assert.equal(falta.valor, 2990); assert.equal(falta.resumo.desconto, undefined);
  const sob = calc([{ id: 'identidade-essencial' }, { id: 'site-institucional', modelo: 'sob-medida' }]);
  assert.equal(sob.valor, 1400); assert.equal(sob.resumo.desconto, undefined);
});

test('complemento soma e torna "a partir de"', () => {
  const r = calc([{ id: 'landing-page', modelo: 'sob-medida' }], [{ id: 'automacao-extra', qtd: 1 }]);
  assert.equal(r.valor, 1690);
  assert.equal(calc([{ id: 'portfolio', modelo: 'sob-medida' }]).valor, 700);
  assert.equal(r.estruturado, false);
});

test('suporte fica fora do valor inicial: essencial por solicitação, contínuo por mês', () => {
  const r = calc([{ id: 'site-institucional', modelo: 'modelos-prontos' }, { id: 'manutencao' }]);
  assert.equal(r.valor, 700);
  assert.equal(r.estruturado, true);
  assert.deepEqual([r.resumo.mensais[0].id, r.resumo.mensais[0].preco, r.resumo.mensais[0].cobranca], ['manutencao', 150, 'solicitação']);
  assert.equal(calc([{ id: 'suporte' }]).resumo.mensais[0].cobranca, 'mês');
});

test('serviços que saíram do catálogo (consultoria, identidade completa, evolução) são recusados; diagnóstico é gratuito', () => {
  for (const id of ['consultoria', 'identidade-completa', 'evolucao']) {
    assert.equal(calcular(sanitizarCfg({ v: 1, ref: REF, servicos: [{ id }] }).cfg, catalogo).ok, false, id);
  }
  const d = calc([{ id: 'diagnostico' }]);
  assert.equal(d.tipo_preco, 'free');
  assert.equal(d.estruturado, false);
});

test('preço enviado pelo navegador é ignorado', () => {
  const r = calc([{ id: 'landing-page', modelo: 'modelos-prontos', preco: 1, price: 1 }], [], { total: 1, valor: 1 });
  assert.equal(r.valor, 600);
});

test('recusa: formato não escolhido, complemento incompatível, id desconhecido, dois planos mensais', () => {
  const sem = sanitizarCfg({ v: 1, ref: REF, servicos: [{ id: 'portfolio' }] });
  assert.equal(calcular(sem.cfg, catalogo).ok, false);
  const inc = sanitizarCfg({ v: 1, ref: REF, servicos: [{ id: 'integracao' }], complementos: [{ id: 'automacao-extra' }] });
  assert.equal(calcular(inc.cfg, catalogo).ok, false);
  const auto = sanitizarCfg({ v: 1, ref: REF, servicos: [{ id: 'automacao' }], complementos: [{ id: 'automacao-extra' }] });
  assert.equal(calcular(auto.cfg, catalogo).ok, false, 'automação + complemento de automação');
  const desconhecido = sanitizarCfg({ v: 1, ref: REF, servicos: [{ id: 'nao-existe' }] });
  assert.equal(calcular(desconhecido.cfg, catalogo).ok, false);
  const mensais = sanitizarCfg({ v: 1, ref: REF, servicos: [{ id: 'manutencao' }, { id: 'suporte' }] });
  assert.equal(calcular(mensais.cfg, catalogo).ok, false);
});

test('sanitização: versão, ref, limites e texto', () => {
  assert.equal(sanitizarCfg({ v: 2, ref: REF, servicos: [{ id: 'mvp' }] }).ok, false);
  assert.equal(sanitizarCfg({ v: 1, ref: 'curto', servicos: [{ id: 'mvp' }] }).ok, false);
  assert.equal(sanitizarCfg({ v: 1, ref: REF, servicos: [] }).ok, false);
  assert.equal(sanitizarCfg({ v: 1, ref: REF, servicos: [{ id: '<script>' }] }).ok, false);
  const ok = sanitizarCfg({ v: 1, ref: REF, servicos: [{ id: 'mvp', modelo: 'qualquer' }], notas: 'a'.repeat(5000), diagnostico: { objetivo: 'x'.repeat(500) } });
  assert.equal(ok.cfg.notas.length, 2000);
  assert.equal(ok.cfg.diagnostico.objetivo.length, 120);
  assert.equal(ok.cfg.servicos[0].modelo, null);
});

test('planos mensal/anual não existem mais: links antigos com plano pagam o preço único do catálogo', () => {
  for (const plano of ['mensal', 'anual', 'vitalicio', undefined]) {
    const r = calc([{ id: 'landing-page', modelo: 'modelos-prontos', plano }]);
    assert.equal(r.valor, 600, String(plano));
    assert.equal(r.resumo.itens[0].plano, undefined);
    assert.doesNotMatch(r.resumo.itens[0].nome, /plano/);
  }
});

test('modelo pronto com variante: mantém o preço do catálogo e mostra o nível no resumo', () => {
  const r = calc([{ id: 'landing-page', modelo: 'modelos-prontos', variante: 'landing-page-basica' }]);
  assert.equal(r.valor, 600);
  assert.equal(r.estruturado, true);
  assert.equal(r.resumo.itens[0].variante, 'landing-page-basica');
  assert.match(r.resumo.itens[0].variante_nome, /Básico/);
});

test('variante inválida, de outro serviço ou com sob medida é descartada', () => {
  const ruim = (s) => sanitizarCfg({ v: 1, ref: REF, servicos: [s] }).cfg.servicos[0].variante;
  assert.equal(ruim({ id: 'landing-page', modelo: 'modelos-prontos', variante: 'nao-existe' }), undefined);
  assert.equal(ruim({ id: 'portfolio', modelo: 'modelos-prontos', variante: 'landing-page-basica' }), undefined);
  assert.equal(ruim({ id: 'landing-page', modelo: 'sob-medida', variante: 'landing-page-basica' }), undefined);
});

test('personalização só vale com variante de modelo pronto', () => {
  const com = sanitizarCfg({ v: 1, ref: REF, personalizacao: true, servicos: [{ id: 'landing-page', modelo: 'modelos-prontos', variante: 'landing-page-profissional' }] });
  assert.equal(com.cfg.personalizacao, true);
  const sem = sanitizarCfg({ v: 1, ref: REF, personalizacao: true, servicos: [{ id: 'landing-page', modelo: 'modelos-prontos' }] });
  assert.equal(sem.cfg.personalizacao, false);
  const texto = sanitizarCfg({ v: 1, ref: REF, personalizacao: 'sim', servicos: [{ id: 'landing-page', modelo: 'modelos-prontos', variante: 'landing-page-basica' }] });
  assert.equal(texto.cfg.personalizacao, false);
});

test('os três níveis da landing page são aceitos (básico, intermediário e formal)', () => {
  for (const [variante, nome] of [['landing-page-basica', 'Básico'], ['landing-page-profissional', 'Intermediário'], ['landing-page-formal', 'Formal']]) {
    const r = calc([{ id: 'landing-page', modelo: 'modelos-prontos', variante }]);
    assert.equal(r.resumo.itens[0].variante, variante);
    assert.ok(r.resumo.itens[0].variante_nome.startsWith(nome), variante);
  }
});

// ── Black da Cogit 2026 ──
import { BLACK, blackAtiva, prazoPagamentoBlack, blackDoPedido, blackVencida } from '../lib/black-config.js';
const calcBlack = (servicos) => { const s = sanitizarCfg({ v: 1, ref: REF, servicos }); assert.ok(s.ok, s.erro); return calcular(s.cfg, catalogo, { black: BLACK }); };

test('Black: datas no horário de Brasília', () => {
  assert.equal(blackAtiva(new Date('2026-11-25T23:59:59-03:00')), false);
  assert.equal(blackAtiva(new Date('2026-11-26T00:00:00-03:00')), true);
  assert.equal(blackAtiva(new Date('2026-11-27T23:59:59-03:00')), true);
  assert.equal(blackAtiva(new Date('2026-11-28T00:00:00-03:00')), false);
  assert.equal(blackAtiva(new Date('2026-11-26T12:00:00-03:00'), { ...BLACK, ligada: false }), false, 'desligada');
  assert.equal(prazoPagamentoBlack('fixed'), '2026-11-27T23:59:59-03:00');
  assert.equal(prazoPagamentoBlack('from'), '2026-12-04T23:59:59-03:00');
});

test('Black: modelos prontos, combos (sem os 10%) e o que fica fora', () => {
  const v = (servicos) => calcBlack(servicos);
  assert.equal(v([{ id: 'portfolio', modelo: 'modelos-prontos' }]).valor, 400);
  assert.equal(v([{ id: 'landing-page', modelo: 'modelos-prontos' }]).valor, 480);
  assert.equal(v([{ id: 'site-institucional', modelo: 'modelos-prontos' }]).valor, 560);
  assert.equal(v([{ id: 'portfolio', modelo: 'sob-medida' }]).valor, 700, 'sob medida sem Black');
  assert.equal(v([{ id: 'portfolio', modelo: 'sob-medida' }]).promo, null);
  const auto = v([{ id: 'identidade-essencial' }, { id: 'portfolio', modelo: 'modelos-prontos' }]);
  assert.equal(auto.valor, 750); assert.equal(auto.tipo_preco, 'fixed'); assert.equal(auto.resumo.desconto.id, 'autonomo-pronto'); assert.equal(auto.promo, 'black-2026');
  assert.equal(v([{ id: 'identidade-essencial' }, { id: 'site-institucional', modelo: 'modelos-prontos' }]).valor, 900);
  const conv = v([{ id: 'identidade-essencial' }, { id: 'landing-page', modelo: 'modelos-prontos' }, { id: 'automacao' }]);
  assert.equal(conv.valor, 1490); assert.equal(conv.tipo_preco, 'from');
  assert.equal(v([{ id: 'sistema' }, { id: 'integracao' }]).valor, 3180);
  assert.equal(v([{ id: 'automacao' }]).promo, null, 'sem item da Black, não é pedido da Black');
  // fora da Black: tudo como antes (10% nos combos, Autônomo Pronto não existe)
  assert.equal(calc([{ id: 'identidade-essencial' }, { id: 'site-institucional', modelo: 'modelos-prontos' }]).valor, 1080);
  assert.equal(calc([{ id: 'identidade-essencial' }, { id: 'portfolio', modelo: 'modelos-prontos' }]).valor, 1000);
  assert.equal(calc([{ id: 'portfolio', modelo: 'modelos-prontos' }]).promo, null);
});

test('Black: preço garantido do pedido até o prazo dele', () => {
  const s = { promo: 'black-2026', promo_pagar_ate: '2026-12-04T23:59:59-03:00' };
  assert.equal(blackDoPedido(s, Date.parse('2026-12-01T10:00:00-03:00')), true);
  assert.equal(blackDoPedido(s, Date.parse('2026-12-05T00:00:00-03:00')), false);
  assert.equal(blackDoPedido({}, Date.parse('2026-11-26T10:00:00-03:00')), false);
  assert.equal(blackVencida(s, Date.parse('2026-12-05T00:00:00-03:00')), true);
  assert.equal(blackVencida({ ...s, promo_aplicada: false }, Date.parse('2026-12-05T00:00:00-03:00')), false, 'reaprovado sem a Black: paga normal');
});
