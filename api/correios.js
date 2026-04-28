export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ erro: 'Código não informado' });

  const usuario = process.env.CORREIOS_USUARIO;
  const senha = process.env.CORREIOS_SENHA;

  try {
    // 1. Gerar token
    const authResponse = await fetch'https://api.correios.com.br/token/v1/autentica/cartaopostagem'
, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(usuario + ':' + senha).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ numero: "0076414787" })
    });

    const authText = await authResponse.text();
    let authData;
    try { authData = JSON.parse(authText); } 
    catch(e) { return res.status(500).json({ erro: 'Resposta inválida dos Correios', detalhe: authText }); }

    if (!authResponse.ok || !authData.token) {
      return res.status(401).json({ erro: 'Falha na autenticação.', detalhe: authData });
    }

    const token = authData.token;

    // 2. Consultar rastreio
    const rastreioResponse = await fetch(
      `https://api.correios.com.br/srorastro/v1/objetos/${codigo}?resultado=T`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );

    const data = await rastreioResponse.json();

    if (!rastreioResponse.ok || !data.objetos?.length) {
      return res.status(404).json({ erro: 'Objeto não encontrado.', detalhe: data });
    }

    return res.status(200).json(data.objetos[0]);

  } catch (err) {
    return res.status(500).json({ erro: 'Erro interno.', detalhe: err.message });
  }
}
