/**
 * Helpers to look up the Shopify order_id and fulfillment_id for a given
 * tracking number by paginating through all shipped orders.
 *
 * Results are cached in SQLite (shopify_order_id / shopify_fulfillment_id)
 * so each tracking number is only searched once.
 */

const shopify = require("../shopify/client");
const logger = require("../logger");

const PAGE_LIMIT = 50;

/**
 * Searches paginated shipped orders until a fulfillment with the given
 * tracking_number is found.
 *
 * Returns { orderId, fulfillmentId } or null if not found.
 */
async function findFulfillmentByTracking(trackingNumber) {
  let pageInfo = null;
  let page = 0;

  do {
    page++;
    const params = {
      status: "any",
      fulfillment_status: "shipped",
      limit: PAGE_LIMIT,
    };
    if (pageInfo) params.page_info = pageInfo;

    const response = await shopify.get("/orders.json", params);
    const orders = response.data.orders ?? [];
    const linkHeader = response.headers["link"] ?? "";

    for (const order of orders) {
      const fulfillments = order.fulfillments ?? [];
      for (const fulfillment of fulfillments) {
        const trackedNumbers = [fulfillment.tracking_number].flat().filter(Boolean);
        if (trackedNumbers.includes(trackingNumber)) {
          logger.info("Found fulfillment", {
            trackingNumber,
            orderId: String(order.id),
            fulfillmentId: String(fulfillment.id),
            page,
          });
          return { orderId: String(order.id), fulfillmentId: String(fulfillment.id) };
        }
      }
    }

    pageInfo = extractNextPageInfo(linkHeader);
  } while (pageInfo);

  logger.warn("Fulfillment not found for tracking", { trackingNumber, pages: page });
  return null;
}

/**
 * Fetches fulfillments for a known order to confirm the fulfillment_id.
 * Used when orderId is cached but fulfillmentId is missing.
 */
async function getFulfillmentId(orderId, trackingNumber) {
  const response = await shopify.get(`/orders/${orderId}/fulfillments.json`);
  const fulfillments = response.data.fulfillments ?? [];
  const match = fulfillments.find((f) => {
    const nums = [f.tracking_number].flat().filter(Boolean);
    return nums.includes(trackingNumber);
  });
  return match ? String(match.id) : null;
}

// Parses the Shopify Link header to extract the next page_info token.
// Example: <https://…?page_info=abc&limit=50>; rel="next"
function extractNextPageInfo(linkHeader) {
  const nextMatch = linkHeader.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
  return nextMatch ? nextMatch[1] : null;
}

module.exports = { findFulfillmentByTracking, getFulfillmentId };
