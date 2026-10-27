// POST /api/solicitacoes   (cliente logado)
// Corpo: { cfg }  — a configuração que veio do site no link #cfg=...
// Valida, recalcula o preço pelo catálogo do banco e grava a solicitação na conta.
// Repetir a mesma configuração (recarregar a página) devolve a mesma solicitação.
import { criarDb } from '../lib/supabase.js';
import { json, erro, lerCorpo, exigirUsuario, exigirCadastroCompleto, registrarErro } from '../lib/http.js';
import { sanitizarCfg, calcular } from '../lib/selecao.js';

const LIMITE_POR_HORA = 15;

export default async function handler(req, res) {
  if (req.method !== 'POST') return erro(res, 405, 'Método não permitido.');

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('solicitacoes:config', e); return erro(res, 500, 'Plataforma em configuração. Tente mais tarde.'); }

  const usuario = await exigirUsuario(req, res, db);
  if (!usuario) return;
  if (!(await exigirCadastroCompleto(usuario, res, db))) return;

  let corpo;
  try { corpo = await lerCorpo(req); } catch { return erro(res, 400, 'Requisição inválida.'); }

  const san = sanitizarCfg(corpo && corpo.cfg);
  if (!san.ok) return erro(res, 400, san.erro);
  const cfg = san.cfg;

  try {
    // mesma configuração já registrada? devolve ela
    const existente = await db.um('solicitacoes', {
      select: 'id,codigo,status,estruturado', cliente_id: 'eq.' + usuario.id, ref_site: 'eq.' + cfg.ref
    });
    if (existente) return json(res, 200, { ok: true, nova: false, solicitacao: existente });

    // limite simples contra abuso
    const umaHora = new Date(Date.now() - 3600_000).toISOString();
    const recentes = await db.select('solicitacoes', {
      select: 'id', cliente_id: 'eq.' + usuario.id, created_at: 'gte.' + umaHora, limit: String(LIMITE_POR_HORA)
    });
    if (recentes.length >= LIMITE_POR_HORA) return erro(res, 429, 'Muitas solicitações em pouco tempo. Aguarde e tente novamente.');

    const catalogo = await db.select('catalogo_precos', { select: '*' });
    const calc = calcular(cfg, catalogo);
    if (!calc.ok) return erro(res, 400, calc.erro);

    const notas = [
      cfg.diagnostico && cfg.diagnostico.objetivo ? 'Objetivo (diagnóstico): ' + cfg.diagnostico.objetivo : '',
      cfg.diagnostico && cfg.diagnostico.direcao ? 'Direção sugerida: ' + cfg.diagnostico.direcao : '',
      cfg.notas
    ].filter(Boolean).join('\n');

    const linha = {
      cliente_id: usuario.id,
      ref_site: cfg.ref,
      origem: cfg.origem,
      selecao: { objetivos: cfg.objetivos, servicos: cfg.servicos, complementos: cfg.complementos },
      resumo: calc.resumo,
      notas: notas || null,
      estruturado: calc.estruturado,
      tipo_preco: calc.tipo_preco,
      valor_calculado: calc.valor,
      valor_final: calc.estruturado ? calc.valor : null,
      status: calc.estruturado ? 'aguardando_pagamento' : 'em_validacao'
    };

    let nova;
    try {
      nova = await db.inserir('solicitacoes', linha);
    } catch (e) {
      if (e.status === 409 || e.code === '23505') {
        // duas abas ao mesmo tempo: a outra já gravou
        const outra = await db.um('solicitacoes', {
          select: 'id,codigo,status,estruturado', cliente_id: 'eq.' + usuario.id, ref_site: 'eq.' + cfg.ref
        });
        if (outra) return json(res, 200, { ok: true, nova: false, solicitacao: outra });
      }
      throw e;
    }

    return json(res, 201, {
      ok: true,
      nova: true,
      solicitacao: { id: nova.id, codigo: nova.codigo, status: nova.status, estruturado: nova.estruturado }
    });
  } catch (e) {
    registrarErro('solicitacoes', e);
    return erro(res, 500, 'Não foi possível salvar sua solicitação agora. Tente novamente.');
  }
}
