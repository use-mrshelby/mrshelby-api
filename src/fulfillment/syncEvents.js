/**
 * Core sync logic: polls Mr. Shelby trackings and pushes FulfillmentEvents
 * to Shopify for any status that changed since the last run.
 */

const { getActiveTrackings } = require("../tracking/mrShelby");
const { getTracking, upsertTracking } = require("../db");
const { toShopifyStatus } = require("./statusMap");
const { findFulfillmentByTracking, getFulfillmentId } = require("./shopifyOrders");
const shopify = require("../shopify/client");
const logger = require("../logger");

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

  for (const { tracking_number, status } of trackings) {
    await processTracking(tracking_number, status);
  }

  logger.info("syncFulfillmentEvents: run complete");
}

async function processTracking(trackingNumber, rawStatus) {
  const shopifyStatus = toShopifyStatus(rawStatus);

  if (!shopifyStatus) {
    logger.warn("Unknown status — skipping", { trackingNumber, rawStatus });
    return;
  }

  // Skip if Shopify already has this status
  const record = getTracking(trackingNumber);
  if (record?.last_status === shopifyStatus) {
    logger.info("Status unchanged — skipping Shopify call", { trackingNumber, shopifyStatus });
    return;
  }

  // Resolve order_id + fulfillment_id (use cache when available)
  let orderId = record?.shopify_order_id ?? null;
  let fulfillmentId = record?.shopify_fulfillment_id ?? null;

  if (!orderId) {
    const found = await findFulfillmentByTracking(trackingNumber);
    if (!found) {
      logger.error("Order not found in Shopify — cannot create event", { trackingNumber });
      return;
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
      return;
    }
  }

  // Create the FulfillmentEvent in Shopify
  try {
    await shopify.post(
      `/orders/${orderId}/fulfillments/${fulfillmentId}/events.json`,
      { event: { status: shopifyStatus } }
    );

    logger.info("FulfillmentEvent created", {
      timestamp: new Date().toISOString(),
      trackingNumber,
      shopifyStatus,
      orderId,
      fulfillmentId,
    });

    upsertTracking({ trackingNumber, lastStatus: shopifyStatus, orderId, fulfillmentId });
  } catch (err) {
    logger.error("Failed to create FulfillmentEvent", {
      trackingNumber,
      shopifyStatus,
      orderId,
      fulfillmentId,
      error: err.message,
      httpStatus: err.response?.status,
    });
  }
}

module.exports = { syncFulfillmentEvents };
