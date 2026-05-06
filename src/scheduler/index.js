/**
 * Cron scheduler — triggers the fulfillment event sync on a configurable interval.
 * Default: every 3 hours  (POLL_CRON="0 * /3 * * *" without the space)
 * Adjust in .env: e.g. "0 * /2 * * *" for every 2h, "0 * /4 * * *" for every 4h.
 */

require("dotenv").config();
const cron = require("node-cron");
const { syncFulfillmentEvents } = require("../fulfillment/syncEvents");
const logger = require("../logger");

const POLL_CRON = process.env.POLL_CRON || "0 */3 * * *";

function start() {
  if (!cron.validate(POLL_CRON)) {
    throw new Error(`Invalid POLL_CRON expression: "${POLL_CRON}"`);
  }

  logger.info(`Scheduler started — cron: ${POLL_CRON}`);

  // Run immediately on startup so we don't wait for the first cron fire
  syncFulfillmentEvents().catch((err) =>
    logger.error("Sync error (initial run)", { error: err.message })
  );

  cron.schedule(POLL_CRON, () => {
    syncFulfillmentEvents().catch((err) =>
      logger.error("Sync error (scheduled run)", { error: err.message })
    );
  });
}

module.exports = { start };
