/**
 * JSON-file persistence layer.
 *
 * Stores a map of tracking_number → { last_status, shopify_order_id,
 * shopify_fulfillment_id, updated_at } to avoid redundant Shopify calls.
 *
 * Switch to a proper DB (SQLite, Postgres) if you need concurrent writers
 * or the dataset grows beyond a few thousand records.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const DB_PATH = path.resolve(process.env.DB_PATH || "./data/tracking.json");

function _load() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) return {};
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function _save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
}

function getTracking(trackingNumber) {
  const data = _load();
  return data[trackingNumber] ?? null;
}

// Todos os registros, para o painel de acompanhamento.
function listarTrackings() {
  return _load();
}

function upsertTracking({ trackingNumber, lastStatus, rawStatus, orderId, fulfillmentId, deliveredCleared, avisosEnviados, linkAjustado, atributoStatus, atributoSituacao, prazoRetirada, eventoEm }) {
  const data = _load();
  const existing = data[trackingNumber] ?? {};
  const mudouStatus = existing.last_status !== lastStatus || existing.raw_status !== rawStatus;
  data[trackingNumber] = {
    last_status: lastStatus,
    // texto original da transportadora e desde quando ele não muda — o painel
    // usa os dois para mostrar o motivo e há quantos dias o pedido está parado
    raw_status: rawStatus ?? existing.raw_status ?? null,
    status_desde: mudouStatus ? new Date().toISOString() : existing.status_desde ?? new Date().toISOString(),
    shopify_order_id: orderId ?? existing.shopify_order_id ?? null,
    shopify_fulfillment_id: fulfillmentId ?? existing.shopify_fulfillment_id ?? null,
    // true = já conferimos que não sobrou evento "delivered" errado neste envio
    delivered_cleared: deliveredCleared ?? existing.delivered_cleared ?? false,
    // { retirada: "2026-09-23T...", prazo_final: ..., tentativa: ..., devolucao: ... }
    // Cada aviso sai uma vez só por remessa. avisosEnviados: null zera tudo.
    avisos_enviados: avisosEnviados === null ? {} : { ...(existing.avisos_enviados ?? {}), ...(avisosEnviados ?? {}) },
    // true = o link do envio já aponta para a página de rastreio da loja
    link_ajustado: linkAjustado ?? existing.link_ajustado ?? false,
    // último status já gravado nos atributos do pedido (gatilho do Martz)
    atributo_status: atributoStatus ?? existing.atributo_status ?? null,
    // situação detalhada já gravada no pedido — é por ela que o Martz separa
    // as campanhas que o status da Shopify junta num valor só
    atributo_situacao: atributoSituacao ?? existing.atributo_situacao ?? null,
    // o que a equipe já fez com o caso no painel (etapa, histórico, adiamento).
    // Quem mexe nisso é o painel, não o ciclo — aqui só preservamos.
    tratativa: existing.tratativa ?? null,
    // data limite de retirada na agência (só os Correios informam). O painel
    // mostra quantos dias faltam; sem isso ele não sabe o prazo real.
    prazo_retirada: prazoRetirada ?? existing.prazo_retirada ?? null,
    // quando a TRANSPORTADORA registrou o último evento. Diferente de
    // status_desde, que é quando o nosso sistema viu a mudança: se a gente
    // corrige um mapeamento, status_desde reinicia e o prazo do painel mente.
    evento_em: eventoEm ?? existing.evento_em ?? null,
    updated_at: new Date().toISOString(),
  };
  _save(data);
}

/**
 * Atualiza só os campos informados, preservando o resto do registro.
 * Usado para o controle de códigos que a transportadora não reconhece.
 */
function patchTracking(trackingNumber, campos) {
  const data = _load();
  data[trackingNumber] = {
    ...(data[trackingNumber] ?? {}),
    ...campos,
    updated_at: new Date().toISOString(),
  };
  _save(data);
}

module.exports = { getTracking, listarTrackings, upsertTracking, patchTracking };
