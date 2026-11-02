// optional .env loader (no deps); existing env vars win
try { for (const l of require('fs').readFileSync(__dirname + '/.env', 'utf8').split('\n')) { const m = l.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/); if (m && !l.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2'); } } catch {}
const http = require('http'); const { handle } = require('./bot');
const { PORT = 3000, VERIFY_TOKEN, WHATSAPP_TOKEN, PHONE_NUMBER_ID = '1423131840883763', AGENT_WHATSAPP, GRAPH_VERSION = 'v21.0' } = process.env;
async function send(to, body) {
  if (!WHATSAPP_TOKEN) return console.log('[no WHATSAPP_TOKEN] would send to', to, ':', body);
  const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, { method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }) });
  if (!r.ok) console.error('Graph send failed', r.status, await r.text());
}
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && u.pathname === '/webhook') {
    const ok = u.searchParams.get('hub.mode') === 'subscribe' && VERIFY_TOKEN && u.searchParams.get('hub.verify_token') === VERIFY_TOKEN;
    res.writeHead(ok ? 200 : 403); return res.end(ok ? u.searchParams.get('hub.challenge') : 'forbidden');
  }
  if (req.method === 'POST' && u.pathname === '/webhook') {
    let b = ''; req.on('data', d => b += d); req.on('end', async () => {
      res.writeHead(200); res.end('ok'); // ack fast
      try {
        for (const e of JSON.parse(b).entry || []) for (const ch of e.changes || []) for (const m of ch.value?.messages || []) {
          if (m.type !== 'text') { await send(m.from, 'Thanks! Please send that as a text message and I\'ll help right away.'); continue; }
          const r = await handle(m.from, m.text.body);
          for (const t of r.replies) await send(m.from, t);
          if (r.agentSummary) AGENT_WHATSAPP ? await send(AGENT_WHATSAPP, r.agentSummary) : console.log(r.agentSummary);
        }
      } catch (err) { console.error(err); }
    }); return;
  }
  res.writeHead(200); res.end('LeadFlow running');
}).listen(PORT, () => console.log('listening', PORT));
