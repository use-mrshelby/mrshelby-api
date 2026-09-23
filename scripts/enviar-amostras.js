/**
 * Envia uma amostra de cada aviso ao cliente, com dados fictícios.
 *
 * Duas formas de usar:
 *   node scripts/enviar-amostras.js email@exemplo.com
 *   variável AMOSTRAS_PARA=email@exemplo.com no serviço (envia no startup)
 *
 * Não toca em nenhum pedido real nem no banco: serve só para conferir texto
 * e layout.
 */

require("dotenv").config();
const templates = require("../src/email/templates");
const { enviarEmail } = require("../src/email/resend");

const emDias = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

const agencia = {
  unidade: {
    endereco: {
      logradouro: "RUA PASCHOAL GIANFRANCESCO",
      numero: "165",
      bairro: "JARDIM DAS PALMEIRAS",
      cidade: "VARZEA PAULISTA",
      uf: "SP",
      cep: "13224971",
    },
  },
};

function amostras() {
  const base = { nome: "MARIA Souza", pedido: "MS15127", codigo: "IU135854648BR" };
  return [
    ["retirada", templates.aguardandoRetirada({ ...base, evento: { ...agencia, dtLimiteRetirada: emDias(7) } })],
    ["prazo_final", templates.prazoAcabando({ ...base, evento: { ...agencia, dtLimiteRetirada: emDias(2) }, diasRestantes: 2 })],
    ["tentativa", templates.tentativaEntrega({ ...base, evento: { detalhe: "Por favor, aguarde. Será realizada nova tentativa de entrega" } })],
    ["devolucao", templates.emDevolucao(base)],
  ];
}

async function enviarAmostras(destino) {
  const resultados = {};
  for (const [tipo, { assunto, html }] of amostras()) {
    try {
      const r = await enviarEmail({ para: destino, assunto: `[AMOSTRA] ${assunto}`, html, contexto: { tipo, amostra: true } });
      resultados[tipo] = r.enviado ? "enviado" : `falhou: ${r.motivo}`;
    } catch (err) {
      resultados[tipo] = `erro: ${err.message}`;
    }
  }
  return resultados;
}

module.exports = { enviarAmostras };

if (require.main === module) {
  const destino = process.argv[2] || process.env.AMOSTRAS_PARA || process.env.EMAIL_TEST_TO;
  if (!destino) {
    console.error("Informe o destino: node scripts/enviar-amostras.js email@exemplo.com");
    process.exit(1);
  }
  enviarAmostras(destino).then((r) => console.log(r));
}
