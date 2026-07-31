/**
 * Cria a remessa (fulfillment) na Shopify para pedidos Correios LOG+ que JÁ
 * têm código de rastreio no Bling mas continuam UNFULFILLED na Shopify.
 *
 * Contexto: com Jadlog/Melhor Envio o código nasce na hora do envio, então o
 * Bling já empurra a remessa pra Shopify. No Correios LOG+ o código só aparece
 * depois (o Correios posta o objeto horas/dias depois), e o Bling não re-dispara
 * — então esses pedidos ficam presos em UNFULFILLED. Este passo preenche esse
 * buraco: assim que o código existe no Bling, cria a remessa na Shopify com o
 * rastreio apontando pra página da loja e notifica o cliente (se em trânsito).
 *
 * Depois disso, o syncFulfillmentEvents (já existente) assume e mantém o status
 * de entrega atualizado.
 */

require("dotenv").config();
const shopify = require("../shopify/client");
const { blingGet } = require("../bling/client");
const logger = require("../logger");

// ── Constantes ────────────────────────────────────────────────────────────────
const LOJA_SHOPIFY_BLING = "205010163";            // loja.id do canal Shopify no Bling
const CORREIOS_CONTATO_ID = 18222146030;           // transportadora "Correios" no Bling
const TRACKING_URL =
  process.env.CORREIOS_LOG_TRACKING_URL || "https://www.mrshelby.com.br/pages/rastreio";
const TRACKING_COMPANY = process.env.CORREIOS_LOG_COMPANY || "Correios";
const MAP_DIAS = parseInt(process.env.CORREIOS_LOG_MAP_DIAS || "12", 10); // janela p/ casar Shopify↔Bling

function isCorreiosLog(order) {
  const t = order?.transporte || {};
  if (Number(t?.contato?.id) === CORREIOS_CONTATO_ID) return true;
  const serv = t?.volumes?.[0]?.servico || "";
  return /correios\s*log/i.test(serv);
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function extractNextPageInfo(linkHeader) {
  const m = (linkHeader || "").match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
  return m ? m[1] : null;
}

// ── 1) Pedidos Shopify em aberto (pagos, não enviados) ──────────────────────────
async function getUnfulfilledOrders() {
  const orders = [];
  let pageInfo = null;

  do {
    // status: "any" para INCLUIR pedidos arquivados (closed). A loja arquiva o
    // pedido após emitir a NF, e o código do Correios LOG+ costuma chegar depois
    // disso — com "open" a ponte não enxergava justamente esses. Cancelados são
    // ignorados abaixo.
    const params = pageInfo
      ? { page_info: pageInfo, limit: 50 }
      : { status: "any", financial_status: "paid", fulfillment_status: "unfulfilled", limit: 50 };

    const resp = await shopify.get("/orders.json", params);
    for (const o of resp.data.orders ?? []) {
      if (o.cancelled_at) continue; // não mexe em pedidos cancelados
      orders.push({ id: String(o.id), name: o.name });
    }
    pageInfo = extractNextPageInfo(resp.headers["link"]);
  } while (pageInfo);

  return orders;
}

// ── 2) Mapa numeroLoja(Shopify) → idPedido(Bling), só do canal Shopify ──────────
async function buildBlingOrderMap() {
  const map = new Map();
  const dataInicial = ymd(new Date(Date.now() - MAP_DIAS * 24 * 60 * 60 * 1000));
  const dataFinal = ymd(new Date());

  for (let pagina = 1; pagina <= 30; pagina++) {
    let body;
    try {
      body = await blingGet("pedidos/vendas", {
        dataInicial,
        dataFinal,
        pagina: String(pagina),
      });
    } catch (err) {
      logger.error("createFulfillments: falha ao listar pedidos do Bling", {
        pagina,
        error: err.message,
      });
      break;
    }
    const arr = body?.data ?? [];
    if (!arr.length) break;

    for (const p of arr) {
      const loja = String(p?.loja?.id ?? "");
      const situacao = Number(p?.situacao?.valor);
      if (loja === LOJA_SHOPIFY_BLING && situacao !== 2 && p.numeroLoja) {
        if (!map.has(String(p.numeroLoja))) map.set(String(p.numeroLoja), p.id);
      }
    }
    if (arr.length < 100) break;
  }

  return map;
}

// ── 3) Cria a remessa na Shopify (via FulfillmentOrders, REST 2024-01) ──────────
async function createShopifyFulfillment(orderId, code, notify) {
  const foResp = await shopify.get(`/orders/${orderId}/fulfillment_orders.json`);
  const fos = foResp.data.fulfillment_orders ?? [];
  const open = fos.find((f) => f.status === "open");
  if (!open) {
    logger.info("createFulfillments: sem fulfillment order OPEN — pulando", { orderId });
    return false;
  }

  await shopify.post("/fulfillments.json", {
    fulfillment: {
      line_items_by_fulfillment_order: [{ fulfillment_order_id: open.id }],
      tracking_info: { number: code, url: TRACKING_URL, company: TRACKING_COMPANY },
      notify_customer: notify,
    },
  });
  return true;
}

// ── Orquestração ────────────────────────────────────────────────────────────────
async function createMissingCorreiosLogFulfillments() {
  logger.info("createMissingCorreiosLogFulfillments: starting run");

  let unfulfilled;
  try {
    unfulfilled = await getUnfulfilledOrders();
  } catch (err) {
    logger.error("createFulfillments: falha ao buscar pedidos Shopify", { error: err.message });
    return;
  }

  if (!unfulfilled.length) {
    logger.info("createFulfillments: nenhum pedido UNFULFILLED — nada a fazer");
    return;
  }

  let map;
  try {
    map = await buildBlingOrderMap();
  } catch (err) {
    logger.error("createFulfillments: falha ao montar mapa do Bling", { error: err.message });
    return;
  }

  let processed = 0;
  let waiting = 0;

  for (const order of unfulfilled) {
    const blingId = map.get(order.id);
    if (!blingId) continue; // não é do canal Shopify / fora da janela

    try {
      const detBody = await blingGet(`pedidos/vendas/${blingId}`);
      const pedido = detBody?.data;
      if (!pedido || !isCorreiosLog(pedido)) continue; // só Correios LOG+

      const vol = pedido?.transporte?.volumes?.[0];
      if (!vol) {
        waiting++;
        continue;
      }

      // Código: prioriza o do objeto de logística (mais atual) sobre o do volume.
      let code = vol.codigoRastreamento || "";
      let descricao = "";
      if (vol.id) {
        try {
          const objBody = await blingGet(`logisticas/objetos/${vol.id}`);
          const r = objBody?.data?.rastreamento || {};
          if (r.codigo) code = r.codigo;
          descricao = r.descricao || "";
        } catch (e) {
          logger.warn("createFulfillments: falha ao ler objeto de logística", {
            volumeId: vol.id,
            error: e.message,
          });
        }
      }

      if (!code) {
        waiting++; // Correios ainda não postou/gerou o código
        continue;
      }

      // Só notifica se ainda em trânsito (regra do negócio: entregue não recebe e-mail).
      const notify = !/entregue|entrega\s+realizada|entrega\s+efetuada/i.test(descricao);

      const ok = await createShopifyFulfillment(order.id, code, notify);
      if (ok) {
        processed++;
        logger.info("createFulfillments: remessa criada", {
          order: order.name,
          orderId: order.id,
          code,
          notify,
        });
      }
    } catch (err) {
      logger.error("createFulfillments: erro ao processar pedido", {
        order: order.name,
        orderId: order.id,
        error: err.message,
        httpStatus: err.response?.status,
      });
    }
  }

  logger.info("createMissingCorreiosLogFulfillments: run complete", {
    unfulfilled: unfulfilled.length,
    processed,
    waiting,
  });
}

module.exports = { createMissingCorreiosLogFulfillments };
