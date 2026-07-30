/**
 * Acesso ao Bling via o servidor MCP existente (servidor-mrshelby-bling).
 *
 * Em vez de duplicar as credenciais/refresh do Bling aqui, este cliente chama
 * o endpoint MCP do servidor (`POST /mcp/<MCP_SECRET>`) e usa a ferramenta
 * `bling_request`, que é um proxy pra qualquer endpoint da API v3 do Bling.
 *
 * O servidor responde JSON puro no formato JSON-RPC:
 *   { jsonrpc, id, result: { content: [{ type:"text", text:"<json string>" }] } }
 * e o `bling_request` devolve { ok, http_status, resposta: <corpo do Bling> }.
 */

require("dotenv").config();
const axios = require("axios");
const logger = require("../logger");

const BASE = (
  process.env.BLING_SERVER_URL ||
  "https://servidor-mrshelby-bling-production.up.railway.app"
).replace(/\/$/, "");

const SECRET = process.env.BLING_MCP_SECRET || "";
const MCP_URL = SECRET ? `${BASE}/mcp/${SECRET}` : `${BASE}/mcp`;

let _id = 0;

async function callTool(name, args = {}) {
  const body = {
    jsonrpc: "2.0",
    id: ++_id,
    method: "tools/call",
    params: { name, arguments: args },
  };

  const resp = await axios.post(MCP_URL, body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    timeout: 60000,
  });

  if (resp.data?.error) {
    throw new Error(`Bling MCP error: ${resp.data.error.message}`);
  }
  const text = resp.data?.result?.content?.[0]?.text;
  if (!text) throw new Error("Bling MCP: resposta vazia");
  return JSON.parse(text);
}

/**
 * GET arbitrário na API v3 do Bling.
 * Retorna o corpo da resposta do Bling (normalmente { data: ... }).
 */
async function blingGet(path, query) {
  const res = await callTool("bling_request", {
    path,
    ...(query ? { query } : {}),
  });
  if (res && res.ok === false) {
    logger.warn("bling_request retornou erro", { path, status: res.http_status });
  }
  return res?.resposta ?? res;
}

module.exports = { callTool, blingGet };
