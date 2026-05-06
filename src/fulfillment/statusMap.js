/**
 * Mapeia descrições brutas dos Correios/Jadlog para status do Shopify FulfillmentEvent.
 * https://shopify.dev/docs/api/admin-rest/2024-01/resources/fulfillmentevent
 *
 * Usa matching parcial (includes) pois as transportadoras retornam descrições
 * completas como "Objeto entregue ao destinatário" em vez de só "Entregue".
 */

const STATUS_RULES = [
  { keywords: ["postado"],                        shopify: "label_purchased" },
  { keywords: ["trânsito", "transito", "triagem", "encaminhado"], shopify: "in_transit" },
  { keywords: ["saiu para entrega"],              shopify: "out_for_delivery" },
  { keywords: ["entregue", "entrega realizada"],  shopify: "delivered" },
  { keywords: ["tentativa", "ausente", "não encontrado"], shopify: "failure" },
  { keywords: ["aguardando retirada", "disponível para retirada"], shopify: "ready_for_pickup" },
];

/**
 * Recebe a descrição bruta da transportadora e retorna o status Shopify,
 * ou null se não houver mapeamento.
 */
function toShopifyStatus(rawStatus) {
  if (!rawStatus) return null;
  const lower = rawStatus.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  for (const rule of STATUS_RULES) {
    for (const keyword of rule.keywords) {
      const normalizedKeyword = keyword.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (lower.includes(normalizedKeyword)) {
        return rule.shopify;
      }
    }
  }

  return null;
}

module.exports = { toShopifyStatus };
