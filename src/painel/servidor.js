/**
 * Servidor do painel de entregas.
 *
 * Config (env):
 *   PAINEL_SENHA  obrigatória. Sem ela o painel não sobe.
 *   PORT          porta (o Railway define sozinho).
 *
 * Acesso: https://<dominio>/?k=SENHA — a senha fica guardada num cookie, então
 * só precisa ser informada na primeira vez em cada aparelho.
 *
 * Rotas: /saude · / e /painel (página) · painel.css e painel.js (estáticos)
 *        /dados (GET, lista) · /acao (POST, registra a tratativa da equipe)
 */

const http = require("http");
const { listarAnomalias } = require("./anomalias");
const { paginaHtml, arquivo } = require("./pagina");
const { registrarAcao } = require("./tratativa");
const logger = require("../logger");

const SENHA = process.env.PAINEL_SENHA;
const COOKIE = "painel_ok";
const CORPO_MAXIMO = 8 * 1024;

const ESTATICOS = {
  "/painel.css": { nome: "painel.css", tipo: "text/css; charset=utf-8" },
  "/painel.js": { nome: "painel.js", tipo: "application/javascript; charset=utf-8" },
};

function autorizado(req, url) {
  if (!SENHA) return false;
  if (url.searchParams.get("k") === SENHA) return true;
  const cookies = req.headers.cookie || "";
  return cookies.split(";").some((c) => c.trim() === `${COOKIE}=${SENHA}`);
}

function responder(res, status, corpo, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(corpo);
}

function json(res, status, objeto, headers = {}) {
  responder(res, status, JSON.stringify(objeto), {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
}

/** Lê o corpo da requisição, com teto — o painel só manda objetos pequenos. */
function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let bruto = "";
    req.on("data", (pedaco) => {
      bruto += pedaco;
      if (bruto.length > CORPO_MAXIMO) {
        reject(new Error("corpo grande demais"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(bruto ? JSON.parse(bruto) : {});
      } catch (err) {
        reject(new Error("corpo não é JSON válido"));
      }
    });
    req.on("error", reject);
  });
}

function iniciar() {
  if (!SENHA) {
    logger.warn("Painel não iniciado: defina PAINEL_SENHA para publicá-lo");
    return null;
  }

  const porta = Number(process.env.PORT) || 3000;

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/saude") {
      return responder(res, 200, "ok", { "Content-Type": "text/plain; charset=utf-8" });
    }

    if (!autorizado(req, url)) {
      return responder(res, 401, "Acesso restrito. Abra o painel com o link completo, que inclui a senha.", {
        "Content-Type": "text/plain; charset=utf-8",
      });
    }

    // Guarda a senha no aparelho para os próximos acessos (30 dias).
    const cookie = `${COOKIE}=${SENHA}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`;

    const estatico = ESTATICOS[url.pathname];
    if (estatico) {
      try {
        return responder(res, 200, arquivo(estatico.nome), { "Content-Type": estatico.tipo });
      } catch (err) {
        logger.error("Painel: não consegui ler o estático", { arquivo: estatico.nome, error: err.message });
        return responder(res, 500, "", { "Content-Type": estatico.tipo });
      }
    }

    if (url.pathname === "/dados") {
      try {
        const dados = await listarAnomalias();
        return json(res, 200, dados, { "Set-Cookie": cookie });
      } catch (err) {
        logger.error("Painel: falha ao montar a lista", { error: err.message });
        return json(res, 500, { erro: err.message });
      }
    }

    if (url.pathname === "/acao") {
      if (req.method !== "POST") return json(res, 405, { erro: "use POST" });
      try {
        const corpo = await lerCorpo(req);
        const { codigo, etapa, nota, lembrar_ate: lembrarAte } = corpo;
        if (!codigo) return json(res, 400, { erro: "informe o codigo" });

        const r = registrarAcao(codigo, { etapa, nota, lembrarAte });
        if (!r.ok) return json(res, 400, { erro: r.motivo });
        return json(res, 200, { ok: true, tratativa: r.tratativa });
      } catch (err) {
        logger.warn("Painel: ação recusada", { error: err.message });
        return json(res, 400, { erro: err.message });
      }
    }

    if (url.pathname === "/" || url.pathname === "/painel") {
      return responder(res, 200, paginaHtml(), {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": cookie,
      });
    }

    return responder(res, 404, "Não encontrado", { "Content-Type": "text/plain; charset=utf-8" });
  });

  servidor.listen(porta, () => logger.info(`Painel de entregas no ar na porta ${porta}`));
  return servidor;
}

module.exports = { iniciar };
