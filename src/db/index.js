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

function upsertTracking({ trackingNumber, lastStatus, orderId, fulfillmentId }) {
  const data = _load();
  const existing = data[trackingNumber] ?? {};
  data[trackingNumber] = {
    last_status: lastStatus,
    shopify_order_id: orderId ?? existing.shopify_order_id ?? null,
    shopify_fulfillment_id: fulfillmentId ?? existing.shopify_fulfillment_id ?? null,
    updated_at: new Date().toISOString(),
  };
  _save(data);
}

module.exports = { getTracking, upsertTracking };
