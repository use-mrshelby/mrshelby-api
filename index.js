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

// AMOSTRAS_PARA=email@exemplo.com faz o serviço enviar, no startup, um exemplo
// de cada aviso ao cliente (dados fictícios). Serve para revisar texto e
// layout; depois é só apagar a variável.
if (process.env.AMOSTRAS_PARA) {
  const { enviarAmostras } = require("./scripts/enviar-amostras");
  enviarAmostras(process.env.AMOSTRAS_PARA)
    .then((r) => logger.info("Amostras enviadas", r))
    .catch((err) => logger.error("Falha ao enviar amostras", { error: err.message }));
}

scheduler.start();
