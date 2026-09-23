/**
 * Zera as marcações de aviso (avisos_enviados) de um ou mais trackings, para
 * que o cliente volte a receber o e-mail na próxima rodada.
 *
 * Uso:
 *   node scripts/limpar-avisos.js AA123456789BR,BB987654321BR
 *   variável LIMPAR_AVISOS="AA123456789BR,BB987654321BR" (roda no startup)
 */

require("dotenv").config();
const { getTracking, upsertTracking } = require("../src/db");

function limparAvisos(lista) {
  const codigos = String(lista || "")
    .split(/[,\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  const resultado = {};
  for (const codigo of codigos) {
    const r = getTracking(codigo);
    if (!r) {
      resultado[codigo] = "sem registro";
      continue;
    }
    const antes = Object.keys(r.avisos_enviados || {});
    upsertTracking({
      trackingNumber: codigo,
      lastStatus: r.last_status,
      orderId: r.shopify_order_id,
      fulfillmentId: r.shopify_fulfillment_id,
      deliveredCleared: r.delivered_cleared,
      avisosEnviados: null, // null = substitui o objeto inteiro por vazio
    });
    resultado[codigo] = antes.length ? `limpo (${antes.join(", ")})` : "já estava limpo";
  }
  return resultado;
}

module.exports = { limparAvisos };

if (require.main === module) {
  const lista = process.argv[2] || process.env.LIMPAR_AVISOS;
  if (!lista) {
    console.error("Informe os códigos: node scripts/limpar-avisos.js AA123456789BR,BB987654321BR");
    process.exit(1);
  }
  console.log(limparAvisos(lista));
}
