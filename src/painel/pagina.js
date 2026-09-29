/**
 * Casca HTML do painel. O estilo e o script são arquivos próprios servidos
 * pelo servidor do painel — assim dá para escrevê-los como CSS e JS de
 * verdade, em vez de texto espremido dentro de uma string.
 */

const fs = require("fs");
const path = require("path");

// Lidos uma vez e guardados: o conteúdo só muda quando o serviço sobe de novo.
const cache = {};

function arquivo(nome) {
  if (!cache[nome]) cache[nome] = fs.readFileSync(path.join(__dirname, nome), "utf8");
  return cache[nome];
}

function paginaHtml() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entregas · Mr. Shelby</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="painel.css">
</head>
<body>
<header>
  <div>
    <h1>Entregas que precisam de atenção</h1>
    <div class="sub" id="resumo">Carregando…</div>
  </div>
  <div class="cabecalho-dir">
    <span class="resumo-urgente" id="urgente" style="display:none"></span>
    <span class="sub" id="atualizado"></span>
  </div>
</header>
<nav class="filtro" id="filtro"></nav>
<main class="quadro" id="quadro"></main>
<script src="painel.js"></script>
</body>
</html>`;
}

/**
 * Tela de entrada. Fica de pé sozinha — sem painel.css nem painel.js, que
 * estão atrás da senha. É só um formulário, então cabe tudo aqui.
 */
function loginHtml({ erro } = {}) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entregas · Mr. Shelby</title>
<link rel="icon" href="data:,">
<style>
  :root { color-scheme: light dark; --bg:#f4f5f7; --surface:#fff; --txt:#14161a; --muted:#6b7280; --line:#e4e7ec; --erro:#e5484d; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1115; --surface:#181b21; --txt:#edeef0; --muted:#9ba1a6; --line:#272b31; }
  }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:var(--bg); color:var(--txt); padding:24px;
         font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
         -webkit-font-smoothing:antialiased; }
  .cartao { background:var(--surface); border:1px solid var(--line); border-radius:16px;
            padding:32px 30px; width:100%; max-width:380px;
            box-shadow:0 1px 3px rgba(16,24,40,.1); }
  h1 { font-size:19px; font-weight:650; letter-spacing:-.01em; margin:0 0 6px; }
  p.sub { color:var(--muted); font-size:13.5px; margin:0 0 22px; }
  label { display:block; font-size:13px; font-weight:600; margin-bottom:7px; }
  input { width:100%; font:inherit; padding:11px 13px; border-radius:10px;
          border:1px solid var(--line); background:var(--bg); color:var(--txt); }
  input:focus { outline:2px solid var(--txt); outline-offset:-1px; }
  button { width:100%; margin-top:16px; font:inherit; font-weight:640; cursor:pointer;
           padding:11px 13px; border-radius:10px; border:none; background:var(--txt);
           color:var(--surface); }
  button:hover { opacity:.9; }
  .erro { margin:16px 0 0; padding:10px 12px; border-radius:9px; font-size:13.5px;
          color:var(--erro); background:color-mix(in srgb, var(--erro) 12%, transparent); }
</style>
</head>
<body>
<form class="cartao" method="POST" action="entrar">
  <h1>Entregas · Mr.&nbsp;Shelby</h1>
  <p class="sub">Painel das entregas que precisam de atenção.</p>
  <label for="senha">Senha</label>
  <input id="senha" name="senha" type="password" autocomplete="current-password" autofocus required>
  <button type="submit">Entrar</button>
  ${erro ? `<p class="erro">${erro}</p>` : ""}
</form>
</body>
</html>`;
}

module.exports = { paginaHtml, loginHtml, arquivo };
