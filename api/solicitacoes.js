// POST /api/solicitacoes   (cliente logado)
//
// Criar:   { cfg }  — a configuração que veio do site no link #cfg=...
//   Valida, recalcula o preço pelo catálogo do banco e grava a solicitação na conta.
//   Repetir a mesma configuração (recarregar a página) devolve a mesma solicitação.
//   TODA solicitação começa em "Aguardando análise da CMK" (em_validacao): o pagamento só é
//   liberado quando um admin aprova (api/admin-solicitacao.js).
//
// Ações do cliente sobre uma solicitação dele: { acao, solicitacao_id, ... }
//   reenviar          { personalizada, mensagem? }  -> nova versão; volta para "Aguardando análise da CMK".
//                     Com personalizada=true, o navegador já enviou o arquivo da versão nova ao Storage
//                     (caminhoPersonalizacao(id, versao_atual + 1)).
//   aprovar_proposta  {}                            -> aceita as alterações da CMK: libera o pagamento
//   recusar_proposta  { mensagem }                  -> pede revisão da proposta: volta para a análise
import { criarDb } from '../lib/supabase.js';
import { json, erro, lerCorpo, exigirUsuario, exigirCadastroCompleto, registrarErro, UUID } from '../lib/http.js';
import { sanitizarCfg, calcular, texto } from '../lib/selecao.js';
import { CLIENTE_PODE_EDITAR, caminhoPersonalizacao, registrarEvento, avisarAdmins, avisarCliente } from '../lib/fluxo-solicitacao.js';

const LIMITE_POR_HORA = 15;

export default async function handler(req, res) {
  if (req.method !== 'POST') return erro(res, 405, 'Método não permitido.');

  let db;
  try { db = criarDb(); } catch (e) { registrarErro('solicitacoes:config', e); return erro(res, 500, 'Plataforma em configuração. Tente mais tarde.'); }

  const usuario = await exigirUsuario(req, res, db);
  if (!usuario) return;
  if (!(await exigirCadastroCompleto(usuario, res, db, { somenteCliente: true }))) return;

  let corpo;
  try { corpo = await lerCorpo(req); } catch { return erro(res, 400, 'Requisição inválida.'); }

  if (corpo && corpo.acao) return acaoDoCliente(res, db, usuario, corpo);

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

    // modelo pronto com nível (variante): registra se veio personalizado ou não
    const comModelo = cfg.servicos.some((s) => s.variante);
    const notas = [
      cfg.diagnostico && cfg.diagnostico.objetivo ? 'Objetivo (diagnóstico): ' + cfg.diagnostico.objetivo : '',
      cfg.diagnostico && cfg.diagnostico.direcao ? 'Direção sugerida: ' + cfg.diagnostico.direcao : '',
      comModelo ? (cfg.personalizacao
        ? 'Site personalizado pelo cliente no editor do modelo pronto: revisar, ajustar e enviar o orçamento.'
        : 'Enviada SEM personalização: o cliente escolheu o modelo e não personalizou o site.') : '',
      cfg.notas
    ].filter(Boolean).join('\n');

    const selecao = { objetivos: cfg.objetivos, servicos: cfg.servicos, complementos: cfg.complementos };
    if (comModelo) selecao.personalizacao = cfg.personalizacao === true;

    const linha = {
      cliente_id: usuario.id,
      ref_site: cfg.ref,
      origem: cfg.origem,
      selecao,
      resumo: calc.resumo,
      notas: notas || null,
      estruturado: calc.estruturado,
      tipo_preco: calc.tipo_preco,
      valor_calculado: calc.valor,
      valor_final: null,
      status: 'em_validacao'
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

    await registrarVersao(db, nova.id, 1, cfg.personalizacao === true, usuario.id);
    await registrarEvento(db, {
      solicitacaoId: nova.id, tipo: 'criada', para: 'em_validacao', papel: 'cliente', autorId: usuario.id, versao: 1,
      mensagem: comModelo ? (cfg.personalizacao ? 'Solicitação enviada com o site personalizado.' : 'Solicitação enviada sem personalização.') : 'Solicitação enviada.'
    });
    await avisarCliente(db, nova, {
      tipo: 'solicitacao_recebida', titulo: 'Recebemos a sua solicitação ' + nova.codigo,
      mensagem: 'A equipe da CMK vai analisar o projeto. O pagamento é liberado aqui depois da aprovação.'
    });
    await avisarAdmins(db, nova, {
      tipo: 'solicitacao_nova', titulo: 'Nova solicitação ' + nova.codigo,
      mensagem: comModelo ? (cfg.personalizacao ? 'Modelo pronto com site personalizado pelo cliente.' : 'Modelo pronto sem personalização.') : 'Aguardando análise da CMK.'
    });

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

async function registrarVersao(db, solicitacaoId, numero, personalizada, autorId) {
  try {
    await db.inserir('solicitacao_versoes', {
      solicitacao_id: solicitacaoId, numero, personalizada,
      storage_path: personalizada ? caminhoPersonalizacao(solicitacaoId, numero) : null, criado_por: autorId
    });
  } catch (e) {
    registrarErro('solicitacoes:versao', e); // banco sem o sql/32: segue sem o histórico de versões
  }
}

// Fora de "aguardando pagamento" não pode existir cobrança pagável (o banco garante o mesmo: sql/33)
function cancelarCobrancaAberta(db, solicitacaoId) {
  return db.atualizar('pagamentos', { solicitacao_id: 'eq.' + solicitacaoId, status: 'eq.pendente' }, { status: 'cancelado', link_pagamento: null, mp_preference_id: null });
}

async function acaoDoCliente(res, db, usuario, corpo) {
  const { acao, solicitacao_id: solId } = corpo;
  if (!['reenviar', 'aprovar_proposta', 'recusar_proposta'].includes(acao)) return erro(res, 400, 'Ação inválida.');
  if (typeof solId !== 'string' || !UUID.test(solId)) return erro(res, 400, 'Solicitação inválida.');
  try {
    const s = await db.um('solicitacoes', { select: '*', id: 'eq.' + solId, cliente_id: 'eq.' + usuario.id });
    if (!s) return erro(res, 404, 'Solicitação não encontrada.');
    const perfil = (await db.um('profiles', { select: 'nome,email', id: 'eq.' + usuario.id })) || {};
    const quem = perfil.nome || perfil.email || 'O cliente';
    const gravar = (campos) => db.atualizar('solicitacoes', { id: 'eq.' + s.id, status: 'eq.' + s.status, updated_at: 'eq.' + s.updated_at }, campos);
    const mensagem = texto(corpo.mensagem, 1000) || null;

    if (acao === 'reenviar') {
      if (s.status === 'em_analise') return erro(res, 409, 'A equipe está analisando o projeto agora. Aguarde o retorno para editar.');
      if (!CLIENTE_PODE_EDITAR.includes(s.status)) return erro(res, 409, 'Esta solicitação não pode mais ser alterada.');
      const versao = (Number(s.versao_atual) || 1) + 1;
      const personalizada = corpo.personalizada === true;
      const selecao = { ...(s.selecao || {}) };
      if ('personalizacao' in selecao || personalizada) selecao.personalizacao = personalizada || selecao.personalizacao === true;
      const nova = await gravar({ status: 'em_validacao', versao_atual: versao, valor_final: null, selecao });
      if (!nova) return erro(res, 409, 'A solicitação mudou enquanto você editava. Recarregue a página e tente de novo.');
      // alteração depois da aprovação: a cobrança liberada deixa de valer até a nova análise
      await cancelarCobrancaAberta(db, s.id);
      await registrarVersao(db, s.id, versao, personalizada, usuario.id);
      await registrarEvento(db, {
        solicitacaoId: s.id, tipo: 'reenviada', de: s.status, para: 'em_validacao', papel: 'cliente', autorId: usuario.id, autorNome: quem, versao,
        mensagem: mensagem || (personalizada ? 'Site personalizado atualizado e reenviado para análise.' : 'Solicitação reenviada para análise.')
      });
      await avisarAdmins(db, s, {
        tipo: 'solicitacao_reenviada', titulo: s.codigo + ': cliente reenviou com alterações',
        mensagem: quem + ' atualizou o projeto (versão ' + versao + ').' + (mensagem ? ' Mensagem: ' + mensagem : '')
      });
      await avisarCliente(db, s, {
        tipo: 'solicitacao_recebida', titulo: 'Alterações recebidas: ' + s.codigo,
        mensagem: 'O projeto voltou para a análise da CMK. Avisaremos quando for aprovado.'
      });
      return json(res, 200, { ok: true, solicitacao: { id: nova.id, codigo: nova.codigo, status: nova.status, versao_atual: versao } });
    }

    if (s.status !== 'aguardando_cliente') return erro(res, 409, 'Não há proposta da equipe esperando a sua resposta.');

    if (acao === 'aprovar_proposta') {
      if (!(Number(s.valor_final) > 0)) return erro(res, 409, 'A proposta ainda não tem valor definido. Fale com a equipe.');
      const nova = await gravar({ status: 'aguardando_pagamento' });
      if (!nova) return erro(res, 409, 'A solicitação mudou. Recarregue a página e tente de novo.');
      await registrarEvento(db, { solicitacaoId: s.id, tipo: 'cliente_aprovou', de: s.status, para: 'aguardando_pagamento', papel: 'cliente', autorId: usuario.id, autorNome: quem, versao: s.versao_atual, mensagem: 'Cliente aprovou as alterações da CMK.' });
      await avisarAdmins(db, s, { tipo: 'proposta_aprovada', titulo: s.codigo + ': cliente aprovou a proposta', mensagem: quem + ' aprovou as alterações. Pagamento liberado.' });
      await avisarCliente(db, s, { tipo: 'pagamento_liberado', titulo: 'Pagamento liberado: ' + s.codigo, mensagem: 'Você já pode pagar em Minhas solicitações.' });
      return json(res, 200, { ok: true, solicitacao: { id: nova.id, status: nova.status } });
    }

    // recusar_proposta
    if (!mensagem) return erro(res, 400, 'Conte para a equipe o que precisa mudar na proposta.');
    const nova = await gravar({ status: 'em_validacao', valor_final: null });
    if (!nova) return erro(res, 409, 'A solicitação mudou. Recarregue a página e tente de novo.');
    await cancelarCobrancaAberta(db, s.id);
    await registrarEvento(db, { solicitacaoId: s.id, tipo: 'cliente_pediu_revisao', de: s.status, para: 'em_validacao', papel: 'cliente', autorId: usuario.id, autorNome: quem, versao: s.versao_atual, mensagem });
    await avisarAdmins(db, s, { tipo: 'proposta_recusada', titulo: s.codigo + ': cliente pediu revisão da proposta', mensagem: quem + ': ' + mensagem });
    return json(res, 200, { ok: true, solicitacao: { id: nova.id, status: nova.status } });
  } catch (e) {
    registrarErro('solicitacoes:' + acao, e);
    if (e && (e.code === 'PGRST204' || e.code === '42703' || e.code === '23514')) {
      return erro(res, 500, 'Falta atualizar o banco: rode o sql/32_analise_aprovacao.sql no Supabase.');
    }
    return erro(res, 500, 'Não foi possível concluir agora. Tente novamente.');
  }
}
