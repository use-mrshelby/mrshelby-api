/**
 * Envia uma amostra de cada aviso ao cliente, com dados fictícios.
 * Uso: node scripts/enviar-amostras.js [destino]
 *
 * Sem argumento, usa EMAIL_TEST_TO. Não toca em nenhum pedido real nem no
 * banco: serve só para conferir texto e layout.
 */

require("dotenv").config();
const templates = require("../src/email/templates");
const { enviarEmail } = require("../src/email/resend");

const destino = process.argv[2] || process.env.EMAIL_TEST_TO;

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

const amostras = [
  ["retirada", templates.aguardandoRetirada({ nome: "MARIA Souza", pedido: "MS15127", codigo: "IU135854648BR", evento: { ...agencia, dtLimiteRetirada: emDias(7) } })],
  ["prazo_final", templates.prazoAcabando({ nome: "MARIA Souza", pedido: "MS15127", codigo: "IU135854648BR", evento: { ...agencia, dtLimiteRetirada: emDias(2) }, diasRestantes: 2 })],
  ["tentativa", templates.tentativaEntrega({ nome: "MARIA Souza", pedido: "MS15127", codigo: "IU135854648BR", evento: { detalhe: "Por favor, aguarde. Será realizada nova tentativa de entrega" } })],
  ["devolucao", templates.emDevolucao({ nome: "MARIA Souza", pedido: "MS15127", codigo: "IU135854648BR" })],
];

(async () => {
  if (!destino) {
    console.error("Defina o destino: node scripts/enviar-amostras.js email@exemplo.com");
    process.exit(1);
  }
  for (const [tipo, { assunto, html }] of amostras) {
    const r = await enviarEmail({ para: destino, assunto: `[AMOSTRA] ${assunto}`, html, contexto: { tipo, amostra: true } });
    console.log(tipo, r.enviado ? "enviado" : `falhou (${r.motivo})`);
  }
})();
