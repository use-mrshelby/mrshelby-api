export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ erro: 'Código não informado' });

  const apiKey = process.env.CORREIOS_API_KEY;

  try {
    const response = await fetch(
      `https://api.correios.com.br/srorastro/v1/objetos/${codigo}?resultado=T`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        }
      }
    );

    const data = await response.json();

    if (!response.ok || !data.objetos?.length) {
      return res.status(404).json({ erro: 'Objeto não encontrado. Verifique o código e tente novamente.' });
    }

    return res.status(200).json(data.objetos[0]);

  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao consultar os Correios.' });
  }
}
