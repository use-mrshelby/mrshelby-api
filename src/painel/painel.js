/* Painel de entregas — script do navegador.
   Arquivo servido cru: sem build, sem dependência. */

(function () {
  "use strict";

  var COR_SITUACAO = {
    "Endereço não localizado": "#e5484d",
    "Tentativa de entrega sem sucesso": "#f5a524",
    "Aguardando retirada, prazo acabando": "#e5484d",
    "Aguardando retirada na agência": "#3e63dd",
    "Voltando para a loja": "#8e4ec6",
    "Objeto extraviado ou avariado": "#e5484d",
    "Entrega com falha": "#e5484d",
    "Parado na transportadora": "#f5a524",
    "Código não reconhecido pela transportadora": "#6b7280",
  };

  var estado = { dados: null, arrastando: null, pausado: false, filtro: null };

  var GUARDA = "painel-filtro";

  /* O filtro escolhido fica no aparelho de quem usa. Se não der para gravar
     (janela anônima, armazenamento bloqueado), o painel segue funcionando
     com o padrão — por isso tudo aqui está dentro de try. */
  function filtroGravado() {
    try {
      var bruto = localStorage.getItem(GUARDA);
      return bruto ? JSON.parse(bruto) : null;
    } catch (e) { return null; }
  }

  function gravarFiltro(lista) {
    try { localStorage.setItem(GUARDA, JSON.stringify(lista)); } catch (e) {}
  }

  /* Padrão: só o que a loja consegue mudar. Tentativa de entrega e retenção
     seguem sozinhas — ficam desligadas até alguém querer olhar. */
  function filtroAtual() {
    if (estado.filtro) return estado.filtro;
    var gravado = filtroGravado();
    estado.filtro = gravado || estado.dados.situacoes
      .filter(function (s) { return s.acionavel; })
      .map(function (s) { return s.chave; });
    return estado.filtro;
  }

  function itensVisiveis() {
    var ligadas = filtroAtual();
    return estado.dados.itens.filter(function (i) { return ligadas.indexOf(i.chave) >= 0; });
  }

  function esc(t) {
    return String(t == null ? "" : t)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function dataHora(iso) {
    try {
      return new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      });
    } catch (e) { return iso; }
  }

  function haQuantoTempo(dias) {
    if (dias === 0) return "hoje";
    if (dias === 1) return "ontem";
    return "há " + dias + " dias";
  }

  function corDoCard(item) {
    return COR_SITUACAO[item.motivo] || "#6b7280";
  }

  /* ── Card ──────────────────────────────────────────────────────────── */

  function dataCurta(iso) {
    if (!iso) return "";
    var p = String(iso).substring(0, 10).split("-");
    return p[2] + "/" + p[1];
  }

  function blocoPrazo(item) {
    if (!item.prazo) return "";
    var dias = item.prazo.dias;
    var texto;

    if (item.prazo.tipo === "retirada") {
      texto = dias === 0
        ? "Prazo de retirada encerrado — volta a qualquer momento"
        : dias === 1
          ? "Último dia para retirar: " + dataCurta(item.prazo.data)
          : "Retirar até " + dataCurta(item.prazo.data) + " · faltam " + dias + " dias";
    } else {
      texto = dias === 0
        ? "Prazo esgotado — volta a qualquer momento"
        : dias === 1
          ? "Volta amanhã se o cliente não responder"
          : "Volta em " + dias + " dias se o cliente não responder";
    }

    return '<div class="prazo' + (dias <= 2 ? " critico" : "") + '">⏳ ' + esc(texto) + "</div>";
  }

  function blocoHistorico(item) {
    var linhas = [];

    (item.contatos || []).forEach(function (c) {
      linhas.push(esc(c.rotulo) + " — " + dataHora(c.quando) + " (" + haQuantoTempo(c.dias) + ")");
    });
    (item.tratativa || []).forEach(function (t) {
      var nome = (estado.dados.etapas.filter(function (e) { return e.id === t.etapa; })[0] || {}).titulo || t.etapa;
      linhas.push("Equipe: " + esc(nome) + " — " + dataHora(t.quando));
    });

    if (!linhas.length && !item.mensagem_whatsapp) return "";

    var corpo = linhas.length
      ? linhas.map(function (l) { return '<div class="linha">' + l + "</div>"; }).join("")
      : '<div class="linha">Nenhuma comunicação registrada ainda.</div>';

    if (item.mensagem_whatsapp) {
      corpo += "<pre>" + esc(item.mensagem_whatsapp) + "</pre>";
    }

    return '<details class="historico"><summary>Histórico e mensagem pronta</summary>' + corpo + "</details>";
  }

  function blocoMover(item) {
    var opcoes = estado.dados.etapas.map(function (e) {
      return '<option value="' + e.id + '"' + (e.id === item.etapa ? " selected" : "") + ">" + esc(e.titulo) + "</option>";
    }).join("");
    return '<select class="mover" data-codigo="' + esc(item.codigo) + '" title="Mover de coluna">' + opcoes + "</select>";
  }

  function card(item) {
    var cor = corDoCard(item);
    var acoes = "";

    // Copiar em vez de abrir: quem atende já tem o WhatsApp aberto numa aba,
    // e abrir wa.me a cada pedido enche o navegador de abas.
    if (item.telefone_zap) {
      acoes += '<button class="copiar principal" data-copia="' + esc(item.telefone_zap) + '"'
        + ' data-feito="Número copiado">Copiar número</button>';
    }
    if (item.mensagem_whatsapp) {
      acoes += '<button class="copiar principal" data-copia="' + esc(item.mensagem_whatsapp) + '"'
        + ' data-feito="Mensagem copiada">Copiar mensagem</button>';
    }
    if (item.whatsapp_url) {
      acoes += '<a href="' + esc(item.whatsapp_url) + '" target="_blank" rel="noopener"'
        + ' title="Abre uma aba nova com a conversa">Abrir</a>';
    }
    if (item.email) acoes += '<a href="mailto:' + esc(item.email) + '">E-mail</a>';
    acoes += '<a href="' + esc(item.rastreio_url) + '" target="_blank" rel="noopener">Rastreio</a>';
    if (item.admin_url) acoes += '<a href="' + esc(item.admin_url) + '" target="_blank" rel="noopener">Pedido</a>';
    acoes += '<button class="adiar" data-codigo="' + esc(item.codigo) + '" title="Some da fila até amanhã">⏰ Depois</button>';
    acoes += blocoMover(item);

    return '<article class="card" draggable="true" data-codigo="' + esc(item.codigo) + '" style="--borda:' + cor + '">'
      + '<div class="card-topo"><span class="pedido">' + esc(item.pedido || item.codigo) + "</span>"
      + (item.cliente ? '<span class="cliente">' + esc(item.cliente) + "</span>" : "")
      + "</div>"
      + '<span class="tag">' + esc(item.motivo) + "</span>"
      + '<div class="meta">' + esc(item.transportadora) + " · " + esc(item.codigo)
      + (item.cidade ? " · " + esc(item.cidade) : "")
      + (item.dias_parado !== null && item.dias_parado !== undefined ? " · parado " + haQuantoTempo(item.dias_parado) : "")
      + "</div>"
      + (item.texto_transportadora ? '<div class="transportadora-txt">' + esc(item.texto_transportadora) + "</div>" : "")
      + blocoPrazo(item)
      + blocoHistorico(item)
      + '<div class="acoes">' + acoes + "</div>"
      + "</article>";
  }

  /* ── Quadro ────────────────────────────────────────────────────────── */

  function desenharFiltro() {
    var d = estado.dados;
    var ligadas = filtroAtual();
    var contagem = {};
    d.itens.forEach(function (i) { contagem[i.chave] = (contagem[i.chave] || 0) + 1; });

    // Só mostra situação que existe na fila agora — chip de contagem zero é ruído.
    var chips = d.situacoes.filter(function (s) { return contagem[s.chave]; }).map(function (s) {
      var ligada = ligadas.indexOf(s.chave) >= 0;
      return '<button class="chip' + (ligada ? " ligada" : "") + '" data-chave="' + s.chave + '"'
        + ' style="--cor:' + s.cor + '">'
        + esc(s.titulo) + '<span class="chip-n">' + contagem[s.chave] + "</span></button>";
    }).join("");

    var todasLigadas = d.situacoes.every(function (s) {
      return !contagem[s.chave] || ligadas.indexOf(s.chave) >= 0;
    });

    document.getElementById("filtro").innerHTML = chips
      + '<button class="chip alterna" id="alterna">'
      + (todasLigadas ? "Só o que depende de nós" : "Ver tudo") + "</button>";

    document.querySelectorAll("#filtro .chip[data-chave]").forEach(function (b) {
      b.addEventListener("click", function () { alternarChave(b.dataset.chave); });
    });
    document.getElementById("alterna").addEventListener("click", function () {
      aplicarFiltro(todasLigadas
        ? d.situacoes.filter(function (s) { return s.acionavel; }).map(function (s) { return s.chave; })
        : d.situacoes.map(function (s) { return s.chave; }));
    });
  }

  function aplicarFiltro(lista) {
    estado.filtro = lista;
    gravarFiltro(lista);
    desenhar();
  }

  function alternarChave(chave) {
    var atual = filtroAtual().slice();
    var i = atual.indexOf(chave);
    if (i >= 0) atual.splice(i, 1); else atual.push(chave);
    aplicarFiltro(atual);
  }

  function desenhar() {
    var d = estado.dados;
    desenharFiltro();

    var visiveis = itensVisiveis();
    var porEtapa = {};
    d.etapas.forEach(function (e) { porEtapa[e.id] = []; });
    visiveis.forEach(function (i) { (porEtapa[i.etapa] || porEtapa[d.etapas[0].id]).push(i); });

    document.getElementById("quadro").innerHTML = d.etapas.map(function (e) {
      var itens = porEtapa[e.id];
      return '<section class="coluna" data-etapa="' + e.id + '">'
        + '<div class="coluna-topo">'
        + '<div class="coluna-titulo"><span class="coluna-ponto" style="background:' + e.cor + '"></span>'
        + esc(e.titulo) + '<span class="coluna-contagem">' + itens.length + "</span></div>"
        + '<div class="coluna-ajuda">' + esc(e.ajuda) + "</div>"
        + "</div>"
        + '<div class="coluna-corpo">'
        + (itens.length ? itens.map(card).join("") : '<div class="coluna-vazia">Nada aqui</div>')
        + "</div></section>";
    }).join("");

    var urgentes = porEtapa[d.etapas[0].id].length;
    var escondidos = d.itens.length - visiveis.length;
    document.getElementById("resumo").textContent =
      visiveis.length + " casos abertos"
      + (escondidos ? " · " + escondidos + " fora do filtro" : "")
      + " · " + d.total_acompanhados + " envios acompanhados";
    document.getElementById("urgente").textContent = urgentes + " a tratar";
    document.getElementById("urgente").style.display = urgentes ? "" : "none";
    document.getElementById("atualizado").textContent =
      "Atualizado às " + new Date(d.atualizado_em).toLocaleTimeString("pt-BR");

    ligarArrasto();
  }

  /* ── Arrastar e soltar ─────────────────────────────────────────────── */

  function ligarArrasto() {
    document.querySelectorAll(".card").forEach(function (el) {
      el.addEventListener("dragstart", function (ev) {
        estado.arrastando = el.dataset.codigo;
        estado.pausado = true;
        el.classList.add("arrastando");
        ev.dataTransfer.effectAllowed = "move";
        try { ev.dataTransfer.setData("text/plain", el.dataset.codigo); } catch (e) {}
      });
      el.addEventListener("dragend", function () {
        el.classList.remove("arrastando");
        estado.arrastando = null;
        estado.pausado = false;
      });
    });

    document.querySelectorAll(".coluna").forEach(function (col) {
      col.addEventListener("dragover", function (ev) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        col.classList.add("alvo");
      });
      col.addEventListener("dragleave", function () { col.classList.remove("alvo"); });
      col.addEventListener("drop", function (ev) {
        ev.preventDefault();
        col.classList.remove("alvo");
        if (estado.arrastando) mover(estado.arrastando, col.dataset.etapa);
      });
    });

    document.querySelectorAll("select.mover").forEach(function (sel) {
      sel.addEventListener("change", function () { mover(sel.dataset.codigo, sel.value); });
    });

    document.querySelectorAll("button.adiar").forEach(function (b) {
      b.addEventListener("click", function () { adiar(b.dataset.codigo); });
    });

    document.querySelectorAll("button.copiar").forEach(function (b) {
      b.addEventListener("click", function () { copiar(b); });
    });
  }

  /* ── Copiar ────────────────────────────────────────────────────────── */

  /* navigator.clipboard só existe em conexão segura e pode ser recusado pelo
     navegador; o textarea escondido cobre esses casos. */
  function paraAreaDeTransferencia(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto);
    }
    return new Promise(function (ok, falhou) {
      var campo = document.createElement("textarea");
      campo.value = texto;
      campo.setAttribute("readonly", "");
      campo.style.position = "fixed";
      campo.style.opacity = "0";
      document.body.appendChild(campo);
      campo.select();
      var deu = false;
      try { deu = document.execCommand("copy"); } catch (e) { deu = false; }
      document.body.removeChild(campo);
      deu ? ok() : falhou(new Error("o navegador não deixou copiar"));
    });
  }

  function copiar(botao) {
    var original = botao.textContent;
    paraAreaDeTransferencia(botao.dataset.copia).then(function () {
      botao.textContent = "✓ " + botao.dataset.feito;
      botao.classList.add("copiado");
      setTimeout(function () {
        botao.textContent = original;
        botao.classList.remove("copiado");
      }, 1800);
    }).catch(function () {
      // Sem área de transferência, mostra o texto para copiar na mão.
      window.prompt("Copie com Ctrl+C:", botao.dataset.copia);
    });
  }

  /* ── Ações ─────────────────────────────────────────────────────────── */

  function aplicarLocal(codigo, mudanca) {
    estado.dados.itens = estado.dados.itens
      .map(function (i) { return i.codigo === codigo ? Object.assign({}, i, mudanca) : i; })
      .filter(function (i) { return !(mudanca.remover && i.codigo === codigo); });
    desenhar();
  }

  function enviar(corpo) {
    return fetch("acao", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }).then(function (r) {
      if (!r.ok) throw new Error("resposta " + r.status);
      return r.json();
    });
  }

  function mover(codigo, etapa) {
    aplicarLocal(codigo, { etapa: etapa });
    enviar({ codigo: codigo, etapa: etapa }).catch(function (e) {
      alert("Não consegui salvar a mudança (" + e.message + "). Atualizando o painel.");
      carregar();
    });
  }

  function adiar(codigo) {
    var amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    amanha.setHours(8, 0, 0, 0);
    aplicarLocal(codigo, { remover: true });
    enviar({ codigo: codigo, lembrar_ate: amanha.toISOString() }).catch(function (e) {
      alert("Não consegui adiar (" + e.message + "). Atualizando o painel.");
      carregar();
    });
  }

  /* ── Carga ─────────────────────────────────────────────────────────── */

  function carregar() {
    if (estado.pausado) return;
    return fetch("dados" + location.search, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("resposta " + r.status);
        return r.json();
      })
      .then(function (d) {
        estado.dados = d;
        desenhar();
      })
      .catch(function (e) {
        document.getElementById("quadro").innerHTML =
          '<div class="aviso-topo">Não consegui carregar os dados (' + esc(e.message) + ").</div>";
      });
  }

  carregar();
  setInterval(carregar, 60000);
})();
