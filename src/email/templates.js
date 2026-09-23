/**
 * Textos e layout dos avisos de entrega enviados ao cliente.
 *
 * Todo dado que vem da transportadora passa por esc() antes de entrar no HTML.
 */

const LINK_RASTREIO = "https://www.mrshelby.com.br/pages/rastreio";
const LINK_CONTATO = "https://www.mrshelby.com.br/pages/contato";

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dataBr(iso) {
  if (!iso) return "";
  const [a, m, d] = String(iso).substring(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function primeiroNome(nome) {
  const n = String(nome || "").trim().split(/\s+/)[0] || "";
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : "tudo bem";
}

function endereco(unidade) {
  const e = (unidade && unidade.endereco) || {};
  const l1 = [e.logradouro, e.numero, e.complemento].filter(Boolean).join(", ");
  const l2 = [e.bairro, e.cidade && e.uf ? `${e.cidade}/${e.uf}` : e.cidade, e.cep ? `CEP ${e.cep}` : ""]
    .filter(Boolean)
    .join(" - ");
  return [l1, l2].filter(Boolean);
}

function layout({ titulo, corpo, codigo, botao }) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f4f4f4;font-family:Helvetica,Arial,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:28px 28px 8px;text-align:center;">
      <span style="font-size:22px;font-weight:800;letter-spacing:-0.02em;text-transform:uppercase;">MR. SHELBY</span>
    </td></tr>
    <tr><td style="padding:8px 28px 0;">
      <h1 style="font-size:19px;line-height:1.3;margin:12px 0 16px;">${titulo}</h1>
      ${corpo}
    </td></tr>
    <tr><td style="padding:8px 28px 28px;">
      <a href="${botao.url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:13px 22px;border-radius:50px;font-weight:600;font-size:15px;">${botao.texto}</a>
      <p style="font-size:12px;color:#999;margin:18px 0 0;">Código de rastreio: ${esc(codigo)}</p>
    </td></tr>
  </table>
  <p style="text-align:center;font-size:12px;color:#999;margin:16px 0 0;">Mr. Shelby · Dúvidas? É só responder este e-mail.</p>
  </body></html>`;
}

// ── 1. Aguardando retirada na agência ────────────────────────────────────────
function aguardandoRetirada({ nome, pedido, codigo, evento }) {
  const linhas = endereco(evento && evento.unidade);
  const prazo = evento && evento.dtLimiteRetirada ? dataBr(evento.dtLimiteRetirada) : "";
  const corpo = `
    <p style="font-size:15px;line-height:1.6;">Olá, ${esc(primeiroNome(nome))}! Seu pedido <strong>${esc(pedido)}</strong> chegou na agência dos Correios e está aguardando você retirar.</p>
    ${prazo ? `<p style="font-size:15px;line-height:1.6;background:#fff8e1;border:1px solid #f5d77a;border-radius:8px;padding:12px 14px;"><strong>Retire até ${esc(prazo)}.</strong> Depois dessa data, o pedido volta para a Mr. Shelby.</p>` : ""}
    ${linhas.length ? `<p style="font-size:15px;line-height:1.6;">📍 ${linhas.map(esc).join("<br>")}</p>` : ""}
    <p style="font-size:14px;line-height:1.6;color:#555;">Leve o código de rastreio e um documento com foto do destinatário ou de alguém autorizado por ele.</p>`;
  return {
    assunto: "Seu pedido está te esperando na agência dos Correios 📦",
    html: layout({ titulo: "Seu pedido chegou na agência", corpo, codigo, botao: { url: `${LINK_RASTREIO}?tracking=${encodeURIComponent(codigo)}`, texto: "Acompanhar meu pedido" } }),
  };
}

// ── 2. Prazo de retirada acabando ────────────────────────────────────────────
function prazoAcabando({ nome, pedido, codigo, evento, diasRestantes }) {
  const linhas = endereco(evento && evento.unidade);
  const prazo = evento && evento.dtLimiteRetirada ? dataBr(evento.dtLimiteRetirada) : "";
  const quando = diasRestantes <= 1 ? "amanhã" : `em ${diasRestantes} dias`;
  const corpo = `
    <p style="font-size:15px;line-height:1.6;">Olá, ${esc(primeiroNome(nome))}! Seu pedido <strong>${esc(pedido)}</strong> continua na agência dos Correios, e o prazo para retirada termina <strong>${esc(quando)}</strong>${prazo ? `, em ${esc(prazo)}` : ""}.</p>
    <p style="font-size:15px;line-height:1.6;">Se não for retirado, ele volta para a Mr. Shelby e a entrega atrasa bastante.</p>
    ${linhas.length ? `<p style="font-size:15px;line-height:1.6;">📍 ${linhas.map(esc).join("<br>")}</p>` : ""}`;
  return {
    assunto: `Faltam poucos dias para retirar seu pedido ⏰`,
    html: layout({ titulo: "O prazo de retirada está acabando", corpo, codigo, botao: { url: `${LINK_RASTREIO}?tracking=${encodeURIComponent(codigo)}`, texto: "Ver detalhes da retirada" } }),
  };
}

// ── 3. Tentativa de entrega sem sucesso ──────────────────────────────────────
function tentativaEntrega({ nome, pedido, codigo, evento }) {
  const detalhe = evento && evento.detalhe ? esc(evento.detalhe) : "Os Correios farão uma nova tentativa nos próximos dias úteis.";
  const corpo = `
    <p style="font-size:15px;line-height:1.6;">Olá, ${esc(primeiroNome(nome))}! O carteiro passou no seu endereço com o pedido <strong>${esc(pedido)}</strong>, mas não conseguiu entregar.</p>
    <p style="font-size:15px;line-height:1.6;">${detalhe}</p>
    <p style="font-size:14px;line-height:1.6;color:#555;">Se puder, deixe alguém no endereço para receber a encomenda.</p>`;
  return {
    assunto: "Tentamos entregar seu pedido hoje 🛵",
    html: layout({ titulo: "Não conseguimos entregar seu pedido", corpo, codigo, botao: { url: `${LINK_RASTREIO}?tracking=${encodeURIComponent(codigo)}`, texto: "Acompanhar meu pedido" } }),
  };
}

// ── 4. Pedido voltando para a loja ───────────────────────────────────────────
function emDevolucao({ nome, pedido, codigo }) {
  const corpo = `
    <p style="font-size:15px;line-height:1.6;">Olá, ${esc(primeiroNome(nome))}! O pedido <strong>${esc(pedido)}</strong> não pôde ser entregue e está voltando para a Mr. Shelby.</p>
    <p style="font-size:15px;line-height:1.6;">Assim que ele chegar aqui, entramos em contato para combinar o reenvio. Se preferir, fale com a gente agora mesmo.</p>`;
  return {
    assunto: "Seu pedido está voltando para a Mr. Shelby ↩️",
    html: layout({ titulo: "Seu pedido está voltando para a gente", corpo, codigo, botao: { url: LINK_CONTATO, texto: "Falar com a Mr. Shelby" } }),
  };
}

module.exports = { aguardandoRetirada, prazoAcabando, tentativaEntrega, emDevolucao, esc, dataBr };
