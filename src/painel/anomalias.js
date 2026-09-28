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

const CACHE_MS = 5 * 60 * 1000;
const cachePedidos = new Map(); // orderId -> { dados, buscadoEm }

const DIAS_PARADO_ALERTA = 7;
// Código sem retorno da transportadora só interessa enquanto o envio é recente.
const DIAS_SEM_INFO_NO_PAINEL = 30;

// Grupos do painel, em ordem de urgência.
const GRUPOS = {
  urgente: { titulo: "Ação urgente", cor: "#c0392b" },
  acompanhar: { titulo: "Acompanhar", cor: "#b8860b" },
  devolucao: { titulo: "Devoluções", cor: "#7d5fff" },
  sem_info: { titulo: "Sem informação", cor: "#777" },
};

function diasDesde(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
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
    return { grupo: "sem_info", motivo: "Código não reconhecido pela transportadora" };
  }

  if (status === "failure") {
    if (/remetente|devolucao|devolução|devolvido|prazo de retirada encerrado|recusado/.test(texto)) {
      return { grupo: "devolucao", motivo: "Voltando para a loja" };
    }
    // Registro antigo, sem o texto da transportadora: se o cliente já recebeu
    // o aviso de devolução, é devolução — não uma falha nova.
    if (!texto && registro.avisos_enviados && registro.avisos_enviados.devolucao) {
      return { grupo: "devolucao", motivo: "Voltando para a loja" };
    }
    if (/numero nao localizado/.test(texto)) {
      return { grupo: "urgente", motivo: "Transportadora perdeu o registro do objeto" };
    }
    if (/contate seu fornecedor/.test(texto)) {
      return { grupo: "urgente", motivo: "A transportadora pede contato da loja" };
    }
    if (/extraviado|sinistro|avariado/.test(texto)) {
      return { grupo: "urgente", motivo: "Objeto extraviado ou avariado" };
    }
    return { grupo: "urgente", motivo: "Entrega com falha" };
  }

  if (status === "attempted_delivery") {
    return { grupo: "urgente", motivo: /endereco|endereço|reitineracao/.test(texto) ? "Endereço não localizado" : "Tentativa de entrega sem sucesso" };
  }

  if (status === "ready_for_pickup") {
    const limite = registro.avisos_enviados && registro.avisos_enviados.prazo_final;
    return {
      grupo: limite ? "urgente" : "acompanhar",
      motivo: limite ? "Aguardando retirada, prazo acabando" : "Aguardando retirada na agência",
    };
  }

  // Em trânsito parado há muito tempo costuma ser objeto perdido no caminho.
  if (diasSemToque !== null && diasSemToque >= DIAS_PARADO_ALERTA) {
    return { grupo: "acompanhar", motivo: `Sem novidade há ${diasSemToque} dias` };
  }

  if (/fiscal|retencao|retenção|atraso|imprevisto|travado/.test(texto)) {
    return { grupo: "acompanhar", motivo: "Parado na transportadora" };
  }

  return null;
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

    itens.push({
      codigo: p.codigo,
      grupo: p.grupo,
      motivo: p.motivo,
      status: p.registro.last_status,
      texto_transportadora: p.registro.raw_status,
      dias_parado: diasDesde(p.registro.status_desde) ?? diasDesde(p.registro.updated_at),
      transportadora: /^[A-Z]{2}\d{9}[A-Z]{2}$/i.test(p.codigo) ? "Correios" : "Jadlog",
      rastreio_url: `https://www.mrshelby.com.br/pages/rastreio?tracking=${encodeURIComponent(p.codigo)}`,
      ...dados,
    });
  }

  const ordem = ["urgente", "acompanhar", "devolucao", "sem_info"];
  itens.sort((a, b) => {
    const g = ordem.indexOf(a.grupo) - ordem.indexOf(b.grupo);
    return g !== 0 ? g : (b.dias_parado ?? 0) - (a.dias_parado ?? 0);
  });

  return {
    atualizado_em: new Date().toISOString(),
    total_acompanhados: Object.keys(registros).length,
    grupos: GRUPOS,
    itens,
  };
}

module.exports = { listarAnomalias, classificar, GRUPOS };
