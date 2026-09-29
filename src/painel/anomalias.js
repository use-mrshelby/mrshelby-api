/**
 * Monta a lista de pedidos que precisam de atenção, a partir do que o ciclo
 * já guardou no banco, completando com nome do cliente e telefone da Shopify.
 *
 * Os dados da Shopify ficam em cache por alguns minutos: o painel atualiza
 * sozinho e não faz sentido consultar a loja a cada atualização de tela.
 */

const { listarTrackings } = require("../db");
const shopify = require("../shopify/client");
const logger = require("../logger");
const { ETAPAS, etapaDe, adiado, resolvidoEEscondido, historicoDe } = require("./tratativa");

const CACHE_MS = 5 * 60 * 1000;
const cachePedidos = new Map(); // orderId -> { dados, buscadoEm }

const DIAS_PARADO_ALERTA = 7;
// Código sem retorno da transportadora só interessa enquanto o envio é recente.
const DIAS_SEM_INFO_NO_PAINEL = 30;
// A Jadlog dá 10 dias corridos para a loja mandar informação complementar
// num caso de endereço; passado o prazo, devolve o objeto.
const DIAS_ATE_DEVOLVER_ENDERECO = 10;

// Situações que o painel reconhece. A chave é estável (o título muda sem
// quebrar o filtro) e "acionavel" diz se a loja consegue mudar o resultado:
// tentativa de entrega e retenção seguem sozinhas, não adianta a equipe
// olhar — por isso entram desligadas no filtro.
const SITUACOES = [
  { chave: "endereco", titulo: "Endereço não localizado", cor: "#e5484d", acionavel: true },
  { chave: "retirada_prazo", titulo: "Prazo de retirada acabando", cor: "#e5484d", acionavel: true },
  { chave: "retirada", titulo: "Aguardando retirada", cor: "#3e63dd", acionavel: true },
  { chave: "devolucao", titulo: "Voltando para a loja", cor: "#8e4ec6", acionavel: true },
  { chave: "extraviado", titulo: "Extraviado ou avariado", cor: "#e5484d", acionavel: true },
  { chave: "falha", titulo: "Entrega com falha", cor: "#e5484d", acionavel: true },
  { chave: "tentativa", titulo: "Tentativa de entrega", cor: "#f5a524", acionavel: false },
  { chave: "parado", titulo: "Parado na transportadora", cor: "#f5a524", acionavel: false },
  { chave: "sem_novidade", titulo: "Sem novidade há dias", cor: "#f5a524", acionavel: false },
  { chave: "sem_info", titulo: "Código não reconhecido", cor: "#6b7280", acionavel: false },
];

// Grupos do painel, em ordem de urgência.
const GRUPOS = {
  urgente: { titulo: "Ação urgente", cor: "#c0392b" },
  acompanhar: { titulo: "Acompanhar", cor: "#b8860b" },
  devolucao: { titulo: "Devoluções", cor: "#7d5fff" },
  sem_info: { titulo: "Sem informação", cor: "#777" },
};

// Todos os jeitos que Correios e Jadlog escrevem o mesmo problema: a entrega
// não saiu porque o endereço não foi localizado ou precisa de confirmação.
const ENDERECO = /endereco|endereço|reitineracao|numero nao localizado|contate seu fornecedor/;

/** Dias que faltam até uma data (0 = hoje ou já passou). */
function diasAte(iso) {
  if (!iso) return null;
  const limite = new Date(String(iso).substring(0, 10) + "T23:59:59");
  return Math.max(Math.ceil((limite - new Date()) / 86400000), 0);
}

function diasDesde(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

// O que já foi comunicado ao cliente, para o operador não repetir contato.
const ROTULO_AVISO = {
  retirada: "E-mail: pedido aguardando retirada",
  prazo_final: "E-mail: prazo de retirada acabando",
  tentativa: "E-mail: tentativa de entrega sem sucesso",
  endereco: "E-mail: confirmar endereço",
  devolucao: "E-mail: pedido voltando para a loja",
};

function historicoDeContato(registro) {
  const enviados = registro.avisos_enviados || {};
  return Object.entries(enviados)
    .filter(([, quando]) => quando)
    .map(([tipo, quando]) => ({
      tipo,
      rotulo: ROTULO_AVISO[tipo] || `E-mail: ${tipo}`,
      quando,
      dias: diasDesde(quando),
    }))
    .sort((a, b) => new Date(a.quando) - new Date(b.quando));
}

/**
 * Decide se o pedido entra no painel e em qual grupo.
 * Retorna null para o que está seguindo seu curso normal.
 */
function classificar(registro) {
  const status = registro.last_status;
  const texto = String(registro.raw_status || "").toLowerCase();
  const diasParado = diasDesde(registro.status_desde);
  // Registro antigo, de antes do painel: usa a data da última atualização.
  const diasSemToque = diasParado ?? diasDesde(registro.updated_at);

  if (status === "delivered") return null;

  if (registro.ignorar_ate && new Date(registro.ignorar_ate) > new Date()) {
    // Código sem retorno há muito tempo é envio velho: não ocupa o painel.
    if (diasSemToque !== null && diasSemToque > DIAS_SEM_INFO_NO_PAINEL) return null;
    return { grupo: "sem_info", chave: "sem_info", motivo: "Código não reconhecido pela transportadora" };
  }

  if (status === "failure") {
    if (/remetente|devolucao|devolução|devolvido|prazo de retirada encerrado|recusado/.test(texto)) {
      return { grupo: "devolucao", chave: "devolucao", motivo: "Voltando para a loja" };
    }
    // Registro antigo, sem o texto da transportadora: se o cliente já recebeu
    // o aviso de devolução, é devolução — não uma falha nova.
    if (!texto && registro.avisos_enviados && registro.avisos_enviados.devolucao) {
      return { grupo: "devolucao", chave: "devolucao", motivo: "Voltando para a loja" };
    }
    // "NUMERO NAO LOCALIZADO" é o motorista que não achou o número na rua,
    // não objeto perdido. Registro antigo ainda pode chegar aqui como falha.
    if (ENDERECO.test(texto)) {
      return { grupo: "urgente", chave: "endereco", motivo: "Endereço não localizado" };
    }
    if (/extraviado|sinistro|avariado/.test(texto)) {
      return { grupo: "urgente", chave: "extraviado", motivo: "Objeto extraviado ou avariado" };
    }
    return { grupo: "urgente", chave: "falha", motivo: "Entrega com falha" };
  }

  if (status === "attempted_delivery") {
    const deEndereco = ENDERECO.test(texto);
    return {
      grupo: "urgente",
      chave: deEndereco ? "endereco" : "tentativa",
      motivo: deEndereco ? "Endereço não localizado" : "Tentativa de entrega sem sucesso",
    };
  }

  if (status === "ready_for_pickup") {
    const limite = registro.avisos_enviados && registro.avisos_enviados.prazo_final;
    return {
      grupo: limite ? "urgente" : "acompanhar",
      chave: limite ? "retirada_prazo" : "retirada",
      motivo: limite ? "Aguardando retirada, prazo acabando" : "Aguardando retirada na agência",
    };
  }

  // Em trânsito parado há muito tempo costuma ser objeto perdido no caminho.
  if (diasSemToque !== null && diasSemToque >= DIAS_PARADO_ALERTA) {
    return { grupo: "acompanhar", chave: "sem_novidade", motivo: `Sem novidade há ${diasSemToque} dias` };
  }

  if (/fiscal|retencao|retenção|atraso|imprevisto|travado/.test(texto)) {
    return { grupo: "acompanhar", chave: "parado", motivo: "Parado na transportadora" };
  }

  return null;
}

/** O aviso de prazo só entra quando sabemos quantos dias restam. */
function prazoEmTexto(dias) {
  if (dias === null || dias === undefined) return "";
  if (dias === 0) return " O prazo para passar o endereço certo acabou, e o pedido pode voltar para a loja a qualquer momento.";
  if (dias === 1) return " Temos só até amanhã para passar o endereço certo, senão o pedido volta para a loja.";
  return ` Temos ${dias} dias para passar o endereço certo, senão o pedido volta para a loja.`;
}

/**
 * Mensagem pronta de WhatsApp, com os dados do cliente, do pedido e do
 * rastreio já escritos, mais o texto do problema. O operador clica, confere
 * e envia — sem precisar redigir nem procurar informação.
 */
function mensagemWhatsapp({ grupo, motivo, cliente, pedido, codigo, transportadora, cidade, rastreio_url, dias_ate_devolver }) {
  const primeiro = String(cliente || "").trim().split(/\s+/)[0] || "";
  const nome = primeiro ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase() : "";
  const ola = nome ? `Olá, ${nome}!` : "Olá!";

  const ficha = [
    pedido ? `Pedido: ${pedido}` : null,
    `Rastreio: ${codigo}${transportadora ? ` (${transportadora})` : ""}`,
    cidade ? `Entrega: ${cidade}` : null,
    rastreio_url ? `Acompanhe aqui: ${rastreio_url}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const corpos = {
    "Aguardando retirada na agência":
      "Seu pedido chegou na agência dos Correios e está aguardando a sua retirada. O endereço da agência e o prazo estão no link do rastreio. Leve um documento com foto.",
    "Aguardando retirada, prazo acabando":
      "Seu pedido está na agência dos Correios e o prazo de retirada está acabando. Se não for retirado a tempo, ele volta para a Mr. Shelby. Endereço, prazo e documentos no link do rastreio.",
    "Endereço não localizado":
      "A transportadora não conseguiu localizar o seu endereço para a entrega." +
      prazoEmTexto(dias_ate_devolver) +
      " Pode confirmar por aqui o endereço completo, com número, complemento, CEP e um ponto de referência? Assim reenviamos a entrega.",
    "Tentativa de entrega sem sucesso":
      "A transportadora passou no seu endereço e não encontrou ninguém para receber. Qual o melhor dia e horário para a nova tentativa? Precisa ter alguém no local em horário comercial.",
    "Voltando para a loja":
      "A entrega não foi concluída e o seu pedido está voltando para a Mr. Shelby. Assim que ele chegar aqui podemos reenviar para o mesmo endereço, para outro endereço, ou fazer o estorno — o que você preferir?",

    "Objeto extraviado ou avariado":
      "Tivemos um problema com o seu pedido durante o transporte. Podemos reenviar o mesmo item ou fazer o estorno — o que você preferir?",
    "Parado na transportadora":
      "Seu pedido está parado na transportadora e já pedimos a liberação. Assim que ele voltar a andar, te avisamos.",
    "Entrega com falha":
      "A entrega do seu pedido não foi concluída e já estamos verificando com a transportadora o que aconteceu. Te damos retorno em breve.",
    "Código não reconhecido pela transportadora":
      "O código de rastreio do seu pedido ainda não está aparecendo no sistema da transportadora e já estamos verificando isso com ela. Te damos retorno em breve.",
  };

  const corpo =
    corpos[motivo] ||
    (grupo === "devolucao"
      ? corpos["Voltando para a loja"]
      : "Estamos acompanhando a entrega do seu pedido, que está parada, e já acionamos a transportadora. Te damos retorno em breve.");

  return `${ola} Aqui é da Mr. Shelby.\n\n${ficha}\n\n${corpo}`;
}

/** Link do WhatsApp com a mensagem já escrita, no formato usado nos e-mails. */
function linkWhatsapp(telefone, mensagem) {
  const digitos = String(telefone || "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  const numero = digitos.length <= 11 ? `55${digitos}` : digitos;
  return `https://api.whatsapp.com/send/?phone=${numero}&text=${encodeURIComponent(mensagem)}&type=phone_number&app_absent=0`;
}

async function dadosDoPedido(orderId) {
  if (!orderId) return {};
  const cache = cachePedidos.get(orderId);
  if (cache && Date.now() - cache.buscadoEm < CACHE_MS) return cache.dados;

  try {
    const { data } = await shopify.get(`/orders/${orderId}.json`, {
      fields: "id,name,email,customer,shipping_address,created_at",
    });
    const o = data.order || {};
    const end = o.shipping_address || {};
    const dados = {
      pedido: o.name || null,
      cliente: (o.customer && [o.customer.first_name, o.customer.last_name].filter(Boolean).join(" ")) || end.name || null,
      email: o.email || null,
      telefone: end.phone || (o.customer && o.customer.phone) || null,
      cidade: [end.city, end.province_code || end.province].filter(Boolean).join("/") || null,
      criado_em: o.created_at || null,
      admin_url: `https://admin.shopify.com/store/mr-shelby-convicto/orders/${orderId}`,
    };
    cachePedidos.set(orderId, { dados, buscadoEm: Date.now() });
    return dados;
  } catch (err) {
    logger.warn("Painel: não consegui buscar o pedido na Shopify", { orderId, error: err.message });
    return {};
  }
}

async function listarAnomalias() {
  const registros = listarTrackings();
  const pendentes = [];

  for (const [codigo, registro] of Object.entries(registros)) {
    // Adiado pela equipe, ou resolvido há mais de um dia: fora da fila.
    if (adiado(registro) || resolvidoEEscondido(registro)) continue;
    const classificacao = classificar(registro);
    if (classificacao) pendentes.push({ codigo, registro, ...classificacao });
  }

  const itens = [];
  for (const p of pendentes) {
    const dados = await dadosDoPedido(p.registro.shopify_order_id);

    // Código sem informação só interessa enquanto o PEDIDO é recente. Sem
    // pedido correspondente na Shopify não há o que fazer: fica de fora.
    if (p.grupo === "sem_info") {
      const diasPedido = diasDesde(dados.criado_em);
      if (diasPedido === null || diasPedido > DIAS_SEM_INFO_NO_PAINEL) continue;
    }

    const item = {
      codigo: p.codigo,
      grupo: p.grupo,
      chave: p.chave,
      motivo: p.motivo,
      status: p.registro.last_status,
      texto_transportadora: p.registro.raw_status,
      contatos: historicoDeContato(p.registro),
      // trabalho da equipe: em que coluna o caso está e o que já foi feito
      etapa: etapaDe(p.registro),
      tratativa: historicoDe(p.registro).slice(-5),
      lembrar_ate: (p.registro.tratativa && p.registro.tratativa.lembrar_ate) || null,
      // Conta pela data que a transportadora registrou. status_desde é quando
      // o nosso ciclo viu a mudança: se corrigimos um mapeamento, ele
      // reinicia e o prazo passa a mentir para mais.
      dias_parado:
        diasDesde(p.registro.evento_em) ??
        diasDesde(p.registro.status_desde) ??
        diasDesde(p.registro.updated_at),
      transportadora: /^[A-Z]{2}\d{9}[A-Z]{2}$/i.test(p.codigo) ? "Correios" : "Jadlog",
      rastreio_url: `https://www.mrshelby.com.br/pages/rastreio?tracking=${encodeURIComponent(p.codigo)}`,
      ...dados,
    };

    // Os dois tipos de prazo que existem, num campo só. O da agência vem dos
    // Correios; o de endereço é a regra dos 10 dias da Jadlog contada a partir
    // do dia em que o objeto parou.
    if (p.registro.prazo_retirada && String(p.registro.last_status) === "ready_for_pickup") {
      item.prazo = {
        tipo: "retirada",
        data: String(p.registro.prazo_retirada).substring(0, 10),
        dias: diasAte(p.registro.prazo_retirada),
      };
    } else if (item.motivo === "Endereço não localizado" && item.dias_parado !== null) {
      item.prazo = {
        tipo: "endereco",
        data: null,
        dias: Math.max(DIAS_ATE_DEVOLVER_ENDERECO - item.dias_parado, 0),
      };
    }
    // Mantido para a mensagem de WhatsApp, que já cita esse número.
    item.dias_ate_devolver = item.prazo && item.prazo.tipo === "endereco" ? item.prazo.dias : undefined;

    // O operador clica e o WhatsApp já abre com o texto do problema escrito.
    item.mensagem_whatsapp = mensagemWhatsapp(item);
    item.whatsapp_url = linkWhatsapp(item.telefone, item.mensagem_whatsapp);

    itens.push(item);
  }

  const ordem = ["urgente", "acompanhar", "devolucao", "sem_info"];
  itens.sort((a, b) => {
    // Quem tem prazo vem antes, do mais curto para o mais longo. Depois o
    // grupo, e por fim o que está parado há mais tempo.
    const pa = a.prazo ? a.prazo.dias : null;
    const pb = b.prazo ? b.prazo.dias : null;
    if (pa !== null && pb !== null && pa !== pb) return pa - pb;
    if (pa !== null && pb === null) return -1;
    if (pa === null && pb !== null) return 1;
    const g = ordem.indexOf(a.grupo) - ordem.indexOf(b.grupo);
    return g !== 0 ? g : (b.dias_parado ?? 0) - (a.dias_parado ?? 0);
  });

  return {
    atualizado_em: new Date().toISOString(),
    total_acompanhados: Object.keys(registros).length,
    grupos: GRUPOS,
    etapas: ETAPAS,
    situacoes: SITUACOES,
    itens,
  };
}

module.exports = { listarAnomalias, classificar, GRUPOS };
