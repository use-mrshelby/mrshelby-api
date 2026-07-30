// api/melhorenvio.js
// Rastreio Melhor Envio (códigos "ME...") para a página de rastreio da loja,
// + fluxo de conexão OAuth (troca do "code" por token) sem precisar de PowerShell.
//
// Roda no Vercel (projeto mrshelby-api), igual /api/correios e /api/jadlog.
//
// Variáveis no Vercel (Settings -> Environment Variables):
//   MELHOR_ENVIO_CLIENT_ID       (ex.: 27723)
//   MELHOR_ENVIO_CLIENT_SECRET   (sua chave secreta do app)
//   MELHOR_ENVIO_ACCESS_TOKEN    (preenchido depois de conectar)
//   MELHOR_ENVIO_REFRESH_TOKEN   (preenchido depois de conectar)
// Opcionais:
//   MELHOR_ENVIO_BASE            (default https://melhorenvio.com.br)
//   MELHOR_ENVIO_REDIRECT_URI    (default https://www.mrshelby.com.br/pages/rastreio)
//   MELHOR_ENVIO_UA              (User-Agent com contato — exigido pela API)
//
// Como conectar (uma vez): depois de subir este arquivo e cadastrar CLIENT_ID/SECRET,
//   1. Aprove o app:  https://melhorenvio.com.br/oauth/authorize?client_id=SEU_ID&redirect_uri=https://www.mrshelby.com.br/pages/rastreio&response_type=code&scope=shipping-tracking%20orders-read
//   2. Copie o "code" da URL de retorno e abra:
//        https://mrshelby-api.vercel.app/api/melhorenvio?action=auth&code=O_CODE
//   3. A página mostra ACCESS_TOKEN e REFRESH_TOKEN -> cole nas variáveis do Vercel -> Redeploy.

const BASE = (process.env.MELHOR_ENVIO_BASE || "https://melhorenvio.com.br").replace(/\/$/, "");
const REDIRECT_URI = process.env.MELHOR_ENVIO_REDIRECT_URI || "https://www.mrshelby.com.br/pages/rastreio";
const UA = process.env.MELHOR_ENVIO_UA || "Mr. Shelby Rastreio (diego.mrshelby@gmail.com)";

function meHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": UA,
  };
}

// ── OAuth: troca do code e refresh ──────────────────────────────────────────────
async function exchangeCode(code) {
  const r = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: process.env.MELHOR_ENVIO_CLIENT_ID,
      client_secret: process.env.MELHOR_ENVIO_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
    }),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, data };
}

async function refreshAccessToken(refresh) {
  if (!refresh) return { ok: false, data: {} };
  const r = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: process.env.MELHOR_ENVIO_CLIENT_ID,
      client_secret: process.env.MELHOR_ENVIO_CLIENT_SECRET,
      refresh_token: refresh,
    }),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, data };
}

// ── Rastreio ────────────────────────────────────────────────────────────────────
async function trackByOrders(token, ids) {
  const r = await fetch(`${BASE}/api/v2/me/shipment/tracking`, {
    method: "POST",
    headers: meHeaders(token),
    body: JSON.stringify({ orders: ids }),
  });
  const data = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
}

// Procura o pedido cujo código bate com o "ME..." (varre pedidos recentes).
async function findOrderByCode(token, codigo) {
  for (let page = 1; page <= 6; page++) {
    const r = await fetch(`${BASE}/api/v2/me/orders?page=${page}`, { headers: meHeaders(token) });
    if (!r.ok) break;
    const body = await r.json().catch(() => null);
    const arr = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    if (!arr.length) break;
    const alvo = String(codigo).toUpperCase();
    const hit = arr.find((o) =>
      [o.tracking, o.self_tracking, o.melhorenvio_tracking, o.protocol, o.id]
        .filter(Boolean)
        .map((v) => String(v).toUpperCase())
        .includes(alvo)
    );
    if (hit) return hit;
  }
  return null;
}

// A resposta de tracking vem como objeto keyed por id/código. Pega a entrada certa.
function pickEntry(data, key) {
  if (!data || typeof data !== "object") return null;
  if (key && data[key] && typeof data[key] === "object") return data[key];
  const vals = Object.values(data).filter((v) => v && typeof v === "object");
  return vals.length ? vals[0] : null;
}

// Normaliza para o MESMO formato que a página já sabe desenhar (estilo Correios):
//   { eventos: [{ codigo, descricao, dtHrCriado, unidade:{endereco:{cidade,uf}} }], dtPrevista }
function normalize(entry, order, codigo) {
  const out = { codigo, transportadora: "Melhor Envio", eventos: [], dtPrevista: null };
  if (!entry && !order) return out;

  const src = entry || {};

  // Previsão de entrega (tenta vários nomes de campo).
  out.dtPrevista =
    src.delivery_estimate || src.estimated_delivery || src.expected_date ||
    order?.delivery?.estimated_date || order?.expected_date || null;

  // Código da transportadora subjacente, se houver (Correios/Jadlog).
  out.codigoTransportadora = src.tracking || order?.tracking || null;

  // 1) Caso a API já traga uma lista de eventos.
  const lista =
    src.events || src.tracking_events || src.history || src.tracking_history || src.checkpoints || null;

  if (Array.isArray(lista) && lista.length) {
    out.eventos = lista
      .map((ev) => ({
        codigo: ev.code || ev.status_code || "",
        descricao: ev.description || ev.message || ev.status || ev.title || "",
        dtHrCriado: ev.date || ev.datetime || ev.created_at || ev.timestamp || ev.occurred_at || "",
        unidade: {
          endereco: {
            cidade: ev.city || ev.location_city || (ev.location && ev.location.city) || "",
            uf: ev.state || ev.uf || ev.location_state || (ev.location && ev.location.state) || "",
          },
        },
      }))
      // mais recente primeiro
      .sort((a, b) => String(b.dtHrCriado).localeCompare(String(a.dtHrCriado)));
    return out;
  }

  // 2) Sem lista de eventos: monta a linha do tempo a partir das datas-marco.
  const marcos = [
    { campo: src.delivered_at || order?.delivered_at, codigo: "BDE", desc: "Objeto entregue ao destinatário" },
    { campo: src.out_for_delivery_at, codigo: "OEC", desc: "Objeto saiu para entrega" },
    { campo: src.posted_at || order?.posted_at, codigo: "PO", desc: "Objeto postado" },
    { campo: src.generated_at || order?.generated_at, codigo: "FC", desc: "Etiqueta gerada" },
    { campo: src.paid_at || order?.paid_at, codigo: "CO", desc: "Envio pago / em preparação" },
  ];
  out.eventos = marcos
    .filter((m) => m.campo)
    .map((m) => ({
      codigo: m.codigo,
      descricao: m.desc,
      dtHrCriado: m.campo,
      unidade: { endereco: { cidade: "", uf: "" } },
    }))
    .sort((a, b) => String(b.dtHrCriado).localeCompare(String(a.dtHrCriado)));

  // Se não achou nenhuma data mas tem status textual, mostra ao menos o status atual.
  if (!out.eventos.length) {
    const status = src.status || order?.status || null;
    if (status) {
      out.eventos = [{
        codigo: "",
        descricao: typeof status === "string" ? status : (status.description || status.name || "Em processamento"),
        dtHrCriado: src.updated_at || order?.updated_at || "",
        unidade: { endereco: { cidade: "", uf: "" } },
      }];
    }
  }
  return out;
}

// ── Handler ─────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const q = req.query || {};

  // (A) Fluxo de conexão: GET ?action=auth&code=...
  if (req.method === "GET" && q.action === "auth") {
    if (!q.code) return res.status(400).send("Faltou o parâmetro ?code=");
    const { ok, data } = await exchangeCode(q.code);
    if (!ok || !data.access_token) {
      return res
        .status(400)
        .send(`<pre>Falha na troca do code:\n${JSON.stringify(data, null, 2)}</pre>`);
    }
    return res.status(200).send(
      `<html><head><meta charset="utf-8"><title>Melhor Envio conectado</title></head>` +
        `<body style="font-family:system-ui,Arial;padding:24px;max-width:720px;margin:0 auto;line-height:1.6">` +
        `<h2>✅ Conectado ao Melhor Envio</h2>` +
        `<p>Cole os dois valores abaixo nas variáveis do Vercel (projeto <b>mrshelby-api</b>) e depois clique em <b>Redeploy</b>:</p>` +
        `<p><b>MELHOR_ENVIO_ACCESS_TOKEN</b><br>` +
        `<textarea style="width:100%;height:90px" readonly onclick="this.select()">${data.access_token || ""}</textarea></p>` +
        `<p><b>MELHOR_ENVIO_REFRESH_TOKEN</b><br>` +
        `<textarea style="width:100%;height:90px" readonly onclick="this.select()">${data.refresh_token || ""}</textarea></p>` +
        `<p style="color:#666">expira em ${data.expires_in || "?"} segundos (~${Math.round((data.expires_in || 0) / 86400)} dias)</p>` +
        `</body></html>`
    );
  }

  // (B) Rastreio: POST {codigo} (usado pela página) ou GET ?codigo=... (para teste)
  const codigo = req.method === "POST" ? req.body?.codigo : q.codigo;
  const debug = q.debug === "1" || req.body?.debug === true;
  if (!codigo) return res.status(400).json({ erro: "Código não informado" });

  let token = process.env.MELHOR_ENVIO_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ erro: "Integração Melhor Envio ainda não conectada." });

  const dbg = {};
  try {
    // 1) tenta rastrear direto pelo código ME
    let tr = await trackByOrders(token, [codigo]);
    if (tr.status === 401) {
      const rt = await refreshAccessToken(process.env.MELHOR_ENVIO_REFRESH_TOKEN);
      if (rt.ok && rt.data.access_token) {
        token = rt.data.access_token;
        tr = await trackByOrders(token, [codigo]);
      }
    }
    dbg.trackByCode = tr.data;
    dbg.trackByCodeStatus = tr.status;

    let entry = pickEntry(tr.data, codigo);
    let order = null;

    // 2) se não achou, localiza o pedido pelo código e rastreia pelo id
    if (!entry || (!entry.status && !entry.tracking && !entry.events)) {
      order = await findOrderByCode(token, codigo);
      dbg.order = order;
      if (order?.id) {
        const tr2 = await trackByOrders(token, [order.id]);
        dbg.trackById = tr2.data;
        entry = pickEntry(tr2.data, order.id) || pickEntry(tr2.data, codigo) || entry;
      }
    }

    if (!entry && !order) {
      return res
        .status(404)
        .json({ erro: "Pedido não encontrado no Melhor Envio.", ...(debug ? { _debug: dbg } : {}) });
    }

    const out = normalize(entry, order, codigo);
    if (debug) out._debug = dbg;
    return res.status(200).json(out);
  } catch (err) {
    return res
      .status(500)
      .json({ erro: "Erro ao consultar o Melhor Envio.", detalhe: err.message, ...(debug ? { _debug: dbg } : {}) });
  }
}
