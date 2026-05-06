/**
 * Maps Mr. Shelby / Correios status strings to Shopify FulfillmentEvent statuses.
 * https://shopify.dev/docs/api/admin-rest/2024-01/resources/fulfillmentevent
 */
const STATUS_MAP = {
  "Objeto postado":       "label_purchased",
  "Em trânsito":          "in_transit",
  "Saiu para entrega":    "out_for_delivery",
  "Entregue":             "delivered",
  "Tentativa de entrega": "failure",
  "Aguardando retirada":  "ready_for_pickup",
};

/**
 * Returns the Shopify status string, or null if the status is unknown/unmapped.
 */
function toShopifyStatus(rawStatus) {
  return STATUS_MAP[rawStatus] ?? null;
}

module.exports = { toShopifyStatus };
