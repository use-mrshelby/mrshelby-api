/**
 * Cron scheduler — runs the fulfillment cycle on a configurable interval.
 *
 * Cada ciclo faz, em ordem:
 *   1. createMissingCorreiosLogFulfillments — cria a remessa dos Correios LOG+
 *      que já têm código no Bling mas estão UNFULFILLED na Shopify (+ notifica).
 *   2. syncFulfillmentEvents — atualiza o status de entrega dos que já têm remessa.
 *
 * Default: a cada 3 horas. Ajuste POLL_CRON no .env (ex.: a cada 2h, ou a
 * cada 15 min). Evite escrever a barra-asterisco do cron dentro de comentario.
 */

require("dotenv").config();
const cron = require("node-cron");
const { syncFulfillmentEvents } = require("../fulfillment/syncEvents");
const { createMissingCorreiosLogFulfillments } = require("../fulfillment/createFulfillments");
const logger = require("../logger");

const POLL_CRON = process.env.POLL_CRON || "0 */3 * * *";

// Um ciclo completo pode passar do intervalo do cron. Sem trava, duas rodadas
// rodam juntas, dobram as chamadas e a Shopify passa a recusar por rate limit.
let cicloEmAndamento = false;

async function runCycle(trigger) {
  if (cicloEmAndamento) {
    logger.warn(`Ciclo anterior ainda rodando — pulando disparo (${trigger})`);
    return;
  }
  cicloEmAndamento = true;
  logger.info(`Fulfillment cycle start (${trigger})`);

  try {
    // 1) Cria remessas faltantes do Correios LOG+ (não pode derrubar o ciclo).
    try {
      await createMissingCorreiosLogFulfillments();
    } catch (err) {
      logger.error("createFulfillments error", { error: err.message, trigger });
    }

    // 2) Atualiza status de entrega dos pedidos já enviados.
    try {
      await syncFulfillmentEvents();
    } catch (err) {
      logger.error("Sync error", { error: err.message, trigger });
    }
  } finally {
    // finally: mesmo com erro inesperado, a trava não pode ficar presa.
    cicloEmAndamento = false;
  }

  logger.info(`Fulfillment cycle done (${trigger})`);
}

function start() {
  if (!cron.validate(POLL_CRON)) {
    throw new Error(`Invalid POLL_CRON expression: "${POLL_CRON}"`);
  }

  logger.info(`Scheduler started — cron: ${POLL_CRON}`);

  // Roda logo no startup pra não esperar o primeiro disparo do cron.
  runCycle("initial");

  cron.schedule(POLL_CRON, () => runCycle("scheduled"));
}

module.exports = { start };
