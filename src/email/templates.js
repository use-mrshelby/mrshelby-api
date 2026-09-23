/**
 * Textos e layout dos avisos de entrega enviados ao cliente.
 *
 * Todo dado que vem da transportadora passa por esc() antes de entrar no HTML.
 */

const LINK_RASTREIO = "https://www.mrshelby.com.br/pages/rastreio";
const LINK_CONTATO = "https://api.whatsapp.com/send/?phone=5519993140166&text&type=phone_number&app_absent=0";

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

// Assunto no mesmo padrão das notificações da Shopify:
// "Mr. Shelby: Seu pedido #MS15047 está aguardando retirada"
function assuntoPadrao(pedido, situacao) {
  const numero = String(pedido || "").replace(/^#/, "");
  return `Mr. Shelby: Seu pedido ${numero ? `#${numero} ` : ""}${situacao}`;
}

function layout({ titulo, corpo, codigo, botao, pedido, saudacao }) {
  // Mesmo padrão visual das notificações da Shopify: fundo branco, largura de
  // 560px com 448px de conteúdo, fonte do sistema, cabeçalho com o nome da
  // loja em 30px, título em 24px e botão preto de cantos 4px.
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#fff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;">
   <tr><td align="center" style="padding:20px 0;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#333;">
      <tr><td style="padding:24px 56px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:30px;line-height:1.2;color:#333;">Mr. Shelby</td>
          <td align="right" style="font-size:14px;color:#999;text-transform:uppercase;">${pedido ? `Pedido #${esc(String(pedido).replace(/^#/, ""))}` : ""}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:0 56px;">
        <h1 style="font-size:24px;font-weight:400;line-height:1.35;color:#000;margin:18px 0 14px;">${saudacao ? `<strong style="font-weight:700;">Olá, ${esc(saudacao)}!</strong> ` : ""}${titulo}</h1>
        ${corpo}
      </td></tr>
      <tr><td style="padding:10px 56px 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:#000;border-radius:4px;padding:14px 24px;">
            <a href="${botao.url}" style="color:#fff;text-decoration:none;font-size:14px;font-weight:700;display:inline-block;">${botao.texto}</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:16px 56px 8px;">
        <p style="font-size:14px;color:#999;margin:0;">Número de rastreio: ${esc(codigo)}</p>
      </td></tr>
      <tr><td style="padding:8px 56px 28px;border-top:1px solid #e5e5e5;">
        <p style="font-size:14px;color:#999;line-height:1.5;margin:14px 0 0;">Se você tiver alguma dúvida, responda a esta mensagem ou entre em contato conosco pelo e-mail <a href="mailto:contato@mrshelby.com.br" style="color:#999;">contato@mrshelby.com.br</a></p>
      </td></tr>
    </table>
   </td></tr>
  </table>
  </body></html>`;
}

// ── 1. Aguardando retirada na agência ────────────────────────────────────────
function aguardandoRetirada({ nome, pedido, codigo, evento }) {
  const linhas = endereco(evento && evento.unidade);
  const prazo = evento && evento.dtLimiteRetirada ? dataBr(evento.dtLimiteRetirada) : "";
  const corpo = `
    <p style="font-size:16px;line-height:1.6;color:#333;">Ele chegou na agência dos Correios e está aguardando você retirar.</p>
    ${prazo ? `<p style="font-size:16px;line-height:1.6;color:#333;background:#fff8e1;border:1px solid #f5d77a;border-radius:8px;padding:12px 14px;"><strong>Retire até ${esc(prazo)}.</strong> Depois dessa data, o pedido volta para a Mr. Shelby.</p>` : ""}
    ${linhas.length ? `<p style="font-size:16px;line-height:1.6;color:#333;">📍 ${linhas.map(esc).join("<br>")}</p>` : ""}
    <p style="font-size:14px;line-height:1.6;color:#777;">Leve o código de rastreio e um documento com foto do destinatário ou de alguém autorizado por ele.</p>`;
  return {
    assunto: assuntoPadrao(pedido, "está aguardando retirada nos Correios"),
    html: layout({ titulo: "Seu pedido chegou na agência", saudacao: primeiroNome(nome), pedido, corpo, codigo, botao: { url: `${LINK_RASTREIO}?tracking=${encodeURIComponent(codigo)}`, texto: "Rastrear meu pedido" } }),
  };
}

// ── 2. Prazo de retirada acabando ────────────────────────────────────────────
function prazoAcabando({ nome, pedido, codigo, evento, diasRestantes }) {
  const linhas = endereco(evento && evento.unidade);
  const prazo = evento && evento.dtLimiteRetirada ? dataBr(evento.dtLimiteRetirada) : "";
  const quando = diasRestantes <= 1 ? "amanhã" : `em ${diasRestantes} dias`;
  const corpo = `
    <p style="font-size:16px;line-height:1.6;color:#333;">Ele continua na agência dos Correios, e o prazo para retirada termina <strong>${esc(quando)}</strong>${prazo ? `, em ${esc(prazo)}` : ""}.</p>
    <p style="font-size:16px;line-height:1.6;color:#333;">Se não for retirado, ele volta para a Mr. Shelby e a entrega atrasa bastante.</p>
    ${linhas.length ? `<p style="font-size:16px;line-height:1.6;color:#333;">📍 ${linhas.map(esc).join("<br>")}</p>` : ""}`;
  return {
    assunto: assuntoPadrao(pedido, prazo ? `precisa ser retirado até ${prazo}` : "precisa ser retirado nos Correios"),
    html: layout({ titulo: "O prazo de retirada está acabando", saudacao: primeiroNome(nome), pedido, corpo, codigo, botao: { url: `${LINK_RASTREIO}?tracking=${encodeURIComponent(codigo)}`, texto: "Rastrear meu pedido" } }),
  };
}

// ── 3. Tentativa de entrega sem sucesso ──────────────────────────────────────
function tentativaEntrega({ nome, pedido, codigo, evento }) {
  const detalhe = evento && evento.detalhe ? esc(evento.detalhe) : "Os Correios farão uma nova tentativa nos próximos dias úteis.";
  const corpo = `
    <p style="font-size:16px;line-height:1.6;color:#333;">O carteiro passou no seu endereço, mas não conseguiu entregar.</p>
    <p style="font-size:16px;line-height:1.6;color:#333;">${detalhe}</p>
    <p style="font-size:14px;line-height:1.6;color:#777;">Se puder, deixe alguém no endereço para receber a encomenda.</p>`;
  return {
    assunto: assuntoPadrao(pedido, "não pôde ser entregue hoje"),
    html: layout({ titulo: "Tentamos entregar seu pedido", saudacao: primeiroNome(nome), pedido, corpo, codigo, botao: { url: `${LINK_RASTREIO}?tracking=${encodeURIComponent(codigo)}`, texto: "Rastrear meu pedido" } }),
  };
}

// ── 4. Pedido voltando para a loja ───────────────────────────────────────────
function emDevolucao({ nome, pedido, codigo }) {
  const corpo = `
    <p style="font-size:16px;line-height:1.6;color:#333;">Ele não pôde ser entregue e está voltando para a Mr. Shelby.</p>
    <p style="font-size:16px;line-height:1.6;color:#333;">Assim que ele chegar aqui, entramos em contato para combinar o reenvio. Se preferir, fale com a gente agora mesmo.</p>`;
  return {
    assunto: assuntoPadrao(pedido, "está voltando para a loja"),
    html: layout({ titulo: "Seu pedido está voltando para a gente", saudacao: primeiroNome(nome), pedido, corpo, codigo, botao: { url: LINK_CONTATO, texto: "Falar com a Mr. Shelby" } }),
  };
}

module.exports = { aguardandoRetirada, prazoAcabando, tentativaEntrega, emDevolucao, esc, dataBr };
