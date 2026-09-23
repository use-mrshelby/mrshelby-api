/**
 * Mapeia descrições brutas dos Correios/Jadlog para status do Shopify FulfillmentEvent.
 * https://shopify.dev/docs/api/admin-rest/2024-01/resources/fulfillmentevent
 *
 * Usa matching parcial (includes) sem acento e case-insensitive.
 * Correios: descrições longas em português
 * Jadlog:   status em maiúsculo (TRANSFERENCIA, EM ROTA, ENTRADA, etc.)
 */

// A ordem importa: a primeira regra que casar vence. As situações negativas
// vêm antes de "entregue", porque os Correios escrevem "Objeto não entregue - ..."
// e "Objeto entregue ao remetente" (devolução), que contêm a palavra "entregue".
const STATUS_RULES = [
  // ── Devolução para a loja ─────────────────────────────────────────────────────
  {
    keywords: [
      "remetente", "devolvido", "devolucao", "prazo de retirada encerrado",
      "endereco incorreto", "recusado", "trafego interrompido",
    ],
    shopify: "failure",
  },
  // ── Tentativa de entrega sem sucesso ──────────────────────────────────────────
  {
    keywords: ["nao entregue", "carteiro nao atendido", "tentativa", "ausente", "nao encontrado"],
    shopify: "attempted_delivery",
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
  // ── Aguardando retirada ───────────────────────────────────────────────────────
  {
    keywords: ["aguardando retirada", "disponivel para retirada", "retirada"],
    shopify: "ready_for_pickup",
  },
  // ── Postagem / Coleta ────────────────────────────────────────────────────────
  {
    keywords: ["postado", "coletado", "coleta solicitada", "etiqueta emitida", "prepostagem"],
    shopify: "label_purchased",
  },
  // ── Em trânsito / Transferência ───────────────────────────────────────────────
  {
    keywords: [
      "transito", "transferencia", "transferido", "triagem",
      "encaminhado", "em rota", "correcao de rota", "entrada", "em tratamento",
      "aguardando tratamento", "recebido", "fiscalizacao",
    ],
    shopify: "in_transit",
  },
];

function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
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

/**
 * Texto do evento como ele aparece no painel da Shopify. As descrições dos
 * Correios falam em "remetente", que é a loja — quem lê o painel entende
 * melhor com o nome dela. Os demais eventos ficam com o texto original.
 */
const MENSAGENS = [
  { quando: /entregue ao remetente|devolvido ao remetente/i, texto: "Objeto devolvido à Mr. Shelby" },
  {
    quando: /prazo de retirada encerrado/i,
    texto: "Objeto não entregue - prazo de retirada encerrado. O objeto voltará para a Mr. Shelby.",
  },
];

function mensagemPainel(rawStatus) {
  if (!rawStatus) return rawStatus;
  const regra = MENSAGENS.find((m) => m.quando.test(rawStatus));
  return regra ? regra.texto : rawStatus;
}

module.exports = { toShopifyStatus, mensagemPainel };
