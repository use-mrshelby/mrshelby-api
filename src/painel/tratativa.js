/**
 * A tratativa é o trabalho da equipe sobre um caso — separada da situação, que
 * é o que a transportadora diz. A transportadora decide se o endereço foi
 * localizado; a equipe decide se já falou com o cliente.
 *
 * Por isso as colunas do painel são etapas de tratativa e não situações: dá
 * para arrastar um card de "A tratar" para "Falei com o cliente", mas não faz
 * sentido arrastar de "Endereço não localizado" para "Aguardando retirada" —
 * isso quem decide são os Correios.
 */

const { getTracking, patchTracking } = require("../db");
const logger = require("../logger");

const ETAPAS = [
  { id: "a_tratar", titulo: "A tratar", cor: "#e5484d", ajuda: "Ninguém da equipe encostou ainda" },
  { id: "contatado", titulo: "Falei com o cliente", cor: "#f5a524", ajuda: "Mensagem enviada, esperando ele responder" },
  { id: "aguardando", titulo: "Cliente respondeu", cor: "#3e63dd", ajuda: "Temos a informação, falta executar" },
  { id: "resolvido", titulo: "Resolvido", cor: "#30a46c", ajuda: "Some da fila no dia seguinte" },
];

const IDS = ETAPAS.map((e) => e.id);
const ETAPA_INICIAL = "a_tratar";

// Caso resolvido continua visível por um dia, para a equipe ver o que fechou.
const HORAS_MOSTRANDO_RESOLVIDO = 24;

/**
 * Etapa atual do caso. Se a transportadora mexeu no objeto depois da última
 * ação da equipe, o caso volta para "A tratar": é situação nova, o que foi
 * feito antes já não vale.
 */
function etapaDe(registro) {
  const t = registro && registro.tratativa;
  if (!t || !IDS.includes(t.etapa)) return ETAPA_INICIAL;
  if (t.status_quando !== undefined && t.status_quando !== (registro.raw_status ?? null)) {
    return ETAPA_INICIAL;
  }
  return t.etapa;
}

/** true quando o caso foi adiado e a data ainda não chegou. */
function adiado(registro) {
  const t = registro && registro.tratativa;
  if (!t || !t.lembrar_ate) return false;
  if (etapaDe(registro) === ETAPA_INICIAL && t.etapa !== ETAPA_INICIAL) return false;
  return new Date(t.lembrar_ate) > new Date();
}

/** true quando o caso já foi resolvido e passou tempo suficiente para sumir. */
function resolvidoEEscondido(registro) {
  if (etapaDe(registro) !== "resolvido") return false;
  const desde = registro.tratativa && registro.tratativa.desde;
  if (!desde) return false;
  return Date.now() - new Date(desde).getTime() > HORAS_MOSTRANDO_RESOLVIDO * 3600000;
}

function historicoDe(registro) {
  const t = registro && registro.tratativa;
  if (!t || !Array.isArray(t.historico)) return [];
  return t.historico;
}

/**
 * Registra uma ação da equipe. `etapa` move o caso de coluna; `lembrarAte`
 * adia o caso sem mudar de coluna; `nota` fica no histórico.
 */
function registrarAcao(codigo, { etapa, nota, lembrarAte, quem } = {}) {
  const registro = getTracking(codigo);
  if (!registro) return { ok: false, motivo: "codigo_desconhecido" };
  if (etapa && !IDS.includes(etapa)) return { ok: false, motivo: "etapa_invalida" };

  const anterior = registro.tratativa || {};
  const etapaAtual = etapaDe(registro);
  const novaEtapa = etapa || etapaAtual;
  const agora = new Date().toISOString();

  const historico = (Array.isArray(anterior.historico) ? anterior.historico : []).concat([
    { etapa: novaEtapa, nota: nota || null, quando: agora, quem: quem || null },
  ]);

  const tratativa = {
    etapa: novaEtapa,
    // Muda de coluna reinicia o relógio da coluna; adiar não.
    desde: novaEtapa !== etapaAtual ? agora : anterior.desde || agora,
    // Guarda o texto da transportadora no momento da ação: se ele mudar, o
    // caso volta para "A tratar" sozinho.
    status_quando: registro.raw_status ?? null,
    lembrar_ate: lembrarAte === null ? null : lembrarAte || anterior.lembrar_ate || null,
    historico: historico.slice(-20),
  };

  patchTracking(codigo, { tratativa });
  logger.info("Tratativa registrada no painel", { codigo, etapa: novaEtapa, adiadoAte: tratativa.lembrar_ate });
  return { ok: true, tratativa };
}

module.exports = {
  ETAPAS,
  ETAPA_INICIAL,
  etapaDe,
  adiado,
  resolvidoEEscondido,
  historicoDe,
  registrarAcao,
};
