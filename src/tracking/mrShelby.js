/**
 * Mr. Shelby tracking API integration.
 *
 * getActiveTrackings() returns all active trackings with their current status.
 * Return shape: [{ tracking_number: string, status: string }]
 *
 * TODO: replace the mock below with the real Mr. Shelby API call once
 * the endpoint and auth scheme are confirmed with the team.
 */

require("dotenv").config();
const axios = require("axios");
const logger = require("../logger");

const API_URL = process.env.MR_SHELBY_API_URL;
const API_KEY = process.env.MR_SHELBY_API_KEY;

async function getActiveTrackings() {
  // ── Real implementation (plug in here) ───────────────────────────────────
  // TODO: uncomment and adjust when the Mr. Shelby endpoint is available.
  //
  // const response = await axios.get(`${API_URL}/trackings/active`, {
  //   headers: { Authorization: `Bearer ${API_KEY}` },
  // });
  // return response.data; // expected: [{ tracking_number, status }]
  // ─────────────────────────────────────────────────────────────────────────

  // ── Mock (remove after plugging real API) ─────────────────────────────────
  logger.warn("mrShelby: using mock data — real API not connected yet");
  return [
    { tracking_number: "AA123456789BR", status: "Em trânsito" },
    { tracking_number: "BB987654321BR", status: "Saiu para entrega" },
    { tracking_number: "CC112233445BR", status: "Entregue" },
  ];
  // ─────────────────────────────────────────────────────────────────────────
}

module.exports = { getActiveTrackings };
