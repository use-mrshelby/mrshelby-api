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
// LIMPAR_AVISOS="AA123456789BR,BB987654321BR" zera as marcações desses
// trackings no startup, para o cliente voltar a receber o aviso.
if (process.env.LIMPAR_AVISOS) {
  const { limparAvisos } = require("./scripts/limpar-avisos");
  try {
    logger.info("Marcações de aviso zeradas", limparAvisos(process.env.LIMPAR_AVISOS));
  } catch (err) {
    logger.error("Falha ao limpar marcações de aviso", { error: err.message });
  }
}

if (process.env.AMOSTRAS_PARA) {
  const { enviarAmostras } = require("./scripts/enviar-amostras");
  enviarAmostras(process.env.AMOSTRAS_PARA)
    .then((r) => logger.info("Amostras enviadas", r))
    .catch((err) => logger.error("Falha ao enviar amostras", { error: err.message }));
}

scheduler.start();
