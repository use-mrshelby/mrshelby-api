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
    // When page_info is present, Shopify forbids mixing other filter params
    const params = pageInfo
      ? { page_info: pageInfo, limit: PAGE_LIMIT }
      : { status: "any", fulfillment_status: "shipped", limit: PAGE_LIMIT };

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

/**
 * Contato do cliente para os avisos de entrega: e-mail, nome e número do pedido
 * (ex.: MS15127). Retorna null se o pedido não tiver e-mail.
 */
async function getOrderContact(orderId) {
  const { data } = await shopify.get(`/orders/${orderId}.json`, {
    fields: "id,name,email,contact_email,customer,shipping_address",
  });
  const o = data.order;
  if (!o) return null;
  const nome =
    (o.customer && [o.customer.first_name, o.customer.last_name].filter(Boolean).join(" ")) ||
    (o.shipping_address && o.shipping_address.name) ||
    "";
  return { email: o.email || o.contact_email || null, nome, pedido: o.name || null };
}

/**
 * Grava o status da entrega como atributo do pedido (note_attributes).
 *
 * O Martz (e outras ferramentas) não enxergam o status do fulfillment, só os
 * atributos do pedido — é por eles que a campanha de WhatsApp é disparada.
 *
 * A API substitui a lista inteira de atributos, então lemos os atuais e
 * reescrevemos preservando tudo (dados de pagamento e endereço do gateway).
 * Retorna true se gravou, false se já estava com o mesmo valor.
 */
const ATRIBUTO_STATUS = "status_entrega";

async function setStatusEntregaAttribute(orderId, valor) {
  const { data } = await shopify.get(`/orders/${orderId}.json`, { fields: "id,note_attributes" });
  const atuais = data.order?.note_attributes ?? [];

  const jaTem = atuais.find((a) => a.name === ATRIBUTO_STATUS);
  if (jaTem && jaTem.value === valor) return false;

  const novos = atuais
    .filter((a) => a.name !== ATRIBUTO_STATUS)
    .concat([{ name: ATRIBUTO_STATUS, value: valor }]);

  await shopify.put(`/orders/${orderId}.json`, { order: { id: Number(orderId), note_attributes: novos } });
  return true;
}

module.exports = { findFulfillmentByTracking, getFulfillmentId, getOrderContact, setStatusEntregaAttribute };
