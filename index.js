require("dotenv").config();
const logger = require("./src/logger");
const scheduler = require("./src/scheduler");

const required = ["SHOPIFY_SHOP_DOMAIN", "SHOPIFY_ACCESS_TOKEN"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  logger.error(`Missing required env vars: ${missing.join(", ")} — copy .env.example to .env`);
  process.exit(1);
}

logger.info("Shopify AI Toolkit starting");
scheduler.start();
