// LeadFlow core: state + Gemini-driven qualification + slot booking
const fs = require('fs'), path = require('path');
const CFG = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE || path.join(__dirname, 'config.json')));
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'state.json');
const load = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE)); } catch { return {}; } };
const save = s => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
const A = CFG.agency;

function systemPrompt(c) {
  return `You are the WhatsApp ${A.assistantName} for ${A.name}, an estate agency in ${A.area}, South Africa. You reply to property buyers' enquiries.
Style: text exactly like a real South African estate agent on WhatsApp. Short casual messages, usually one or two lines, one question at a time. Relaxed punctuation is fine, lowercase starts are ok but always capitalise names (people, agency, places). NEVER use colons, dashes or hyphens as punctuation, em dashes, bullet points, numbered lists, bold or any formal structure. Write times like 10am or 2pm. Local touches like "sharp", "no stress", "lekker" are fine but don't overdo it. Use Rands. Never use the words "AI", "bot", "artificial", "language model". If asked whether you are a robot, a person or anything similar, never deny it and never say "not at all": simply say you're the digital assistant for ${A.name} that runs 24/7, and ${A.agentName} (the agent) will be in touch personally.
When qualified becomes true, your reply must ONLY thank them briefly (e.g. "cool thanks thats everything i need", all lowercase and casual). Do NOT ask about days, times, weekdays or weekends; the system sends the viewing slots straight after your message.
Listings (only these exist; never invent others or details): ${JSON.stringify(A.listings)}
Your goal: answer their question briefly, then qualify by collecting: listing of interest, budget, finance (bond pre-approved / applying / cash), timeline to buy, whether they have a home to sell first, and their name. Then the system will offer viewing slots.
Current known lead info: ${JSON.stringify(c.lead)}
Stage: ${c.stage}. ${c.stage==='offer'||c.stage==='booking' ? `Offered slots: ${JSON.stringify(c.offered)} (shown to buyer as ${c.offered ? c.offered.map(nice).join(', ') : ''}). If the buyer picks one, set chosenSlot to the exact slot string.` : ''}
Return ONLY JSON: {"reply": string, "lead": {"name","listing","budget","finance","timeline","homeToSell"} (fill what you know, null otherwise), "qualified": boolean (true when listing, budget, finance, timeline, homeToSell all known), "chosenSlot": string|null}`;
}

async function gemini(c, text) {
  const contents = c.history.map(h => ({ role: h.r === 'bot' ? 'model' : 'user', parts: [{ text: h.t }] }));
  contents.push({ role: 'user', parts: [{ text }] });
  const models = (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []).concat(CFG.models);
  for (let i = 0; i < models.length * 2; i++) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${models[i % models.length]}:generateContent`;
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt(c) }] }, contents,
        generationConfig: { responseMimeType: 'application/json', temperature: 0.6 } }) });
    if (r.ok) { const j = await r.json(); try { const t = j.candidates[0].content.parts.filter(p => p.text && !p.thought).map(p => p.text).join(''); return JSON.parse(t.replace(/^```json|```$/g, '').trim()); } catch {} }
    else console.error('Gemini error', r.status, models[i % models.length]);
    await new Promise(s => setTimeout(s, 1500));
  }
  return { reply: `Thanks for your message! ${A.agentName} from ${A.name} will get back to you shortly.`, lead: {}, qualified: false, chosenSlot: null };
}

const clean = s => s.replace(/\bA\.?I\.?\b/g, 'digital assistant').replace(/\bbot\b/gi, 'assistant')
  .replace(/\*\*?|__/g, '').replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
  .replace(/\b(\d{1,2}):(\d{2})\b/g, (m, h, mm) => { h = +h; const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12; return h12 + (mm === '00' ? '' : ':' + mm).replace(':', '.') + ap; })
  .replace(/\s*[—–]\s*/g, ', ').replace(/\s+-\s+/g, ', ').replace(/\s*:\s*/g, ', ')
  .replace(/,\s*,/g, ',').replace(/,\s*([.!?])/g, '$1').trim();
const nice = slot => clean(slot);

function score(l) {
  const f = (l.finance || '').toLowerCase(), t = (l.timeline || '').toLowerCase(), sell = (l.homeToSell || '').toString().toLowerCase();
  const ready = /pre-?approv|cash/.test(f), soon = /now|asap|immediate|week|month|1|2|3/.test(t) && !/year|12|6 month/.test(t);
  const chain = /yes|true|need to sell/.test(sell) && !/sold|no\b/.test(sell);
  if (ready && soon && !chain) return 'Hot';
  if (ready || soon) return 'Warm';
  return 'Cold';
}

function summary(c, from) {
  const l = c.lead;
  return `*New lead – ${score(l)}* (${A.name})\nName: ${l.name || '-'}\nWhatsApp: +${from}\nListing: ${l.listing || '-'}\nBudget: ${l.budget || '-'}\nFinance: ${l.finance || '-'}\nTimeline: ${l.timeline || '-'}\nHome to sell: ${l.homeToSell ?? '-'}\nViewing: ${c.booked || 'not booked'}\nFirst contact: ${c.started}`;
}

async function handle(from, text) {
  const S = load(); const c = S[from] || (S[from] = { stage: 'qualify', lead: {}, history: [], started: new Date().toISOString() });
  const out = []; let agentSummary = null;
  if (c.stage === 'done') {
    const g = await gemini(c, text); out.push(clean(g.reply));
  } else {
    const g = await gemini(c, text);
    for (const [k, v] of Object.entries(g.lead || {})) if (v !== null && v !== '') c.lead[k] = v;
    const pick = g.chosenSlot && (c.offered || []).find(s => s.toLowerCase() === String(g.chosenSlot).toLowerCase());
    if (c.stage === 'offer' && pick) {
      c.booked = pick; c.stage = 'done';
      out.push(clean(`sharp you're booked for ${pick}, ${A.agentName} will send you the address and meet you there. just shout here if you need to move it`));
      agentSummary = summary(c, from);
    } else if (c.stage === 'qualify' && ['listing','budget','finance','timeline','homeToSell'].every(k => c.lead[k] != null && c.lead[k] !== '')) {
      c.offered = A.viewingSlots.slice(0, 3); c.stage = 'offer';
      out.push(clean(g.reply));
      out.push(`i've got ${nice(c.offered[0])}, ${nice(c.offered[1])} or ${nice(c.offered[2])} for a viewing, which one suits you?`);
    } else {
      const m = c.stage === 'offer' && /^\s*([123])\s*$/.exec(text);
      if (m) return (S[from] = c, save(S), handle(from, c.offered[m[1] - 1]));
      out.push(clean(g.reply));
    }
  }
  c.history.push({ r: 'user', t: text }, ...out.map(t => ({ r: 'bot', t })));
  c.history = c.history.slice(-30); save(S);
  return { replies: out, agentSummary, stage: c.stage, lead: c.lead };
}
module.exports = { handle, summary, score, CFG };
