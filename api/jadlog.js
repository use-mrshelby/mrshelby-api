export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ erro: 'Código não informado' });

  const token = process.env.JADLOG_TOKEN;

  // Tenta cada campo da API Embarcador até encontrar resultado
  async function consultarEmbarcador(campo) {
    const response = await fetch(
      'https://prd-traffic.jadlogtech.com.br/embarcador/api/tracking/consultar',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ consulta: [{ [campo]: codigo }] })
      }
    );
    return response.json();
  }

  // Fallback: API pública de rastreio da Jadlog (aceita etiqueta/remessa)
  async function consultarPublico() {
    const response = await fetch(
      `https://tracking.jadlog.com.br/tracking/package/${encodeURIComponent(codigo)}`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      }
    );
    if (!response.ok) return null;
    return response.json();
  }

  try {
    // 1. Tenta campos da API Embarcador (mais rica em informações)
    const campos = ['codigo', 'shipmentId', 'cte', 'nf', 'volume'];
    let resultado = null;

    for (const campo of campos) {
      const data = await consultarEmbarcador(campo);
      const r = data?.consulta?.[0];
      if (r?.tracking) {
        resultado = r;
        break;
      }
    }

    // 2. Fallback: API pública (funciona com etiqueta e remessa)
    if (!resultado) {
      const publico = await consultarPublico().catch(() => null);
      if (publico?.tracking || publico?.status) {
        // Normaliza para o mesmo formato do Embarcador
        return res.status(200).json({
          tracking: {
            status: publico?.status ?? publico?.tracking?.status ?? null,
            situacao: publico?.situacao ?? null,
            descricao: publico?.descricao ?? publico?.tracking?.descricao ?? null,
          }
        });
      }
    }

    if (!resultado) {
      return res.status(404).json({ erro: 'Pedido não encontrado. Verifique o código e tente novamente.' });
    }

    return res.status(200).json(resultado);

  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao consultar a transportadora.' });
  }
}
