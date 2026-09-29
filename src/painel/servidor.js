/**
 * Servidor do painel de entregas.
 *
 * Config (env):
 *   PAINEL_SENHA  obrigatória. Sem ela o painel não sobe.
 *   PORT          porta (o Railway define sozinho).
 *
 * Acesso: abra o domínio e digite a PAINEL_SENHA na tela de entrada. É a mesma
 * senha para todo mundo; cada aparelho informa uma vez e fica logado. O antigo
 * https://<dominio>/?k=SENHA continua valendo.
 *
 * Rotas: /saude · / e /painel (página) · painel.css e painel.js (estáticos)
 *        /dados (GET, lista) · /acao (POST, registra a tratativa da equipe)
 */

const http = require("http");
const crypto = require("crypto");
const { listarAnomalias } = require("./anomalias");
const { paginaHtml, loginHtml, arquivo } = require("./pagina");
const { registrarAcao } = require("./tratativa");
const logger = require("../logger");

const SENHA = process.env.PAINEL_SENHA;
const COOKIE = "painel_ok";
const CORPO_MAXIMO = 8 * 1024;

// Tentativas erradas antes de segurar o aparelho, e por quanto tempo.
const TENTATIVAS_ANTES_DE_SEGURAR = 5;
const SEGUNDOS_SEGURANDO = 60;

// Quanto tempo o aparelho fica logado. Não dá para ser "para sempre": o
// Chrome e o Edge cortam qualquer cookie em 400 dias, então esse é o teto
// real. Para tirar o acesso de alguém antes disso, troque a PAINEL_SENHA —
// isso derruba a sessão de todo mundo de uma vez.
const DIAS_LOGADO = 400;

/**
 * O cookie guarda um resumo da senha, não a senha. Antes ela ia inteira no
 * cookie e no endereço — quem abrisse o histórico do navegador ou as
 * ferramentas de desenvolvedor lia ela em texto puro.
 */
function fichaDaSenha(senha) {
  return crypto.createHash("sha256").update(`painel-mr-shelby:${senha}`).digest("hex");
}

const FICHA = SENHA ? fichaDaSenha(SENHA) : null;

function senhaConfere(tentativa) {
  if (!FICHA || typeof tentativa !== "string") return false;
  // Comparação de tempo constante: resumos têm sempre o mesmo tamanho.
  return crypto.timingSafeEqual(Buffer.from(fichaDaSenha(tentativa), "hex"), Buffer.from(FICHA, "hex"));
}

// Quem errou demais espera um pouco. Memória só, some quando o serviço reinicia.
const tentativas = new Map();

function quemPede(req) {
  const encaminhado = req.headers["x-forwarded-for"];
  return (encaminhado ? String(encaminhado).split(",")[0] : req.socket.remoteAddress || "?").trim();
}

function segurando(ip) {
  const r = tentativas.get(ip);
  if (!r || !r.ate) return 0;
  const faltam = Math.ceil((r.ate - Date.now()) / 1000);
  return faltam > 0 ? faltam : 0;
}

function registrarErro(ip) {
  const r = tentativas.get(ip) || { erros: 0, ate: 0 };
  r.erros += 1;
  if (r.erros >= TENTATIVAS_ANTES_DE_SEGURAR) {
    r.ate = Date.now() + SEGUNDOS_SEGURANDO * 1000;
    r.erros = 0;
  }
  tentativas.set(ip, r);
}

const ESTATICOS = {
  "/painel.css": { nome: "painel.css", tipo: "text/css; charset=utf-8" },
  "/painel.js": { nome: "painel.js", tipo: "application/javascript; charset=utf-8" },
};

function autorizado(req, url) {
  if (!SENHA) return false;
  // ?k=SENHA continua valendo: os links antigos e os atalhos de quem já usa
  // não podem parar de funcionar de uma hora para outra.
  if (senhaConfere(url.searchParams.get("k"))) return true;
  const cookies = req.headers.cookie || "";
  return cookies.split(";").some((c) => c.trim() === `${COOKIE}=${FICHA}`);
}

/** O cookie só vai com Secure quando a conexão é HTTPS — no Railway, sempre. */
function cookieDeSessao(req) {
  const https = String(req.headers["x-forwarded-proto"] || "").includes("https");
  const segundos = DIAS_LOGADO * 24 * 3600;
  return `${COOKIE}=${FICHA}; Path=/; Max-Age=${segundos}; HttpOnly; SameSite=Lax${https ? "; Secure" : ""}`;
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

/** Lê o corpo da requisição, com teto — o painel só manda coisas pequenas. */
function lerTexto(req) {
  return new Promise((resolve, reject) => {
    let bruto = "";
    req.on("data", (pedaco) => {
      bruto += pedaco;
      if (bruto.length > CORPO_MAXIMO) {
        reject(new Error("corpo grande demais"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(bruto));
    req.on("error", reject);
  });
}

async function lerCorpo(req) {
  const bruto = await lerTexto(req);
  if (!bruto) return {};
  try {
    return JSON.parse(bruto);
  } catch (err) {
    throw new Error("corpo não é JSON válido");
  }
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

    // Recebe o formulário da tela de entrada.
    if (url.pathname === "/entrar") {
      if (req.method !== "POST") return responder(res, 303, "", { Location: "/" });

      const ip = quemPede(req);
      const faltam = segurando(ip);
      if (faltam) {
        return responder(res, 429, loginHtml({ erro: `Muitas tentativas. Tente de novo em ${faltam} segundos.` }), {
          "Content-Type": "text/html; charset=utf-8",
        });
      }

      let enviada = "";
      try {
        const bruto = await lerTexto(req);
        enviada = new URLSearchParams(bruto).get("senha") || "";
      } catch (err) {
        enviada = "";
      }

      if (!senhaConfere(enviada)) {
        registrarErro(ip);
        logger.warn("Painel: senha errada na tela de entrada", { ip });
        return responder(res, 401, loginHtml({ erro: "Senha incorreta." }), {
          "Content-Type": "text/html; charset=utf-8",
        });
      }

      tentativas.delete(ip);
      return responder(res, 303, "", { Location: "/", "Set-Cookie": cookieDeSessao(req) });
    }

    if (!autorizado(req, url)) {
      // Página pede a senha em vez de devolver um texto seco: assim dá para
      // abrir o painel em qualquer aparelho sem carregar a senha na URL.
      const pedePagina = String(req.headers.accept || "").includes("text/html");
      if (pedePagina) {
        return responder(res, 401, loginHtml(), { "Content-Type": "text/html; charset=utf-8" });
      }
      return responder(res, 401, "Acesso restrito.", { "Content-Type": "text/plain; charset=utf-8" });
    }

    // Guarda a sessão no aparelho para os próximos acessos.
    const cookie = cookieDeSessao(req);

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
