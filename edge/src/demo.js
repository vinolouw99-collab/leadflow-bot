// Self-serve "try it yourself" web demo. Reuses core.handle with a sample agency, state under d:<session>.
import { handle } from './core.js';

export const DEMO_AGENCY = {
  name: 'Sunset Realty', assistantName: 'Sunset Realty assistant', agentName: 'Thabo', area: 'Johannesburg',
  listings: [
    { ref: 'SR-101', title: '3 bed family home, Bryanston', price: 'R2,450,000', details: '3 bed, 2 bath, double garage, pool, pet friendly' },
    { ref: 'SR-102', title: '2 bed apartment, Rosebank', price: 'R1,350,000', details: '2 bed, 1 bath, balcony, 24h security, near Gautrain' },
    { ref: 'SR-103', title: '4 bed home, Midrand', price: 'R3,200,000', details: '4 bed, 3 bath, garden, solar, secure estate' }
  ],
  viewingSlots: ['Sat 10:00', 'Sat 12:00', 'Sun 14:00', 'Mon 17:30', 'Wed 17:30']
};

const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function bump(env, key, limit, ttl) {
  const n = +(await env.STATE.get(key) || 0) + 1;
  await env.STATE.put(key, String(n), { expirationTtl: ttl });
  return n > limit;
}

export async function demoChat(req, env) {
  let b; try { b = await req.json(); } catch { return J({ error: 'bad json' }, 400); }
  const sid = String(b.session || '');
  const text = String(b.text || '').trim().slice(0, 500);
  if (!/^[a-zA-Z0-9]{16,40}$/.test(sid) || !text) return J({ error: 'bad request' }, 400);
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  const hour = Math.floor(Date.now() / 3600000);
  if (await bump(env, `rl:ip:${ip}:${hour}`, 60, 3700)) return J({ replies: ["sorry, that's a lot of messages for one demo. give it a bit and try again"], limited: true }, 429);
  if (await bump(env, `rl:s:${sid}`, 40, 86400)) return J({ replies: ["that's the end of this demo chat, refresh the page to start again"], limited: true }, 429);
  const r = await handle(env, sid, text, 0, { prefix: 'd:', ttl: 86400, agency: DEMO_AGENCY });
  return J({ replies: r.replies, stage: r.stage, lead: r.lead, summary: r.agentSummary ? r.agentSummary.replace(/^WhatsApp.*\n/m, 'WhatsApp: the buyer\'s number\n').replace(' – ', ', ').replace(/First contact: (\S+)/, (m, t) => 'First contact: ' + new Date(t).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })) : null });
}

export const DEMO_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>LeadFlow, try it yourself</title>
<meta name="description" content="See how LeadFlow replies to a property lead in seconds, qualifies them and books a viewing.">
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#d1d7db;display:flex;justify-content:center}
.app{width:100%;max-width:480px;height:100dvh;display:flex;flex-direction:column;background:#efeae2;box-shadow:0 0 20px rgba(0,0,0,.15)}
.brand{background:#0b3d2e;color:#fff;padding:10px 14px;font-size:13px;line-height:1.35}
.brand b{font-size:15px}.brand span{opacity:.85}
.top{background:#075e54;color:#fff;display:flex;align-items:center;gap:10px;padding:10px 14px}
.av{width:38px;height:38px;border-radius:50%;background:#25d366;display:flex;align-items:center;justify-content:center;font-weight:700}
.top .n{font-weight:600}.top .s{font-size:12px;opacity:.85}
#log{flex:1;overflow-y:auto;padding:12px 10px}
.m{max-width:80%;padding:7px 10px 18px;margin:4px 0;border-radius:8px;font-size:15px;line-height:1.35;position:relative;white-space:pre-wrap;word-wrap:break-word;box-shadow:0 1px .5px rgba(0,0,0,.13)}
.m.in{background:#fff;margin-right:auto}.m.out{background:#d9fdd3;margin-left:auto}
.m i{position:absolute;right:8px;bottom:3px;font-size:11px;color:#667781;font-style:normal}
.note{text-align:center;font-size:12.5px;color:#54656f;background:#fff8c5;border-radius:8px;padding:6px 10px;margin:6px auto 10px;max-width:90%}
.typing{color:#667781;font-size:13px;padding:2px 12px;height:18px}
.chips{display:flex;gap:6px;overflow-x:auto;padding:0 10px 6px}
.chips button{flex:none;border:1px solid #c5ccd0;background:#fff;border-radius:16px;padding:6px 10px;font-size:13px;cursor:pointer}
form{display:flex;gap:8px;padding:8px;background:#f0f2f5}
input{flex:1;border:0;border-radius:20px;padding:11px 14px;font-size:16px;outline:none}
form button{width:44px;height:44px;border:0;border-radius:50%;background:#00a884;color:#fff;font-size:18px;cursor:pointer}
.done{background:#e7f6ec;border:1px solid #9fd8b0;color:#0b3d2e;border-radius:8px;padding:10px;margin:8px 0;font-size:13.5px;white-space:pre-wrap}
</style></head><body><div class="app">
<div class="brand"><b>LeadFlow</b> <span>try it yourself</span><br>Pretend you're a buyer and message about a listing. Watch it reply in seconds, ask the right questions and book you a viewing, 24/7.</div>
<div class="top"><div class="av">SR</div><div><div class="n">Sunset Realty (sample agency)</div><div class="s">digital assistant, replies 24/7</div></div></div>
<div id="log"><div class="note">Sample listings: 3 bed home in Bryanston R2.45m, 2 bed flat in Rosebank R1.35m, 4 bed home in Midrand R3.2m</div></div>
<div class="typing" id="ty"></div>
<div class="chips" id="chips"><button>Hi, is the Rosebank flat still available?</button><button>Hi, I saw the Bryanston house</button><button>What's the price on the Midrand home?</button></div>
<form id="f"><input id="t" placeholder="Type a message" autocomplete="off" maxlength="500"><button aria-label="Send">&#10148;</button></form>
</div><script>
const log=document.getElementById('log'),f=document.getElementById('f'),t=document.getElementById('t'),ty=document.getElementById('ty'),chips=document.getElementById('chips');
let sid=sessionStorage.getItem('lf_sid');if(!sid){sid=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');sessionStorage.setItem('lf_sid',sid)}
const now=()=>new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
function add(txt,cls){const d=document.createElement('div');d.className='m '+cls;d.textContent=txt;const i=document.createElement('i');i.textContent=now();d.appendChild(i);log.appendChild(d);log.scrollTop=log.scrollHeight}
let busy=false;
async function send(txt){if(busy||!txt.trim())return;busy=true;chips.style.display='none';add(txt,'out');t.value='';ty.textContent='typing...';
 try{const r=await fetch('/demo/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session:sid,text:txt})});const j=await r.json();
  for(const m of (j.replies||[])){await new Promise(s=>setTimeout(s,500));add(m,'in')}
  if(j.summary){const d=document.createElement('div');d.className='done';d.textContent='What the agent gets on their phone:\\n\\n'+j.summary.replace(/\\*/g,'');log.appendChild(d);log.scrollTop=log.scrollHeight}
 }catch(e){add('connection dropped, try again','in')}ty.textContent='';busy=false;t.focus()}
f.onsubmit=e=>{e.preventDefault();send(t.value)};chips.querySelectorAll('button').forEach(b=>b.onclick=()=>send(b.textContent));
</script></body></html>`;
