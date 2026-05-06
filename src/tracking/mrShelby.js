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

// Correios: formato AA123456789BR  |  Jadlog: qualquer outro formato
const CORREIOS_REGEX = /^[A-Z]{2}\d{9}[A-Z]{2}$/i;

function getCarrier(trackingNumber) {
  return CORREIOS_REGEX.test(trackingNumber.trim()) ? "correios" : "jadlog";
}

// ── Correios ──────────────────────────────────────────────────────────────────
async function getCorreiosStatus(trackingNumber) {
  const response = await axios.post(
    `${API_BASE}/API/correios`,
    { codigo: trackingNumber },
    { timeout: 15000 }
  );
  const eventos = response.data?.eventos;
  if (!eventos?.length) return null;
  return eventos[0].descricao ?? null;
}

// ── Jadlog ────────────────────────────────────────────────────────────────────
async function getJadlogStatus(trackingNumber) {
  const response = await axios.post(
    `${API_BASE}/API/jadlog`,
    { codigo: trackingNumber },
    { timeout: 15000 }
  );
  const tracking = response.data?.tracking;
  if (!tracking) return null;
  return tracking.status ?? tracking.situacao ?? tracking.descricao ?? null;
}

// ── Busca tracking numbers dos pedidos enviados na Shopify ────────────────────
async function getActiveTrackingsFromShopify() {
  const trackings = new Set();
  let pageInfo = null;

  do {
    const params = {
      status: "any",
      fulfillment_status: "shipped",
      limit: 50,
      fields: "id,fulfillments",
    };
    if (pageInfo) params.page_info = pageInfo;

    const response = await shopify.get("/orders.json", params);
    const orders = response.data.orders ?? [];
    const linkHeader = response.headers["link"] ?? "";

    for (const order of orders) {
      for (const fulfillment of order.fulfillments ?? []) {
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
      const rawStatus = carrier === "correios"
        ? await getCorreiosStatus(trackingNumber)
        : await getJadlogStatus(trackingNumber);

      if (rawStatus) {
        results.push({ tracking_number: trackingNumber, status: rawStatus });
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
