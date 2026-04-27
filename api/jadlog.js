export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ erro: 'Código não informado' });

  const token = process.env.JADLOG_TOKEN;

  async function consultar(campo) {
    const response = await fetch(
      'https://prd-traffic.jadlogtech.com.br/embarcador/api/tracking/consultar',
      {
        method: 'POST',
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ consulta: [{ [campo]: codigo }] })
      }
    );
    return response.json();
  }

  try {
    let data = await consultar('codigo');
    let resultado = data?.consulta?.[0];

    if (!resultado?.tracking) {
      data = await consultar('shipmentId');
      resultado = data?.consulta?.[0];
    }

    if (!resultado?.tracking) {
      return res.status(404).json({ erro: 'Pedido não encontrado. Verifique o código e tente novamente.' });
    }

    return res.status(200).json(resultado);

  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao consultar a transportadora.' });
  }
}
