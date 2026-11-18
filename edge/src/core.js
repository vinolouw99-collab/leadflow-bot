// LeadFlow core for Cloudflare Workers (ported from bot/bot.js). State per sender in KV.
import CFG from './config.json' with { type: 'json' };
let A = CFG.agency;
let ENV = {};
const BASIC = ['listing','budget','finance','timeline','homeToSell','name'];
const HV = ['listing','finance','budget','buyingAs','sourceOfFunds','timeline','homeToSell','name','proofOfFunds'];
const kw = x => x.title.toLowerCase().split(/[ ,]+/).filter(w => w.length > 4 && !/house|home|apartment|family|estate/.test(w));
function guessListing(text) { const t = String(text).toLowerCase(); return (A.listings || []).find(x => t.includes(x.ref.toLowerCase()) || kw(x).some(w => t.includes(w))); }
function isRentalListing(x) {
  if (!x) return false;
  const t = `${x.title || ''} ${x.details || ''} ${x.price || ''}`.toLowerCase();
  return /\b(rent|rental|to let|for rent|per month|\bpm\b)\b/.test(t);
}
function matchedListing(c) {
  const ls = A.listings || [], l = c.lead || {};
  const ref = String(l.listingRef || '').toUpperCase(), txt = String(l.listing || '').toLowerCase();
  return ls.find(x => x.ref.toUpperCase() === ref) || ls.find(x => txt && (txt.includes(x.ref.toLowerCase()) || kw(x).some(w => txt.includes(w)))) || null;
}
// Strict proof of funds qualification for every buyer, any price. Rentals keep the lighter BASIC flow.
function listingOf(c) { const hit = matchedListing(c); return hit && !isRentalListing(hit) ? hit : null; }
function strictBuyer(c) { const hit = matchedListing(c); return !(hit && isRentalListing(hit)); }
const need = (c, strict) => (strict ? HV : BASIC).filter(k => k === 'proofOfFunds' ? c.lead.proofOfFunds !== 'received' : (c.lead[k] == null || c.lead[k] === ''));

function systemPrompt(c) {
  const strict = strictBuyer(c), listing = listingOf(c), missing = need(c, strict);
  return `You are the WhatsApp ${A.assistantName} for ${A.name}, an estate agency in ${A.area}, South Africa. You reply to property buyers' and tenants' enquiries.
Style: text like a warm, professional estate agent on WhatsApp. Short friendly messages, usually one or two lines, one question at a time. Relaxed punctuation is fine, lowercase starts are ok but always capitalise names (people, agency, places). NEVER use colons, dashes or hyphens as punctuation, em dashes, bullet points, numbered lists, bold or any formal structure. Write times like 10am or 2pm. Keep a polite professional tone that still feels human and personal. Do not use slang, including South African slang such as lekker, shap, howzit, eish, sharp, sharp sharp, ja, awesome sauce, yebo or boet. Warm and natural is good, slang is not. Use Rands. Never use the words "AI", "bot", "artificial", "language model". If asked whether you are a robot, a person or anything similar, never deny it and never say "not at all": simply say you're the digital assistant for ${A.name} that runs 24/7, and ${A.agentName} (the agent) will be in touch personally.
When qualified becomes true, your reply must ONLY thank them briefly (e.g. "cool thanks thats everything i need", all lowercase and casual). Never say that again later in the chat. Do NOT ask about days, times, weekdays or weekends; the system sends the viewing slots straight after your message.
Listings (only these exist; never invent others or details): ${JSON.stringify(A.listings)}
Your goal: answer their question briefly, then qualify by collecting: listing of interest, budget, finance (bond pre-approved / applying / cash), timeline to buy, whether they have a home to sell first, and their first name (ask casually, like "thanks, and whats your name?"). Then the system will offer viewing slots.
Current known lead info: ${JSON.stringify(c.lead)}
${strict ? buyerPrompt(listing, c) : ''}
Still missing (ask for the next one in this order, unless the buyer's latest message answers it): ${missing.join(', ') || 'nothing'}. Only say you have everything when nothing is missing after this message.
Stage: ${c.stage}. ${c.stage==='offer'||c.stage==='booking' ? `Offered slots: ${JSON.stringify(c.offered)} (shown to buyer as ${c.offered ? c.offered.map(nice).join(', ') : ''}). If the buyer picks one, set chosenSlot to the exact slot string.` : ''}
Return ONLY JSON: {"reply": string, "lead": {"name","listing","listingRef","budget","finance","timeline","homeToSell","buyingAs","sourceOfFunds","proofOfFunds"} (fill what you know, null otherwise; listingRef is the ref like SR-101; buyingAs, sourceOfFunds and proofOfFunds are required for every buyer), "qualified": boolean (true when nothing is missing), "declined": boolean (for buyer qualification, see above), "chosenSlot": string|null}`;
}

function buyerPrompt(listing, c) {
  const about = listing ? `The buyer is asking about ${listing.title} at ${listing.price}. ` : '';
  return `BUYER QUALIFICATION. ${about}Viewings are only booked for FICA verified buyers with proven funds, so you qualify like an experienced senior agent who knows the process, warm and respectful but thorough. This replaces the normal qualifying list above. Never pushy, never rude, never accusing. Your first reply confirms the listing is available with one standout detail (or if they haven't named a listing yet, help them pick one), then asks the first missing item. Ask one thing at a time, in this order.
finance: cash or bond. If bond, ask the bank and whether they have a bond approval or pre approval letter. If cash, the funds must already be in a bank account.
budget: the amount they have available or approved, in Rands (skip it if they already said the amount).
buyingAs: buying in their personal name, a company or a trust.
sourceOfFunds: where the funds come from (salary, business, sale of a property, investments, inheritance etc). Frame it politely as a FICA requirement every agency has to ask, nothing personal. If they mention physical cash, a briefcase or cash they want to bring, explain kindly that by law we can't accept cash, the funds need to sit in a South African bank account and come through the bank.
timeline: when they want to buy. homeToSell: whether they need to sell first.
name: their full name exactly as on their ID, and mention that ${A.agentName} will need their ID and proof of address for FICA before any offer.
proofOfFunds: ask them to send the bank issued proof of funds letter or recent bank statement showing the funds available now (if bond, the bond approval letter) right here in the chat, it stays confidential and only ${A.agentName} sees it. Set proofOfFunds to "promised" if they say they will send it later, "received" ONLY when they say they have sent or attached it now (e.g. "sent", "just sent it", "attached", "here you go") or the message says they attached a document, and "refused" if they won't share it. If promised, say that's no problem and they can send it here whenever they're ready, the viewing gets locked in as soon as it lands.
Never say you have everything you need, and never offer or discuss viewing times, before proofOfFunds is received, even if they push. If they ask to view first, explain kindly that we need proof of funds before any viewing.
Set declined true when the buyer clearly refuses to share proof of funds or source of funds, or dodges it twice. Then your reply must politely say you understand, but you can't book a viewing without it, that the door stays open if they send it later, and offer to keep them posted on other listings. Don't lecture.
Docs received so far: ${JSON.stringify(c.docs || [])}.`;
}

async function gemini(c, text) {
  const contents = c.history.map(h => ({ role: h.r === 'bot' ? 'model' : 'user', parts: [{ text: h.t }] }));
  contents.push({ role: 'user', parts: [{ text }] });
  let models = (ENV.GEMINI_MODEL ? [ENV.GEMINI_MODEL] : []).concat(CFG.models);
  // skip models whose daily quota is used up (remembered in KV until it resets), keep at least one to try
  const dead = await Promise.all(models.map(m => ENV.STATE.get('q:' + m).catch(() => null)));
  if (dead.some(d => !d)) models = models.filter((m, i) => !dead[i]);
  for (let i = 0; i < models.length * 2; i++) {
    const model = models[i % models.length];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    let r; try { r = await fetch(url, { signal: AbortSignal.timeout(15000), method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': ENV.GEMINI_API_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt(c) }] }, contents,
        generationConfig: { responseMimeType: 'application/json', temperature: 0.6, ...(/flash/.test(model) ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) } }) }); } catch (e) { console.error('Gemini network error', e.message, model); continue; }
    if (r.ok) { const j = await r.json(); try { const t = j.candidates[0].content.parts.filter(p => p.text && !p.thought).map(p => p.text).join(''); return JSON.parse(t.replace(/^```json|```$/g, '').trim()); } catch {} }
    else {
      console.error('Gemini error', r.status, model);
      if (r.status === 429) {
        const body = await r.text().catch(() => '');
        if (/PerDay/i.test(body)) { const d = +((/"retryDelay":\s*"(\d+)s"/.exec(body) || [])[1] || 3600); await ENV.STATE.put('q:' + model, '1', { expirationTtl: Math.max(60, Math.min(d, 86400)) }).catch(() => {}); }
        continue;  // no point waiting on a quota error, go straight to the next model
      }
    }
    await new Promise(s => setTimeout(s, 1000));
  }
  return { reply: `thanks for your message, ${A.agentName} from ${A.name} will get back to you shortly`, lead: {}, qualified: false, chosenSlot: null };
}

const clean = s => s.replace(/!+/g, '.').replace(/\.\s*\./g, '.').replace(/\bA\.?I\.?\b/g, 'digital assistant').replace(/\bbot\b/gi, 'assistant')
  .replace(/\*\*?|__/g, '').replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
  .replace(/\b(\d{1,2}):(\d{2})\b/g, (m, h, mm) => { h = +h; const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12; return h12 + (mm === '00' ? '' : ':' + mm).replace(':', '.') + ap; })
  .replace(/\s*[—–]\s*/g, ', ').replace(/\s+-\s+/g, ', ').replace(/\s*:\s*/g, ', ')
  .replace(/,\s*,/g, ',').replace(/,\s*([.!?])/g, '$1')
  .replace(/\bfica\b/gi, 'FICA').replace(/\bid\b/g, 'ID').replace(/\bthabo\b/g, 'Thabo')
  .replace(new RegExp('\\b(' + [...new Set((A.listings || []).map(x => x.title.split(', ').pop()).concat(A.area))].join('|') + ')\\b', 'gi'), m => m[0].toUpperCase() + m.slice(1).toLowerCase())
  .replace(/\b(awesome\s+sauce|sharp\s+sharp|howzit|heita|eish|lekker|yebo|jislaaik|boet)\b[,!.]*/gi, '')
  .replace(/\bshap\b[,!.]*/gi, '')
  .replace(/(^|[.!?]\s+|\s)\bja\b[,!.]*/gi, '$1')
  .replace(/(^|[.!?]\s+|\s)\bsharp\b[,!.]*/gi, '$1')
  .replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.])/g, '$1').replace(/^[,.\s]+/, '').trim();
const nice = slot => clean(slot);

function score(l) {
  const f = (l.finance || '').toLowerCase(), t = (l.timeline || '').toLowerCase(), sell = (l.homeToSell || '').toString().toLowerCase();
  const ready = /pre-?approv|cash/.test(f), soon = /now|asap|immediate|week|month|1|2|3/.test(t) && !/year|12|6 month/.test(t);
  const chain = /yes|true|need to sell/.test(sell) && !/sold|no\b/.test(sell);
  if (ready && soon && !chain) return 'Hot';
  if (ready || soon) return 'Warm';
  return 'Cold';
}

function verified(l) { return l.proofOfFunds === 'received' && !!l.sourceOfFunds; }
function summary(c, from) {
  const l = c.lead, listing = listingOf(c);
  if (strictBuyer(c)) {
    const v = verified(l);
    const listed = listing ? `${listing.title} (${listing.price})` : (l.listing || '-');
    return `*${v ? 'Verified buyer' : 'Not verified'}, ${v ? 'Hot' : 'do not book'}* (${A.name})\nName as on ID: ${l.name || '-'}\nWhatsApp: +${from}\nListing: ${listed}\nBuying as: ${l.buyingAs || '-'}\nFunds: ${l.finance || '-'}\nAmount confirmed: ${l.budget || '-'}\nSource of funds: ${l.sourceOfFunds || 'not given'}\nProof of funds: ${l.proofOfFunds === 'received' ? 'received' + (c.docs && c.docs.length ? ' (' + c.docs.join(', ') + ')' : '') + ', agent to check' : l.proofOfFunds === 'promised' ? 'promised, not received' : 'not provided'}\nFICA (ID, proof of address): requested\nTimeline: ${l.timeline || '-'}\nHome to sell: ${l.homeToSell ?? '-'}\nViewing: ${c.booked || (v ? 'not booked' : 'not booked, funds not verified')}\nFirst contact: ${c.started}`;
  }
  return `*New lead – ${score(l)}* (${A.name})\nName: ${l.name || '-'}\nWhatsApp: +${from}\nListing: ${l.listing || '-'}\nBudget: ${l.budget || '-'}\nFinance: ${l.finance || '-'}\nTimeline: ${l.timeline || '-'}\nHome to sell: ${l.homeToSell ?? '-'}\nViewing: ${c.booked || 'not booked'}\nFirst contact: ${c.started}`;
}

async function handle(env, from, text, depth = 0, opts = {}) {
  ENV = env; A = opts.agency || CFG.agency;
  const key = (opts.prefix || 'c:') + from;
  const c = (await env.STATE.get(key, 'json')) || { stage: 'qualify', lead: {}, history: [], started: new Date().toISOString() };
  const n = c.stage === 'offer' && /^\s*([123])\s*$/.exec(text);
  if (n && c.offered) text = c.offered[n[1] - 1];  // map '2' to the slot before asking Gemini
  const out = []; let agentSummary = null;
  const doc = /^\s*📎\s*(.+)/.exec(text);
  if (doc) { (c.docs = c.docs || []).push(doc[1].trim().slice(0, 80)); text = `[buyer attached a document: ${doc[1].trim().slice(0, 80)}]`; }
  if (!c.lead.listing) { const gl = guessListing(text); if (gl) Object.assign(c.lead, { listing: gl.title, listingRef: gl.ref }); }
  const g = await gemini(c, text);
  if (c.stage === 'done') { out.push(clean(g.reply)); }
  else {
    const prevPof = c.lead.proofOfFunds;
    for (const [k, v] of Object.entries(g.lead || {})) if (v !== null && v !== '' && v !== 'null') c.lead[k] = v;
    const strict = strictBuyer(c);
    if (strict) {
      // code guard: proof only counts as received on an attachment or a clear "sent" message, never on "i'll send it"
      const sentNow = !!doc || /\b(sent|attached|here (it is|you go)|just sen[dt]|have sent|uploaded)\b/i.test(text) && !/\b(will|i'?ll|gonna|going to|later|tomorrow)\b/i.test(text);
      if (c.lead.proofOfFunds === 'received' && prevPof !== 'received' && !sentNow) c.lead.proofOfFunds = prevPof || 'promised';
      if (sentNow && need(c, true)[0] === 'proofOfFunds') c.lead.proofOfFunds = 'received';
    }
    const pick = g.chosenSlot && (c.offered || []).find(s => s.toLowerCase() === String(g.chosenSlot).toLowerCase());
    if (c.stage === 'offer' && pick) {
      c.booked = pick; c.stage = 'done';
      out.push(clean(`perfect you're booked for ${pick}, ${A.agentName} will send you the address and meet you there. just message here if you need to move it`));
      agentSummary = summary(c, from);
    } else if (strict && c.stage !== 'offer' && (g.declined || c.lead.proofOfFunds === 'refused') && c.lead.proofOfFunds !== 'received') {
      c.lead.proofOfFunds = 'refused';
      out.push(clean(g.reply));
      if (c.stage !== 'declined') { c.stage = 'declined'; agentSummary = summary(c, from); }
    } else if ((c.stage === 'qualify' || c.stage === 'declined') && need(c, strict).length === 0) {
      c.offered = A.viewingSlots.slice(0, 3); c.stage = 'offer';
      out.push(clean(strict ? `perfect thanks ${String(c.lead.name).split(' ')[0]}, got it and passed it to ${A.agentName} to check. you're all set for a private viewing` : g.reply));
      out.push(`i've got ${nice(c.offered[0])}, ${nice(c.offered[1])} or ${nice(c.offered[2])} for a viewing, which one suits you?`);
    } else {
      const m = c.stage === 'offer' && !depth && /^\s*([123])\s*$/.exec(text);
      if (m) return handle(env, from, c.offered[m[1] - 1], 1, opts);
      let rep = g.reply;
      if (strict && c.stage !== 'offer' && c.lead.proofOfFunds !== 'received' && /everything i need|all set|you'?re booked/i.test(rep))
        rep = need(c, true)[0] === 'proofOfFunds' && c.lead.proofOfFunds === 'promised' ? `no problem, just send it here whenever you're ready and i'll lock in the viewing as soon as it lands` : rep.replace(/[^.?]*(everything i need|all set|you'?re booked)[^.?]*[.?]?/i, '').trim() || `thanks`;
      out.push(clean(rep));
    }
  }
  c.history.push({ r: 'user', t: text }, ...out.map(t => ({ r: 'bot', t })));
  c.history = c.history.slice(-30);
  await env.STATE.put(key, JSON.stringify(c), { expirationTtl: opts.ttl || 60 * 60 * 24 * 30 });
  return { replies: out, agentSummary, stage: c.stage, lead: c.lead };
}
export { handle, summary, score, CFG, clean };
