/**
 * Servidor do painel de entregas.
 *
 * Config (env):
 *   PAINEL_SENHA  obrigatória. Sem ela o painel não sobe.
 *   PORT          porta (o Railway define sozinho).
 *
 * Acesso: https://<dominio>/?k=SENHA — a senha fica guardada num cookie, então
 * só precisa ser informada na primeira vez em cada aparelho.
 */

const http = require("http");
const { listarAnomalias } = require("./anomalias");
const { paginaHtml } = require("./pagina");
const logger = require("../logger");

const SENHA = process.env.PAINEL_SENHA;
const COOKIE = "painel_ok";

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

    if (url.pathname === "/dados") {
      try {
        const dados = await listarAnomalias();
        return responder(res, 200, JSON.stringify(dados), {
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": cookie,
        });
      } catch (err) {
        logger.error("Painel: falha ao montar a lista", { error: err.message });
        return responder(res, 500, JSON.stringify({ erro: err.message }), {
          "Content-Type": "application/json; charset=utf-8",
        });
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
