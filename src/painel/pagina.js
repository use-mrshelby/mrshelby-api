/**
 * HTML do painel. Uma página só, sem dependências externas: ela busca os dados
 * em /dados e se atualiza sozinha a cada minuto.
 */

function paginaHtml() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entregas · Mr. Shelby</title>
<style>
  :root { color-scheme: light dark; --bg:#f5f5f5; --card:#fff; --txt:#111; --fraco:#777; --linha:#e5e5e5; }
  @media (prefers-color-scheme: dark) { :root { --bg:#16161a; --card:#1f1f24; --txt:#f2f2f2; --fraco:#9a9a9a; --linha:#33333a; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--txt); font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; padding:16px; }
  header { max-width:1100px; margin:0 auto 18px; display:flex; flex-wrap:wrap; gap:12px; align-items:baseline; justify-content:space-between; }
  h1 { font-size:20px; margin:0; font-weight:700; }
  .sub { color:var(--fraco); font-size:13px; }
  main { max-width:1100px; margin:0 auto; }
  .grupo { margin:0 0 26px; }
  .grupo h2 { font-size:15px; margin:0 0 10px; display:flex; align-items:center; gap:8px; }
  .pill { font-size:12px; font-weight:700; color:#fff; border-radius:20px; padding:2px 10px; }
  .card { background:var(--card); border:1px solid var(--linha); border-radius:10px; padding:14px 16px; margin:0 0 10px; }
  .linha1 { display:flex; flex-wrap:wrap; gap:8px; align-items:baseline; justify-content:space-between; }
  .pedido { font-weight:700; }
  .motivo { font-weight:600; }
  .meta { color:var(--fraco); font-size:13px; margin-top:4px; }
  .acoes { margin-top:10px; display:flex; flex-wrap:wrap; gap:8px; }
  .acoes a { font-size:13px; text-decoration:none; border:1px solid var(--linha); border-radius:6px; padding:6px 10px; color:var(--txt); }
  .acoes a:hover { border-color:var(--fraco); }
  .vazio { color:var(--fraco); }
  .dias { font-variant-numeric:tabular-nums; }
</style>
</head>
<body>
<header>
  <div>
    <h1>Entregas que precisam de atenção</h1>
    <div class="sub" id="resumo">Carregando…</div>
  </div>
  <div class="sub" id="atualizado"></div>
</header>
<main id="conteudo"></main>
<script>
const fmt = n => n === null || n === undefined ? '—' : n;
function card(i) {
  const tel = i.telefone ? i.telefone.replace(/\\D/g,'') : '';
  const wa = tel ? 'https://wa.me/' + (tel.length <= 11 ? '55'+tel : tel) : null;
  return \`<div class="card">
    <div class="linha1">
      <span><span class="pedido">\${fmt(i.pedido) || i.codigo}</span> · \${fmt(i.cliente)}</span>
      <span class="motivo">\${i.motivo}</span>
    </div>
    <div class="meta">
      \${i.transportadora} · \${i.codigo}\${i.cidade ? ' · ' + i.cidade : ''}
      \${i.dias_parado !== null ? ' · <span class="dias">parado há ' + i.dias_parado + ' dia(s)</span>' : ''}
      \${i.texto_transportadora ? '<br>' + i.texto_transportadora : ''}
    </div>
    <div class="acoes">
      \${wa ? '<a href="'+wa+'" target="_blank">WhatsApp</a>' : ''}
      \${i.email ? '<a href="mailto:'+i.email+'">E-mail</a>' : ''}
      <a href="\${i.rastreio_url}" target="_blank">Rastreio</a>
      \${i.admin_url ? '<a href="'+i.admin_url+'" target="_blank">Pedido</a>' : ''}
    </div>
  </div>\`;
}
async function carregar() {
  try {
    const r = await fetch('dados' + location.search, { credentials:'same-origin' });
    if (!r.ok) throw new Error('resposta ' + r.status);
    const d = await r.json();
    const porGrupo = {};
    d.itens.forEach(i => { (porGrupo[i.grupo] = porGrupo[i.grupo] || []).push(i); });
    const partes = Object.entries(d.grupos).map(([chave, g]) => {
      const itens = porGrupo[chave] || [];
      if (!itens.length) return '';
      return '<section class="grupo"><h2><span class="pill" style="background:'+g.cor+'">'+itens.length+'</span>'+g.titulo+'</h2>' + itens.map(card).join('') + '</section>';
    });
    document.getElementById('conteudo').innerHTML = partes.join('') || '<p class="vazio">Nenhum pedido precisando de atenção agora.</p>';
    document.getElementById('resumo').textContent = d.itens.length + ' de ' + d.total_acompanhados + ' envios acompanhados';
    document.getElementById('atualizado').textContent = 'Atualizado às ' + new Date(d.atualizado_em).toLocaleTimeString('pt-BR');
  } catch (e) {
    document.getElementById('conteudo').innerHTML = '<p class="vazio">Não consegui carregar os dados (' + e.message + ').</p>';
  }
}
carregar();
setInterval(carregar, 60000);
</script>
</body>
</html>`;
}

module.exports = { paginaHtml };
