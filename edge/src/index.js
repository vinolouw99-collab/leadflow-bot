import { handle } from './core.js';
async function send(env, to, body) {
  if (!env.WHATSAPP_TOKEN) return console.log('[no WHATSAPP_TOKEN] would send to', to, body);
  const r = await fetch(`https://graph.facebook.com/${env.GRAPH_VERSION || 'v21.0'}/${env.PHONE_NUMBER_ID}/messages`, { method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }) });
  if (!r.ok) console.error('Graph send failed', r.status, await r.text());
}
async function process(env, payload) {
  for (const e of payload.entry || []) for (const ch of e.changes || []) for (const s of ch.value?.statuses || []) console.log("STATUS", JSON.stringify(s));
  for (const e of payload.entry || []) for (const ch of e.changes || []) for (const m of ch.value?.messages || []) {
    // dedupe Meta retries
    if (await env.STATE.get('m:' + m.id)) continue;
    await env.STATE.put('m:' + m.id, '1', { expirationTtl: 86400 });
    if (m.type !== 'text') { await send(env, m.from, "thanks! please send that as a text message and i'll help right away"); continue; }
    const r = await handle(env, m.from, m.text.body);
    for (const t of r.replies) await send(env, m.from, t);
    if (r.agentSummary) env.AGENT_WHATSAPP ? await send(env, env.AGENT_WHATSAPP, r.agentSummary) : console.log(r.agentSummary);
  }
}
export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname === '/webhook' && req.method === 'GET') {
      const ok = u.searchParams.get('hub.mode') === 'subscribe' && env.VERIFY_TOKEN && u.searchParams.get('hub.verify_token') === env.VERIFY_TOKEN;
      return new Response(ok ? u.searchParams.get('hub.challenge') : 'forbidden', { status: ok ? 200 : 403 });
    }
    if (u.pathname === '/webhook' && req.method === 'POST') {
      let p; try { p = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
      ctx.waitUntil(process(env, p).catch(e => console.error(e)));  // ack Meta fast, work continues
      return new Response('ok');
    }
    return new Response('LeadFlow running');
  }
};
