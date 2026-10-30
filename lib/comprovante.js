// Comprovante de pedido: link público único (comprovante.html?t=<token>) com uma
// cópia do pedido no momento da aprovação. O token é aleatório (24 bytes) e é a
// única chave de acesso — não use dados previsíveis (código, id) no link.
import crypto from 'node:crypto';

export const TOKEN = /^[A-Za-z0-9_-]{32}$/;

export function novoToken() {
  return crypto.randomBytes(24).toString('base64url'); // 32 caracteres
}

// resumo = calculado por lib/selecao.js (itens, complementos, mensais)
export function montarComprovante({ solicitacao, resumo, valorFinal, mensagem, cliente, aprovadoPor, emitidoEm }) {
  const formato = (m) => (m === 'sob-medida' ? 'Sob medida' : m === 'modelos-prontos' ? 'Modelo pronto' : null);
  const itens = [
    ...(resumo.itens || []).map((i) => ({
      nome: i.nome, detalhe: i.personalizado ? i.descricao || 'Item personalizado' : formato(i.modelo),
      preco: i.preco, tipo_preco: i.tipo_preco, equipe: i.adicionado === 'equipe'
    })),
    ...(resumo.complementos || []).map((c) => ({
      nome: c.nome, detalhe: 'Complemento' + (c.quantidade > 1 ? ' × ' + c.quantidade : ''),
      preco: c.preco == null ? null : c.preco * (c.quantidade || 1), tipo_preco: c.tipo_preco, equipe: c.adicionado === 'equipe'
    })),
    ...(resumo.mensais || []).map((m) => ({
      nome: m.nome, detalhe: 'Mensalidade (começa após os 3 meses grátis, fora do valor inicial)',
      preco: m.preco, tipo_preco: 'mensal', equipe: m.adicionado === 'equipe'
    }))
  ];
  return {
    versao: 1,
    codigo: solicitacao.codigo,
    criado_em: solicitacao.created_at || null,
    emitido_em: emitidoEm,
    cliente: { nome: cliente.nome || null, email: cliente.email || null, telefone: cliente.telefone || null },
    itens,
    estimativa: resumo.total != null ? Number(resumo.total) : null,
    valor_final: Number(valorFinal),
    mensagem: mensagem || null,
    aprovado_por: aprovadoPor || null
  };
}

// Status mostrado no comprovante, a partir do status ATUAL da solicitação
export function statusPagamento(status) {
  switch (status) {
    case 'paga': return { codigo: 'pago', texto: 'Pago' };
    case 'aguardando_pagamento': return { codigo: 'liberado', texto: 'Aprovado · pagamento liberado' };
    case 'cancelada': return { codigo: 'cancelado', texto: 'Pedido cancelado' };
    default: return { codigo: 'revisao', texto: 'Em revisão pela equipe' };
  }
}

export function textoWhatsApp({ nome, codigo, valorFinal, mensagem, link }) {
  const valor = Number(valorFinal).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return [
    `Olá${nome ? ', ' + String(nome).split(' ')[0] : ''}! Aqui é da CMK COGIT.`,
    `Seu pedido ${codigo} foi aprovado e o pagamento já está liberado.`,
    `Valor final: ${valor}`,
    mensagem ? '\n' + mensagem : '',
    `\nComprovante do pedido: ${link}`
  ].filter(Boolean).join('\n');
}
