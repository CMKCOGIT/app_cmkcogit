// Limite de uso por usuário e ação (tabela rate_limits, função consumir_limite do sql/31).
// Se o banco falhar, deixa passar e registra: um problema no contador não pode travar o cliente.
import { registrarErro } from './http.js';

export const LIMITES = {
  pedir: [10, 3600],            // abrir pagamento do orçamento: 10 por hora
  gerar: [12, 3600],            // disparar a geração (cada uma só roda se o pedido estiver pago)
  construir: [10, 3600],
  jornada_iniciar: [10, 3600],
  jornada_gerar: [6, 3600],     // resumo grátis (Groq)
  jornada_salvar: [240, 3600],
  sso: [30, 3600]               // login único entre app e mvp
};

export async function dentroDoLimite(db, usuarioId, acao) {
  const [max, janela] = LIMITES[acao] || [30, 3600];
  try {
    return (await db.rpc('consumir_limite', { p_chave: acao + ':' + usuarioId, p_max: max, p_janela_seg: janela })) !== false;
  } catch (e) {
    registrarErro('limite:' + acao, e);
    return true;
  }
}
