/**
 * Mr. Shelby tracking integration.
 *
 * Busca os tracking numbers dos pedidos enviados na Shopify,
 * consulta os status reais nas APIs de Correios e Jadlog (Vercel)
 * e retorna: [{ tracking_number: string, status: string }]
 */

require("dotenv").config();
const axios = require("axios");
const shopify = require("../shopify/client");
const logger = require("../logger");

const API_BASE = (process.env.MR_SHELBY_API_URL || "https://mrshelby-api.vercel.app").replace(/\/$/, "");

// Correios: AA123456789BR | Melhor Envio: começa com ME | Jadlog: o resto
const CORREIOS_REGEX = /^[A-Z]{2}\d{9}[A-Z]{2}$/i;
const MELHOR_ENVIO_REGEX = /^ME[0-9A-Z]{6,}$/i;

function getCarrier(trackingNumber) {
  const codigo = trackingNumber.trim();
  if (CORREIOS_REGEX.test(codigo)) return "correios";
  if (MELHOR_ENVIO_REGEX.test(codigo)) return "melhorenvio";
  return "jadlog";
}

// ── Correios ──────────────────────────────────────────────────────────────────
async function getCorreiosStatus(trackingNumber) {
  const response = await axios.post(
    `${API_BASE}/api/correios`,
    { codigo: trackingNumber },
    { timeout: 15000 }
  );
  const eventos = response.data?.eventos;
  if (!eventos?.length) return null;
  // O evento mais recente vai junto: os avisos ao cliente usam o endereço da
  // agência, o prazo de retirada e o detalhe escrito pelos Correios.
  return { status: eventos[0].descricao ?? null, evento: eventos[0] };
}

// ── Melhor Envio ──────────────────────────────────────────────────────────────
// Mesma resposta dos Correios (lista de eventos), em outra rota.
async function getMelhorEnvioStatus(trackingNumber) {
  const response = await axios.post(
    `${API_BASE}/api/melhorenvio`,
    { codigo: trackingNumber },
    { timeout: 15000 }
  );
  const eventos = response.data?.eventos;
  if (!eventos?.length) return null;
  return { status: eventos[0].descricao ?? null, evento: eventos[0] };
}

// ── Jadlog ────────────────────────────────────────────────────────────────────
async function getJadlogStatus(trackingNumber) {
  const response = await axios.post(
    `${API_BASE}/api/jadlog`,
    { codigo: trackingNumber },
    { timeout: 15000 }
  );
  const tracking = response.data?.tracking;
  if (!tracking) return null;
  const status = tracking.status ?? tracking.situacao ?? tracking.descricao ?? null;
  return status ? { status, evento: (tracking.eventos && tracking.eventos[0]) || null } : null;
}

// ── Busca tracking numbers dos pedidos enviados na Shopify ────────────────────
async function getActiveTrackingsFromShopify() {
  const trackings = new Set();
  let pageInfo = null;

  do {
    // Quando page_info está presente não pode misturar outros filtros (regra Shopify)
    // Filtra apenas pedidos dos últimos 60 dias para evitar rastreios expirados
    const since = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const params = pageInfo
      ? { page_info: pageInfo, limit: 50 }
      : { status: "any", fulfillment_status: "shipped", updated_at_min: since, limit: 50 };

    const response = await shopify.get("/orders.json", params);
    const orders = response.data.orders ?? [];
    const linkHeader = response.headers["link"] ?? "";

    for (const order of orders) {
      for (const fulfillment of order.fulfillments ?? []) {
        // Remessa já entregue não muda mais: não precisa consultar a
        // transportadora nem a Shopify a cada ciclo.
        if (fulfillment.shipment_status === "delivered") continue;
        if (fulfillment.tracking_number) {
          trackings.add(fulfillment.tracking_number.trim());
        }
      }
    }

    const nextMatch = linkHeader.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    pageInfo = nextMatch ? nextMatch[1] : null;
  } while (pageInfo);

  return [...trackings];
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function getActiveTrackings() {
  let trackingNumbers;

  try {
    trackingNumbers = await getActiveTrackingsFromShopify();
    logger.info(`mrShelby: ${trackingNumbers.length} tracking(s) ativos encontrados na Shopify`);
  } catch (err) {
    logger.error("mrShelby: falha ao buscar trackings da Shopify", { error: err.message });
    return [];
  }

  const results = [];

  for (const trackingNumber of trackingNumbers) {
    const carrier = getCarrier(trackingNumber);
    try {
      const consulta = {
        correios: getCorreiosStatus,
        melhorenvio: getMelhorEnvioStatus,
        jadlog: getJadlogStatus,
      }[carrier];
      const resultado = await consulta(trackingNumber);

      const rawStatus = resultado && resultado.status;
      if (rawStatus) {
        results.push({ tracking_number: trackingNumber, status: rawStatus, evento: resultado.evento });
        logger.info("mrShelby: status obtido", { trackingNumber, carrier, rawStatus });
      } else {
        logger.warn("mrShelby: resposta sem status", { trackingNumber, carrier });
      }
    } catch (err) {
      logger.warn("mrShelby: falha ao consultar transportadora", {
        trackingNumber,
        carrier,
        error: err.message,
        httpStatus: err.response?.status,
      });
    }
  }

  return results;
}

module.exports = { getActiveTrackings };
