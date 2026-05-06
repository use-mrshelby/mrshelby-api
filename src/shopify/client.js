/**
 * Shopify REST client with:
 *   - bearer-token auth from env
 *   - rate limit: max 2 requests/second via queue + delay
 *   - retry with exponential backoff on 429 / 5xx (up to 3 attempts)
 */

require("dotenv").config();
const axios = require("axios");
const logger = require("../logger");

const BASE_URL = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/${
  process.env.SHOPIFY_API_VERSION || "2024-01"
}`;

const HEADERS = {
  "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
  "Content-Type": "application/json",
};

// ── Rate-limit queue ──────────────────────────────────────────────────────────
// Shopify leaky-bucket: 40 req/s burst, but we self-limit to 2/s to be safe.
const MIN_INTERVAL_MS = 500; // 1000ms / 2 calls = 500ms between calls
let lastCallAt = 0;

async function throttle() {
  const now = Date.now();
  const elapsed = now - lastCallAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }
  lastCallAt = Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────
const MAX_RETRIES = 3;

async function requestWithRetry(config, attempt = 1) {
  await throttle();

  try {
    const response = await axios({ ...config, headers: { ...HEADERS, ...config.headers } });
    return response;
  } catch (err) {
    const status = err.response?.status;
    const retryable = status === 429 || (status >= 500 && status < 600);

    if (retryable && attempt < MAX_RETRIES) {
      const backoffMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      logger.warn(
        `Shopify ${status} — retrying in ${backoffMs}ms (attempt ${attempt}/${MAX_RETRIES})`,
        { url: config.url, status }
      );
      await sleep(backoffMs);
      return requestWithRetry(config, attempt + 1);
    }

    throw err;
  }
}

// ── Public client ─────────────────────────────────────────────────────────────
const shopify = {
  get(path, params = {}) {
    return requestWithRetry({ method: "GET", url: `${BASE_URL}${path}`, params });
  },

  post(path, data) {
    return requestWithRetry({ method: "POST", url: `${BASE_URL}${path}`, data });
  },
};

module.exports = shopify;
