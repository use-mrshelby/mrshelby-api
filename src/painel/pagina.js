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

module.exports = { paginaHtml, arquivo };
