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
  assert.equal(r.valor, 500);
  assert.equal(r.tipo_preco, 'fixed');
  assert.equal(r.estruturado, true);
});

test('sob medida usa o preço "a partir de" e passa pela validação', () => {
  const r = calc([{ id: 'site-institucional', modelo: 'sob-medida' }]);
  assert.equal(r.valor, 900);
  assert.equal(r.tipo_preco, 'from');
  assert.equal(r.estruturado, false);
});

test('mesmos totais do site: identidade + landing + automação = 1990 "a partir de"', () => {
  const r = calc([{ id: 'identidade-essencial' }, { id: 'landing-page', modelo: 'modelos-prontos' }, { id: 'automacao' }]);
  assert.equal(r.valor, 1990);
  assert.equal(r.tipo_preco, 'from');
});

test('complemento soma e torna "a partir de"', () => {
  const r = calc([{ id: 'landing-page', modelo: 'sob-medida' }], [{ id: 'automacao-extra', qtd: 1 }]);
  assert.equal(r.valor, 1690);
  assert.equal(r.estruturado, false);
});

test('mensalidade fica fora do valor inicial', () => {
  const r = calc([{ id: 'site-institucional', modelo: 'modelos-prontos' }, { id: 'manutencao' }]);
  assert.equal(r.valor, 700);
  assert.equal(r.estruturado, true);
  assert.equal(r.resumo.mensais[0].id, 'manutencao');
});

test('consultoria (preço fixo) é paga direto; diagnóstico é gratuito e vai para validação', () => {
  assert.equal(calc([{ id: 'consultoria' }]).estruturado, true);
  const d = calc([{ id: 'diagnostico' }]);
  assert.equal(d.tipo_preco, 'free');
  assert.equal(d.estruturado, false);
});

test('preço enviado pelo navegador é ignorado', () => {
  const r = calc([{ id: 'landing-page', modelo: 'modelos-prontos', preco: 1, price: 1 }], [], { total: 1, valor: 1 });
  assert.equal(r.valor, 500);
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
