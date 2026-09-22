/**
 * Shopify REST client with:
 *   - auth via CLIENT CREDENTIALS grant (Dev Dashboard app) with auto-refresh,
 *     falling back to a static SHOPIFY_ACCESS_TOKEN when client creds absent
 *   - rate limit: max 2 requests/second via queue + delay
 *   - retry with exponential backoff on 429 / 5xx (up to 3 attempts)
 *
 * Token model:
 *   Apps criados no Dev Dashboard novo da Shopify não expõem um Admin API token
 *   fixo. Em vez disso, geramos um token via "client credentials grant"
 *   (POST /admin/oauth/access_token com client_id + client_secret). Esse token
 *   expira em 24h (expires_in ~86399s), então cacheamos e renovamos sozinhos
 *   antes de vencer. Se SHOPIFY_CLIENT_ID/SECRET não estiverem setados, caímos
 *   no SHOPIFY_ACCESS_TOKEN fixo (compatibilidade com o app legado).
 */

require("dotenv").config();
const axios = require("axios");
const logger = require("../logger");

const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
const BASE_URL = `https://${SHOP_DOMAIN}/admin/api/${
  process.env.SHOPIFY_API_VERSION || "2024-01"
}`;

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const STATIC_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const USE_CLIENT_CREDENTIALS = Boolean(CLIENT_ID && CLIENT_SECRET);

// ── Token manager (client credentials grant) ───────────────────────────────────
let tokenCache = { token: null, expiresAt: 0 };
let inFlight = null; // evita duas renovações simultâneas

async function mintToken() {
  const url = `https://${SHOP_DOMAIN}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const resp = await axios.post(url, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const token = resp.data?.access_token;
  const expiresIn = Number(resp.data?.expires_in || 86399);
  if (!token) throw new Error("client_credentials: resposta sem access_token");

  // Renova 5 min antes de expirar, por segurança.
  tokenCache = {
    token,
    expiresAt: Date.now() + (expiresIn - 300) * 1000,
  };
  logger.info("Shopify: novo token via client_credentials", {
    expiresInSec: expiresIn,
  });
  return token;
}

async function getAccessToken(forceRefresh = false) {
  if (!USE_CLIENT_CREDENTIALS) return STATIC_TOKEN;

  if (!forceRefresh && tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  // coalesce: se já há uma renovação em andamento, aguarda ela
  if (inFlight) return inFlight;

  inFlight = mintToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

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

async function requestWithRetry(config, attempt = 1, didRefreshAuth = false) {
  await throttle();

  const token = await getAccessToken();
  const headers = {
    "X-Shopify-Access-Token": token,
    "Content-Type": "application/json",
    ...config.headers,
  };

  try {
    const response = await axios({ ...config, headers });
    return response;
  } catch (err) {
    const status = err.response?.status;

    // Token pode ter expirado no meio do caminho: renova uma vez e re-tenta.
    if (status === 401 && USE_CLIENT_CREDENTIALS && !didRefreshAuth) {
      logger.warn("Shopify 401 — renovando token e re-tentando", { url: config.url });
      await getAccessToken(true);
      return requestWithRetry(config, attempt, true);
    }

    const retryable = status === 429 || (status >= 500 && status < 600);
    if (retryable && attempt < MAX_RETRIES) {
      const backoffMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      logger.warn(
        `Shopify ${status} — retrying in ${backoffMs}ms (attempt ${attempt}/${MAX_RETRIES})`,
        { url: config.url, status }
      );
      await sleep(backoffMs);
      return requestWithRetry(config, attempt + 1, didRefreshAuth);
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

  delete(path) {
    return requestWithRetry({ method: "DELETE", url: `${BASE_URL}${path}` });
  },
};

module.exports = shopify;
