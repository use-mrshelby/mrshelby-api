export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ erro: 'Código não informado' });

  const usuario   = process.env.CORREIOS_USUARIO;
  const senha     = process.env.CORREIOS_SENHA;
  const contrato  = process.env.CORREIOS_CONTRATO;
  const codAdmin  = process.env.CORREIOS_COD_ADMIN;

  try {
    // 1. Autenticar e obter token
    const authResponse = await fetch('https://api.correios.com.br/token/v1/autentica/cartaopostagem', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(usuario + ':' + senha).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ numero: contrato })
    });

    if (!authResponse.ok) {
      return res.status(401).json({ erro: 'Falha na autenticação com os Correios.' });
    }

    const authData = await authResponse.json();
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

    const rastreioData = await rastreioResponse.json();

    if (!rastreioResponse.ok || !rastreioData.objetos?.length) {
      return res.status(404).json({ erro: 'Objeto não encontrado. Verifique o código e tente novamente.' });
    }

    return res.status(200).json(rastreioData.objetos[0]);

  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao consultar os Correios.' });
  }
}
