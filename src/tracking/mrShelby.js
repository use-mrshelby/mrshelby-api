/**
 * Mr. Shelby tracking integration.
 *
 * Busca os tracking numbers dos pedidos enviados na Shopify,
 * consulta os status reais nas APIs de Correios e Jadlog (Vercel)
 * e retorna: [{ tracking_number: string, status: string }]
 */

require("dotenv").config();
const axios = require("axios");
const shopify = require("../shopify/client");
const { getTracking, patchTracking, listarTrackings } = require("../db");
const logger = require("../logger");

const API_BASE = (process.env.MR_SHELBY_API_URL || "https://mrshelby-api.vercel.app").replace(/\/$/, "");

// Correios: AA123456789BR | Melhor Envio: começa com ME | Jadlog: o resto
const CORREIOS_REGEX = /^[A-Z]{2}\d{9}[A-Z]{2}$/i;
const MELHOR_ENVIO_REGEX = /^ME[0-9A-Z]{6,}$/i;

function getCarrier(trackingNumber) {
  const codigo = trackingNumber.trim();
  if (CORREIOS_REGEX.test(codigo)) return "correios";
  if (MELHOR_ENVIO_REGEX.test(codigo)) return "melhorenvio";
  return "jadlog";
}

// ── Correios ──────────────────────────────────────────────────────────────────
async function getCorreiosStatus(trackingNumber) {
  const response = await axios.post(
    `${API_BASE}/api/correios`,
    { codigo: trackingNumber },
    { timeout: 15000 }
  );
  const eventos = response.data?.eventos;
  if (!eventos?.length) return null;
  // O evento mais recente vai junto: os avisos ao cliente usam o endereço da
  // agência, o prazo de retirada e o detalhe escrito pelos Correios.
  return { status: eventos[0].descricao ?? null, evento: eventos[0] };
}

// ── Melhor Envio ──────────────────────────────────────────────────────────────
// Mesma resposta dos Correios (lista de eventos), em outra rota.
async function getMelhorEnvioStatus(trackingNumber) {
  const response = await axios.post(
    `${API_BASE}/api/melhorenvio`,
    { codigo: trackingNumber },
    { timeout: 15000 }
  );
  const eventos = response.data?.eventos;
  if (!eventos?.length) return null;
  return { status: eventos[0].descricao ?? null, evento: eventos[0] };
}

// ── Jadlog ────────────────────────────────────────────────────────────────────
async function getJadlogStatus(trackingNumber) {
  const response = await axios.post(
    `${API_BASE}/api/jadlog`,
    { codigo: trackingNumber },
    { timeout: 15000 }
  );
  const tracking = response.data?.tracking;
  if (!tracking) return null;
  const status = tracking.status ?? tracking.situacao ?? tracking.descricao ?? null;
  // Os eventos vêm do mais antigo para o mais novo: o que vale é o último.
  const eventos = tracking.eventos || [];
  return status ? { status, evento: eventos[eventos.length - 1] || null } : null;
}

// ── Busca tracking numbers dos pedidos enviados na Shopify ────────────────────
// Janela da consulta à Shopify. Atenção: o filtro é por pedido ATUALIZADO,
// não criado — e o ciclo só atualiza o pedido quando o status muda. Envio
// parado por semanas envelhece e cai da janela, por isso ela não pode ser a
// única fonte (ver trackingsDoBanco).
const DIAS_JANELA_SHOPIFY = 45;

// Até quando um envio do nosso banco continua sendo consultado. Passado isso,
// é código de envio abandonado e não vale mais gastar consulta.
const DIAS_ACOMPANHANDO_DO_BANCO = 60;

/**
 * Tudo que o nosso banco ainda tem como não entregue.
 *
 * Existe porque a consulta da Shopify sozinha esquece envio parado: ela filtra
 * por pedido atualizado, e quando o status não muda o ciclo não escreve nada na
 * Shopify. A data envelhece, o envio sai da janela e nunca mais volta — o
 * pacote é entregue e o sistema não fica sabendo. Foi o que aconteceu com 142
 * envios da Jadlog em outubro de 2026.
 */
function trackingsDoBanco() {
  const limite = Date.now() - DIAS_ACOMPANHANDO_DO_BANCO * 86400000;
  return Object.entries(listarTrackings())
    .filter(([, registro]) => {
      if (registro.last_status === "delivered") return false;
      // Código trocado no envio da Shopify (pedido refeito): não é mais acompanhado.
      if (registro.substituido_em) return false;
      const visto = registro.updated_at || registro.status_desde;
      return visto ? new Date(visto).getTime() >= limite : false;
    })
    .map(([codigo]) => codigo);
}

async function getActiveTrackingsFromShopify() {
  const trackings = new Set();
  let pageInfo = null;

  do {
    // Quando page_info está presente não pode misturar outros filtros (regra Shopify)
    const since = new Date(Date.now() - DIAS_JANELA_SHOPIFY * 86400000).toISOString();
    const params = pageInfo
      ? { page_info: pageInfo, limit: 50 }
      : { status: "any", fulfillment_status: "shipped", updated_at_min: since, limit: 50 };

    const response = await shopify.get("/orders.json", params);
    const orders = response.data.orders ?? [];
    const linkHeader = response.headers["link"] ?? "";

    for (const order of orders) {
      for (const fulfillment of order.fulfillments ?? []) {
        // Remessa já entregue não muda mais: não precisa consultar a
        // transportadora nem a Shopify a cada ciclo.
        if (fulfillment.shipment_status === "delivered") continue;
        if (fulfillment.tracking_number) {
          trackings.add(fulfillment.tracking_number.trim());
        }
      }
    }

    const nextMatch = linkHeader.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    pageInfo = nextMatch ? nextMatch[1] : null;
  } while (pageInfo);

  return [...trackings];
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function getActiveTrackings() {
  let trackingNumbers;

  try {
    const daShopify = await getActiveTrackingsFromShopify();
    const doBanco = trackingsDoBanco();
    trackingNumbers = [...new Set([...daShopify, ...doBanco])];
    logger.info("mrShelby: fila do ciclo montada", {
      daShopify: daShopify.length,
      doBanco: doBanco.length,
      total: trackingNumbers.length,
    });
  } catch (err) {
    logger.error("mrShelby: falha ao buscar trackings da Shopify", { error: err.message });
    return [];
  }

  const results = [];
  let ignorados = 0;

  for (const trackingNumber of trackingNumbers) {
    const carrier = getCarrier(trackingNumber);

    // Código que a transportadora não reconhece (envios antigos, códigos de
    // conta encerrada): depois de algumas tentativas, sai da fila por um tempo.
    const registro = getTracking(trackingNumber);
    if (registro?.ignorar_ate && new Date(registro.ignorar_ate) > new Date()) {
      ignorados++;
      continue;
    }

    try {
      const consulta = {
        correios: getCorreiosStatus,
        melhorenvio: getMelhorEnvioStatus,
        jadlog: getJadlogStatus,
      }[carrier];
      const resultado = await consulta(trackingNumber);

      const rawStatus = resultado && resultado.status;
      if (rawStatus) {
        results.push({ tracking_number: trackingNumber, status: rawStatus, evento: resultado.evento });
        logger.info("mrShelby: status obtido", { trackingNumber, carrier, rawStatus });
        if (registro?.consultas_sem_retorno) {
          patchTracking(trackingNumber, { consultas_sem_retorno: 0, ignorar_ate: null });
        }
      } else {
        registrarConsultaSemRetorno(trackingNumber, carrier, registro, "resposta sem status");
      }
    } catch (err) {
      const httpStatus = err.response?.status;
      if (httpStatus === 404) {
        registrarConsultaSemRetorno(trackingNumber, carrier, registro, "código não encontrado (404)");
      } else {
        logger.warn("mrShelby: falha ao consultar transportadora", {
          trackingNumber,
          carrier,
          error: err.message,
          httpStatus,
        });
      }
    }
  }

  if (ignorados) {
    logger.info(`mrShelby: ${ignorados} tracking(s) fora da fila (código não reconhecido)`);
  }

  return results;
}

// Código que não responde sai da fila por um tempo, para não gastar dezenas de
// consultas inúteis por rodada. A pausa CRESCE a cada rodada de falhas em vez
// de ir direto para o teto.
//
// Antes eram 3 falhas e 30 dias fora. Como o ciclo roda de 15 em 15 minutos,
// isso dava 45 minutos: etiqueta recém-criada ainda não tem evento nenhum nos
// Correios, então todo envio novo era descartado na primeira hora de vida e só
// voltava a ser consultado um mês depois — entregue, sem ninguém saber.
const TENTATIVAS_ANTES_DE_PAUSAR = 3;
const HORAS_DE_PAUSA = [6, 24, 72, 168];

function registrarConsultaSemRetorno(trackingNumber, carrier, registro, motivo) {
  const falhas = (registro?.consultas_sem_retorno ?? 0) + 1;
  const campos = { consultas_sem_retorno: falhas };

  if (falhas % TENTATIVAS_ANTES_DE_PAUSAR === 0) {
    const nivel = Math.min(falhas / TENTATIVAS_ANTES_DE_PAUSAR - 1, HORAS_DE_PAUSA.length - 1);
    const horas = HORAS_DE_PAUSA[nivel];
    campos.ignorar_ate = new Date(Date.now() + horas * 3600000).toISOString();
    logger.warn("mrShelby: código sem retorno — pausando a consulta", {
      trackingNumber,
      carrier,
      motivo,
      falhas,
      horasDePausa: horas,
    });
  } else {
    logger.warn("mrShelby: falha ao consultar transportadora", { trackingNumber, carrier, motivo, falhas });
  }

  patchTracking(trackingNumber, campos);
}

/**
 * Devolve à fila o que a regra antiga tinha mandado embora por 30 dias.
 * Idempotente: só encurta pausa maior que o teto novo, então rodar de novo
 * num próximo deploy não faz nada.
 */
function devolverPausasLongas() {
  const teto = Date.now() + HORAS_DE_PAUSA[HORAS_DE_PAUSA.length - 1] * 3600000;
  let devolvidos = 0;

  for (const [codigo, registro] of Object.entries(listarTrackings())) {
    if (!registro.ignorar_ate) continue;
    if (new Date(registro.ignorar_ate).getTime() <= teto) continue;
    patchTracking(codigo, { ignorar_ate: null, consultas_sem_retorno: 0 });
    devolvidos++;
  }

  if (devolvidos) logger.info("mrShelby: códigos devolvidos à fila", { devolvidos });
  return devolvidos;
}

module.exports = { getActiveTrackings, devolverPausasLongas };
