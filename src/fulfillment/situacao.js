/**
 * Traduz o status da Shopify + o texto da transportadora numa situação única,
 * do jeito que a loja fala dela. É esse valor que vai para o atributo
 * `situacao_entrega` do pedido, e é por ele que o Martz monta os grupos de
 * WhatsApp.
 *
 * Por que não usar o `status_entrega` direto: `attempted_delivery` cobre duas
 * situações que pedem mensagens opostas — "fique em casa que passamos de novo"
 * e "confirme seu endereço". O Martz filtra por valor de atributo, então
 * precisa de um valor diferente para cada mensagem.
 */

const { tipoDoAviso, diasAte, DIAS_AVISO_PRAZO } = require("../email/avisos");

const SITUACOES = {
  AGUARDANDO_RETIRADA: "aguardando_retirada",
  PRAZO_ACABANDO: "prazo_acabando",
  ENDERECO_NAO_LOCALIZADO: "endereco_nao_localizado",
  TENTATIVA_ENTREGA: "tentativa_entrega",
  EM_DEVOLUCAO: "em_devolucao",
  OBJETO_COM_PROBLEMA: "objeto_com_problema",
  ENTREGA_COM_FALHA: "entrega_com_falha",
};

function situacaoDoPedido({ shopifyStatus, rawStatus, evento }) {
  if (!shopifyStatus) return null;
  const tipo = tipoDoAviso(rawStatus, evento);
  const texto = String(rawStatus || "").toLowerCase();

  if (shopifyStatus === "ready_for_pickup") {
    // O prazo só existe nos Correios; a Jadlog não devolve data limite.
    const dias = evento && evento.dtLimiteRetirada ? diasAte(evento.dtLimiteRetirada) : null;
    const acabando = dias !== null && dias >= 0 && dias <= DIAS_AVISO_PRAZO;
    return acabando ? SITUACOES.PRAZO_ACABANDO : SITUACOES.AGUARDANDO_RETIRADA;
  }

  if (shopifyStatus === "attempted_delivery") {
    return tipo === "endereco" ? SITUACOES.ENDERECO_NAO_LOCALIZADO : SITUACOES.TENTATIVA_ENTREGA;
  }

  if (shopifyStatus === "failure") {
    if (tipo === "devolucao") return SITUACOES.EM_DEVOLUCAO;
    // Extravio e avaria não entram em campanha automática: exigem conversa.
    if (/extraviado|avariado|sinistro/.test(texto)) return SITUACOES.OBJETO_COM_PROBLEMA;
    return SITUACOES.ENTREGA_COM_FALHA;
  }

  // delivered, in_transit, out_for_delivery, label_purchased seguem iguais:
  // não há mensagem específica para eles.
  return shopifyStatus;
}

module.exports = { situacaoDoPedido, SITUACOES };
