/**
 * Core sync logic: polls Mr. Shelby trackings and pushes FulfillmentEvents
 * to Shopify for any status that changed since the last run.
 *
 * Resiliência a rate limit (429): cada tracking é processado de forma isolada —
 * uma falha (inclusive 429 na busca da remessa) NÃO derruba a rodada inteira;
 * o item é pulado e re-tentado no próximo ciclo. Assim o sync sempre conclui e
 * "guarda" o progresso dos que deram certo, colocando o backlog em dia aos poucos.
 */

const { getActiveTrackings } = require("../tracking/mrShelby");
const { getTracking, upsertTracking } = require("../db");
const { toShopifyStatus } = require("./statusMap");
const { findFulfillmentByTracking, getFulfillmentId } = require("./shopifyOrders");
const shopify = require("../shopify/client");
const logger = require("../logger");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const NOT_DELIVERED_STATUSES = new Set(["attempted_delivery", "failure"]);

async function removeDeliveredEvents(orderId, fulfillmentId, trackingNumber) {
  const base = `/orders/${orderId}/fulfillments/${fulfillmentId}/events`;
  const { data } = await shopify.get(`${base}.json`);
  const delivered = (data.fulfillment_events ?? []).filter((ev) => ev.status === "delivered");

  for (const ev of delivered) {
    await shopify.delete(`${base}/${ev.id}.json`);
    logger.info("Evento delivered incorreto removido", {
      trackingNumber,
      orderId,
      fulfillmentId,
      eventId: ev.id,
      happenedAt: ev.happened_at,
    });
  }
}

async function syncFulfillmentEvents() {
  logger.info("syncFulfillmentEvents: starting run");

  let trackings;
  try {
    trackings = await getActiveTrackings();
  } catch (err) {
    logger.error("Failed to fetch trackings from Mr. Shelby", { error: err.message });
    return;
  }

  logger.info(`syncFulfillmentEvents: ${trackings.length} active trackings received`);

  let updated = 0;
  let skipped = 0;

  for (const { tracking_number, status } of trackings) {
    // processTracking nunca lança — retorna um resultado pra estatística.
    const outcome = await processTracking(tracking_number, status);
    if (outcome === "updated") updated++;
    else if (outcome === "error") skipped++;
  }

  logger.info("syncFulfillmentEvents: run complete", { updated, skipped });
}

/**
 * Processa um tracking. NUNCA lança exceção — em caso de erro (inclusive 429),
 * registra e retorna "error" pra que o loop continue e a rodada conclua.
 * Retorna: "updated" | "unchanged" | "skip" | "error".
 */
async function processTracking(trackingNumber, rawStatus) {
  const shopifyStatus = toShopifyStatus(rawStatus);

  if (!shopifyStatus) {
    logger.warn("Unknown status — skipping", { trackingNumber, rawStatus });
    return "skip";
  }

  // Skip if Shopify already has this status (checagem local, sem chamar a Shopify).
  // Exceção: enquanto a transportadora não disser "entregue", um evento
  // "delivered" antigo mantém a página do pedido mostrando "Entregue" para o
  // cliente. A limpeza roda uma vez por tracking (flag delivered_cleared).
  const record = getTracking(trackingNumber);
  const unchanged = record?.last_status === shopifyStatus;
  const precisaLimpar = shopifyStatus !== "delivered" && !record?.delivered_cleared;

  if (unchanged && !precisaLimpar) {
    logger.info("Status unchanged — skipping Shopify call", { trackingNumber, shopifyStatus });
    return "unchanged";
  }

  try {
    // Resolve order_id + fulfillment_id (use cache when available)
    let orderId = record?.shopify_order_id ?? null;
    let fulfillmentId = record?.shopify_fulfillment_id ?? null;

    if (!orderId) {
      const found = await findFulfillmentByTracking(trackingNumber);
      if (!found) {
        logger.error("Order not found in Shopify — cannot create event", { trackingNumber });
        return "skip";
      }
      orderId = found.orderId;
      fulfillmentId = found.fulfillmentId;
    } else if (!fulfillmentId) {
      fulfillmentId = await getFulfillmentId(orderId, trackingNumber);
      if (!fulfillmentId) {
        logger.error("Fulfillment not found for cached order — cannot create event", {
          trackingNumber,
          orderId,
        });
        return "skip";
      }
    }

    // A transportadora não diz "entregue": qualquer evento "delivered" anterior
    // está errado e é removido antes do evento novo.
    if (precisaLimpar) {
      await removeDeliveredEvents(orderId, fulfillmentId, trackingNumber);
    }

    if (unchanged) {
      // Só faltava a limpeza; o status em si já está na Shopify.
      upsertTracking({ trackingNumber, lastStatus: shopifyStatus, orderId, fulfillmentId, deliveredCleared: true });
      logger.info("Status unchanged — apenas limpeza aplicada", { trackingNumber, shopifyStatus });
      return "unchanged";
    }

    // Create the FulfillmentEvent in Shopify
    await shopify.post(
      `/orders/${orderId}/fulfillments/${fulfillmentId}/events.json`,
      // message: descrição original dos Correios, exibida ao cliente na página do pedido
      { event: { status: shopifyStatus, message: rawStatus } }
    );

    logger.info("FulfillmentEvent created", {
      timestamp: new Date().toISOString(),
      trackingNumber,
      shopifyStatus,
      orderId,
      fulfillmentId,
    });

    upsertTracking({
      trackingNumber,
      lastStatus: shopifyStatus,
      orderId,
      fulfillmentId,
      deliveredCleared: precisaLimpar || record?.delivered_cleared || false,
    });
    return "updated";
  } catch (err) {
    const httpStatus = err.response?.status;
    // Erro isolado por tracking: registra e segue (não derruba a rodada).
    logger.error("Falha ao sincronizar tracking — pulando (não derruba a rodada)", {
      trackingNumber,
      shopifyStatus,
      error: err.message,
      httpStatus,
    });
    // Se foi rate limit, dá um respiro pro leaky-bucket da Shopify se recuperar
    // antes do próximo item.
    if (httpStatus === 429) await sleep(3000);
    return "error";
  }
}

module.exports = { syncFulfillmentEvents };
