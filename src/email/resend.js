/**
 * Envio de e-mail transacional via Resend.
 *
 * Config (env):
 *   RESEND_API_KEY  chave de envio (obrigatória para enviar)
 *   EMAIL_FROM      remetente. Padrão: Mr. Shelby <contato@mrshelby.com.br>
 *   EMAIL_TEST_TO   se definido, TODOS os e-mails vão para esse endereço, com
 *                   o assunto prefixado por [TESTE]. Serve para validar antes
 *                   de liberar para os clientes.
 */

require("dotenv").config();
const axios = require("axios");
const logger = require("../logger");

const API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || "Mr. Shelby <contato@mrshelby.com.br>";
const TEST_TO = process.env.EMAIL_TEST_TO;

function podeEnviar() {
  return Boolean(API_KEY);
}

async function enviarEmail({ para, assunto, html, contexto = {} }) {
  if (!podeEnviar()) {
    logger.warn("RESEND_API_KEY ausente — e-mail não enviado", { assunto, ...contexto });
    return { enviado: false, motivo: "sem_api_key" };
  }
  if (!para && !TEST_TO) {
    logger.warn("Pedido sem e-mail do cliente — e-mail não enviado", { assunto, ...contexto });
    return { enviado: false, motivo: "sem_destinatario" };
  }

  const destino = TEST_TO || para;
  const assuntoFinal = TEST_TO ? `[TESTE] ${assunto}` : assunto;

  const { data } = await axios.post(
    "https://api.resend.com/emails",
    { from: FROM, to: [destino], subject: assuntoFinal, html },
    { headers: { Authorization: `Bearer ${API_KEY}` }, timeout: 15000 }
  );

  logger.info("E-mail enviado", { destino, assunto: assuntoFinal, id: data?.id, ...contexto });
  return { enviado: true, id: data?.id };
}

module.exports = { enviarEmail, podeEnviar, emModoTeste: () => Boolean(TEST_TO) };
