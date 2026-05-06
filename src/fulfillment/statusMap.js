/**
 * Mapeia descrições brutas dos Correios/Jadlog para status do Shopify FulfillmentEvent.
 * https://shopify.dev/docs/api/admin-rest/2024-01/resources/fulfillmentevent
 *
 * Usa matching parcial (includes) sem acento e case-insensitive.
 * Correios: descrições longas em português
 * Jadlog:   status em maiúsculo (TRANSFERENCIA, EM ROTA, ENTRADA, etc.)
 */

const STATUS_RULES = [
  // ── Postagem / Coleta ────────────────────────────────────────────────────────
  {
    keywords: ["postado", "coletado", "coleta solicitada", "etiqueta emitida", "prepostagem"],
    shopify: "label_purchased",
  },
  // ── Em trânsito / Transferência ───────────────────────────────────────────────
  {
    keywords: [
      "transito", "transferencia", "transferido", "triagem",
      "encaminhado", "em rota", "entrada", "em tratamento",
      "aguardando tratamento", "recebido", "fiscalizacao",
    ],
    shopify: "in_transit",
  },
  // ── Saiu para entrega ─────────────────────────────────────────────────────────
  {
    keywords: ["saiu para entrega", "saida para entrega", "em entrega", "out for delivery"],
    shopify: "out_for_delivery",
  },
  // ── Entregue ──────────────────────────────────────────────────────────────────
  {
    keywords: ["entregue", "entrega realizada", "entrega efetuada"],
    shopify: "delivered",
  },
  // ── Falha / Tentativa ─────────────────────────────────────────────────────────
  {
    keywords: [
      "tentativa", "ausente", "nao encontrado", "nao entregue",
      "endereco incorreto", "recusado", "devolvido", "trafego interrompido",
    ],
    shopify: "failure",
  },
  // ── Aguardando retirada ───────────────────────────────────────────────────────
  {
    keywords: ["aguardando retirada", "disponivel para retirada", "retirada"],
    shopify: "ready_for_pickup",
  },
];

function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/[^a-z0-9 ]/g, " ")    // remove caracteres especiais
    .trim();
}

/**
 * Recebe a descrição bruta da transportadora e retorna o status Shopify,
 * ou null se não houver mapeamento.
 */
function toShopifyStatus(rawStatus) {
  if (!rawStatus) return null;
  const normalized = normalize(rawStatus);

  for (const rule of STATUS_RULES) {
    for (const keyword of rule.keywords) {
      if (normalized.includes(normalize(keyword))) {
        return rule.shopify;
      }
    }
  }

  return null;
}

module.exports = { toShopifyStatus };
