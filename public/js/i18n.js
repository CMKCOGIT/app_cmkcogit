/* i18n.js — plataforma em inglês (PT | EN).
   · Idioma: ?lang=en|pt na URL (vem do site em inglês) ou a escolha guardada neste navegador.
     Quem chega do site em inglês (?volta=…/en/…) também começa em inglês.
   · Em inglês, troca na hora os textos da página e tudo que o JavaScript monta depois
     (trechos de texto e alt, aria-label, title e placeholder), pelo dicionário em
     js/i18n-en.js (gerado por tools/i18n.mjs a partir de tools/i18n-en.json).
   · Com ?i18n-debug na URL, window.__i18nFaltando lista o que ficou sem tradução.
   Carregue antes dos outros scripts da página. */
(function () {
  'use strict';
  var CHAVE = 'cogit_idioma';
  var q = new URLSearchParams(location.search);
  function guardado() { try { return localStorage.getItem(CHAVE); } catch (e) { return null; } }
  function guardar(v) { try { localStorage.setItem(CHAVE, v); } catch (e) { /* sem armazenamento */ } }
  var pedido = q.get('lang');
  if (pedido === 'en' || pedido === 'pt') guardar(pedido);
  else if (!guardado()) {
    try { var v = new URL(q.get('volta') || '', location.href); if (/^\/en\//.test(v.pathname)) guardar('en'); } catch (e) { /* sem volta */ }
  }
  var idioma = guardado() === 'en' ? 'en' : 'pt';
  window.cogitLocale = idioma === 'en' ? 'en-US' : 'pt-BR'; // datas e horas (valores seguem em R$)
  window.cogitIdioma = function () { return idioma; };
  window.cogitTrocarIdioma = function (novo) {
    guardar(novo === 'en' ? 'en' : 'pt');
    var u = new URL(location.href); u.searchParams.delete('lang');
    location.replace(u.pathname + u.search + u.hash);
  };
  // Seletor PT | EN (usado na barra do topo por app.js e solto nas telas sem barra)
  window.cogitIdiomaHtml = function () {
    var b = function (cod, rot) { return '<button type="button" data-idioma="' + cod + '" lang="' + (cod === 'en' ? 'en' : 'pt-BR') + '"' + (idioma === cod ? ' aria-pressed="true"' : ' aria-pressed="false"') + ' title="' + rot + '">' + cod.toUpperCase() + '</button>'; };
    return '<div class="idioma" role="group" aria-label="' + (idioma === 'en' ? 'Language' : 'Idioma') + '" translate="no">' + b('pt', 'Português') + '<span aria-hidden="true">|</span>' + b('en', 'English') + '</div>';
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-idioma]');
    if (b && b.closest('.idioma') && b.dataset.idioma !== idioma) window.cogitTrocarIdioma(b.dataset.idioma);
  });
  function seletorSolto() {
    if (document.body.classList.contains('app') || document.querySelector('.idioma')) return;
    var d = document.createElement('div'); d.className = 'idioma-solto'; d.innerHTML = window.cogitIdiomaHtml();
    document.body.appendChild(d);
  }

  window.cogitT = function (s) { return s; };
  if (idioma !== 'en') { onReady(seletorSolto); return; }

  var D = window.COGIT_I18N || { texts: {}, patterns: [] };
  document.documentElement.lang = 'en';
  var texts = D.texts || {};
  var norm = function (s) { return s.replace(/[\s ]+/g, ' ').trim(); };
  var minus = {}; Object.keys(texts).forEach(function (k) { minus[k.toLowerCase()] = texts[k]; });
  var pats = (D.patterns || []).map(function (p) { return [new RegExp('^' + p[0] + '$', 'u'), p[1], !!p[2]]; });
  var DEBUG = q.has('i18n-debug');
  var faltando = window.__i18nFaltando = DEBUG ? {} : null;
  var ingles = {}; Object.keys(texts).forEach(function (k) { ingles[norm(texts[k])] = 1; });
  var feito = ' ';
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 }; // texto de dentro não é traduzido
  var ATTRS = ['alt', 'aria-label', 'title', 'placeholder'];

  function parte(x) {
    if (Object.prototype.hasOwnProperty.call(texts, x)) return texts[x];
    var r = minus[x.toLowerCase()];
    if (r != null) return x.charAt(0) === x.charAt(0).toLowerCase() && !/^[A-Z]{2}/.test(r) ? r.charAt(0).toLowerCase() + r.slice(1) : r;
    if (/, | e /.test(x)) return x.split(/(, | e )/).map(function (y) { return y === ', ' ? ', ' : y === ' e ' ? ' and ' : parte(y); }).join('');
    return x;
  }
  function exato(k) {
    if (Object.prototype.hasOwnProperty.call(texts, k)) return texts[k];
    for (var i = 0; i < pats.length; i++) {
      var m = k.match(pats[i][0]);
      if (m) return pats[i][1].replace(/\$(\d)/g, function (_, n) { return pats[i][2] ? parte(m[n] || '') : (m[n] || ''); });
    }
    return null;
  }
  function t(raw) {
    var k = norm(raw);
    if (!k || !/\p{L}{2,}/u.test(k)) return null;
    var r = exato(k);
    if (r == null && /[·•|]/.test(k)) {
      var ok = true;
      r = k.split(/( [·•|] )/).map(function (p) { if (/^ [·•|] $/.test(p) || !/\p{L}{2,}/u.test(p)) return p; var x = exato(p); if (x == null) ok = false; return x; }).join('');
      if (!ok) r = null;
    }
    if (r != null) { if (DEBUG) feito += r + ' '; return r; }
    if (faltando && !ingles[k] && feito.indexOf(k) === -1) faltando[k] = (faltando[k] || 0) + 1;
    return null;
  }
  window.cogitT = function (s) { var r = t(String(s)); return r == null ? s : r; };

  function skip(el) { for (var n = el; n && n.nodeType === 1; n = n.parentNode) { if (SKIP[n.tagName] || n.getAttribute('translate') === 'no' || n.isContentEditable) return true; } return false; }
  // atributos de campos (placeholder de textarea etc.): só o translate="no" e o conteúdo editável impedem
  function skipAttr(el) { for (var n = el; n && n.nodeType === 1; n = n.parentNode) { if (n.getAttribute('translate') === 'no' || n.isContentEditable || n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return true; } return false; }
  function textNode(n) {
    var v = n.nodeValue, r = t(v);
    if (r == null || r === norm(v)) return;
    n.nodeValue = v.match(/^[\s ]*/)[0] + r + v.match(/[\s ]*$/)[0];
  }
  function attrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (v) { var r = t(v); if (r != null && r !== v) el.setAttribute(a, r); }
    }
    // botões de envio com value (ex.: <input type="submit" value="Entrar">)
    if (el.tagName === 'INPUT' && /^(submit|button)$/i.test(el.type) && el.value) { var rv = t(el.value); if (rv != null) el.value = rv; }
  }
  function walk(root) {
    if (root.nodeType === 3) { if (root.parentNode && !skip(root.parentNode)) textNode(root); return; }
    if (root.nodeType !== 1 || skipAttr(root)) return;
    attrs(root);
    if (SKIP[root.tagName] && root.tagName !== 'TEXTAREA') return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
        if (n.getAttribute('translate') === 'no' || n.isContentEditable) return NodeFilter.FILTER_REJECT;
        return n.tagName === 'TEXTAREA' ? NodeFilter.FILTER_ACCEPT : SKIP[n.tagName] ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    for (var n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) textNode(n); else attrs(n); }
  }
  var busy = false;
  var mo = new MutationObserver(function (list) {
    if (busy) return;
    busy = true;
    try {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === 'childList') for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
        else if (m.type === 'characterData') { if (m.target.parentNode && !skip(m.target.parentNode)) textNode(m.target); }
        else if (m.type === 'attributes' && m.target.nodeType === 1 && !skipAttr(m.target)) attrs(m.target);
      }
    } finally { busy = false; }
  });
  function start() {
    var r = t(document.title); if (r != null) document.title = r;
    walk(document.body);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    seletorSolto();
    var title = document.querySelector('title');
    if (title) new MutationObserver(function () { var x = t(document.title); if (x != null && x !== document.title) document.title = x; }).observe(title, { childList: true });
  }
  // confirm/alert/prompt do JavaScript da plataforma também saem em inglês
  ['confirm', 'alert', 'prompt'].forEach(function (f) {
    var orig = window[f];
    window[f] = function (msg) { var args = Array.prototype.slice.call(arguments); if (typeof msg === 'string') args[0] = window.cogitT(msg); return orig.apply(window, args); };
  });
  onReady(start);
  function onReady(fn) { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn); }
})();
