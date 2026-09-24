/**
 * Decide qual aviso de entrega enviar ao cliente e garante que cada um saia
 * uma única vez por remessa (flags gravadas no banco em avisos_enviados).
 *
 * Os quatro avisos:
 *   retirada     objeto aguardando retirada na agência
 *   prazo_final  faltam 2 dias (ou menos) para o fim do prazo de retirada
 *   tentativa    carteiro não atendido / tentativa sem sucesso
 *   devolucao    objeto voltando para a loja
 */

const templates = require("./templates");
const { enviarEmail } = require("./resend");
const logger = require("../logger");

const DIAS_AVISO_PRAZO = 2;

function tipoDoAviso(rawStatus, evento) {
  const t = String(rawStatus || "").toLowerCase();
  // Devolução: Correios escrevem "entregue/devolvido ao remetente"; a Jadlog
  // usa "DEVOLUCAO", "EM DEVOLUCAO" ou "RECUSADO PELO DESTINATARIO".
  // Extravio e avaria ficam de fora de propósito: exigem conversa, não e-mail.
  if (/entregue ao remetente|devolvido ao remetente|prazo de retirada encerrado|devolucao|devolução|recusado/.test(t)) return "devolucao";
  // Qualquer variação de retirada na agência: "aguardando retirada",
  // "disponível para retirada", "encaminhado para retirada". O caso do prazo
  // encerrado já saiu como devolução na regra acima.
  if (/retirada/.test(t)) return "retirada";
  // Jadlog: endereço não localizado / erro de endereço — o cliente precisa
  // confirmar o endereço com a loja, senão o pedido não avança.
  if (/endereco nao localizado|endereço não localizado|erro de endereco|erro de endereço|reitineracao|reitineração/.test(t)) return "endereco";
  if (/nao entregue|não entregue|carteiro nao atendido|carteiro não atendido|ausente/.test(t)) return "tentativa";
  return null;
}

function diasAte(dataIso) {
  if (!dataIso) return null;
  const limite = new Date(`${String(dataIso).substring(0, 10)}T23:59:59`);
  return Math.ceil((limite - new Date()) / 86400000);
}

/**
 * Retorna os tipos de aviso que devem ser enviados agora.
 * enviados = objeto com as flags já gravadas.
 */
function avisosPendentes({ rawStatus, evento, enviados = {} }) {
  const pendentes = [];
  const tipo = tipoDoAviso(rawStatus, evento);

  if (tipo && !enviados[tipo]) pendentes.push(tipo);

  // Lembrete de prazo: só enquanto o objeto está aguardando retirada.
  if (tipo === "retirada" && !enviados.prazo_final && evento && evento.dtLimiteRetirada) {
    const dias = diasAte(evento.dtLimiteRetirada);
    if (dias !== null && dias <= DIAS_AVISO_PRAZO && dias >= 0) pendentes.push("prazo_final");
  }

  return pendentes;
}

async function enviarAviso({ tipo, contato, pedido, codigo, evento }) {
  const dados = {
    nome: contato && contato.nome,
    pedido: pedido || codigo,
    codigo,
    evento,
    diasRestantes: evento && evento.dtLimiteRetirada ? Math.max(diasAte(evento.dtLimiteRetirada), 0) : null,
  };

  const montar = {
    retirada: templates.aguardandoRetirada,
    prazo_final: templates.prazoAcabando,
    tentativa: templates.tentativaEntrega,
    endereco: templates.enderecoNaoLocalizado,
    devolucao: templates.emDevolucao,
  }[tipo];

  if (!montar) {
    logger.warn("Tipo de aviso desconhecido", { tipo, codigo });
    return { enviado: false, motivo: "tipo_desconhecido" };
  }

  const { assunto, html } = montar(dados);
  return enviarEmail({
    para: contato && contato.email,
    assunto,
    html,
    contexto: { tipo, codigo, pedido },
  });
}

module.exports = { avisosPendentes, enviarAviso, tipoDoAviso, diasAte };
