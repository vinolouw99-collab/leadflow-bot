// LeadFlow core for Cloudflare Workers (ported from bot/bot.js). State per sender in KV.
import CFG from './config.json' with { type: 'json' };
let A = CFG.agency;
let ENV = {};
const RENTAL = ['listing','budget','income','occupants','pets','timeline','name'];
const HV = ['listing','finance','budget','buyingAs','sourceOfFunds','saleStatus','timeline','homeToSell','name','proofOfFunds'];
const SALE_ONLY = new Set(['finance','homeToSell','buyingAs','sourceOfFunds','proofOfFunds','saleStatus']);
// Source of funds helpers. A buyer paying from the sale of their own property never has to prove funds up front.
const SALE_WORDS = /\b(sale|sell|sells|selling|sold|proceeds)\b/i;
const PROP_WORDS = /\b(house|home|place|property|properties|flat|apartment|unit|townhouse|plot|farm|stand|duplex|cottage|current|previous|old|existing)\b/i;
const fromSale = l => SALE_WORDS.test(`${l.sourceOfFunds || ''} ${l.finance || ''}`) && (PROP_WORDS.test(`${l.sourceOfFunds || ''} ${l.finance || ''}`) || /\bsale of\b|\bproceeds\b/i.test(l.sourceOfFunds || ''));
const sellingFirst = l => /^\s*(yes|yep|yeah|y)\b|need to sell|have to sell|must sell|selling|on the market|under offer|not sold/i.test(String(l.homeToSell ?? ''));
const needsSaleStatus = l => fromSale(l) || sellingFirst(l);
function normSaleStatus(v) {
  const t = String(v || '').toLowerCase();
  if (!t) return null;
  if (/under offer|offer (accepted|in)|accepted (an )?offer|pending|transfer|conveyanc|subject to/.test(t) && !/no offer/.test(t)) return 'under offer';
  if (/not (yet )?(listed|on the market)|haven'?t listed|not listed|before listing|still to list/.test(t)) return 'not listed yet';
  if (/not (yet )?sold|unsold|on the market|listed|selling|for sale|still/.test(t)) return 'on the market';
  if (/\bsold\b|registered|done|already|went through|gone through|completed/.test(t)) return 'sold';
  return t.slice(0, 40);
}
const OWN_PROP = /\b(my|our)\s+(\w+\s+)?(house|home|place|property|flat|apartment|unit|townhouse|farm|plot|duplex|cottage)\b/i;
const subjectToSale = l => !!l.saleStatus && l.saleStatus !== 'sold';
const isBond = l => /bond|mortgage|home ?loan/i.test(l.finance || '');
const SALE_LEAK = /\b(cash or (a )?bond|source of funds|proof of funds|bond approval|pre-?approv|sell (a )?(home|house|property) first|need to sell|buying as)\b/i;
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
// Strict qualification for every buyer, any price (source of funds required, proof of funds optional and never a loop). Rentals use a lighter flow (budget, income, occupants, pets, move in date, name).
function listingOf(c) { const hit = matchedListing(c); return hit && !isRentalListing(hit) ? hit : null; }
function strictBuyer(c) { const hit = matchedListing(c); return !(hit && isRentalListing(hit)); }
// proofOfFunds counts as answered once it has any value (received, promised, later, after sale ...). It is optional, never a gate.
const need = (c, strict) => (strict ? HV : RENTAL).filter(k => k === 'saleStatus' ? needsSaleStatus(c.lead) && !c.lead.saleStatus : (c.lead[k] == null || c.lead[k] === ''));
const rentalAsk = field => ({
  listing: 'which listing were you enquiring on?',
  budget: 'what is your monthly rental budget?',
  income: 'and what is your monthly income, roughly?',
  occupants: 'how many people will be living there?',
  pets: 'and do you have any pets?',
  timeline: 'when would you like to move in?',
  name: 'thanks, and whats your name?',
})[field] || 'thanks, could you tell me a bit more?';

function systemPrompt(c) {
  const strict = strictBuyer(c), listing = listingOf(c), missing = need(c, strict);
  return `You are the WhatsApp ${A.assistantName} for ${A.name}, an estate agency in ${A.area}, South Africa. You reply to property buyers' and tenants' enquiries.
Style: text like a warm, professional estate agent on WhatsApp. Short friendly messages, usually one or two lines, one question at a time. Relaxed punctuation is fine, lowercase starts are ok but always capitalise names (people, agency, places). NEVER use colons, dashes or hyphens as punctuation, em dashes, bullet points, numbered lists, bold or any formal structure. Write times like 10am or 2pm. Keep a polite professional tone that still feels human and personal. Do not use slang, including South African slang such as lekker, shap, howzit, eish, sharp, sharp sharp, ja, awesome sauce, yebo or boet. Warm and natural is good, slang is not. Use Rands. Never use the words "AI", "bot", "artificial", "language model". If asked whether you are a robot, a person or anything similar, never deny it and never say "not at all": simply say you're the digital assistant for ${A.name} that runs 24/7, and ${A.agentName} (the agent) will be in touch personally.
When qualified becomes true, your reply must ONLY thank them briefly (e.g. "great thanks, thats everything i need", all lowercase and friendly). Never say that again later in the chat. Do NOT ask about days, times, weekdays or weekends; the system sends the viewing slots straight after your message.
Listings (only these exist; never invent others or details): ${JSON.stringify(A.listings)}
${strict ? buyerGoal(listing, c) : rentalPrompt(c)}
Current known lead info: ${JSON.stringify(c.lead)}
Still missing (ask for the next one in this order, unless their latest message answers it): ${missing.join(', ') || 'nothing'}. Only say you have everything when nothing is missing after this message.
Stage: ${c.stage}. ${c.stage==='offer'||c.stage==='booking' ? `Offered slots: ${JSON.stringify(c.offered)} (shown to the person as ${c.offered ? c.offered.map(nice).join(', ') : ''}). If they pick one, set chosenSlot to the exact slot string.` : ''}
Return ONLY JSON: {"reply": string, "lead": ${strict ? '{"name","listing","listingRef","budget","finance","timeline","homeToSell","buyingAs","sourceOfFunds","saleStatus","proofOfFunds"} (fill what you know, null otherwise; listingRef is the ref like SR-101; buyingAs and sourceOfFunds are required for every buyer, saleStatus only when funds come from selling their own property)' : '{"name","listing","listingRef","budget","income","occupants","pets","timeline"} (fill what you know, null otherwise; listingRef is the ref like SR-105; leave finance, homeToSell, buyingAs, sourceOfFunds and proofOfFunds unset)'}, "qualified": boolean (true when nothing is missing), "declined": boolean (for buyer qualification, see above), "chosenSlot": string|null}`;
}

function buyerGoal(listing, c) {
  return `Your goal: answer their question briefly, then qualify by collecting: listing of interest, budget, finance (bond pre-approved / applying / cash), timeline to buy, whether they have a home to sell first, and their first name (ask casually, like "thanks, and whats your name?"). Then the system will offer viewing slots.
${buyerPrompt(listing, c)}`;
}

function rentalPrompt(c) {
  const listing = matchedListing(c);
  const about = listing ? `The tenant is asking about ${listing.title} at ${listing.price}. ` : '';
  return `RENTAL QUALIFICATION. ${about}This is a rental enquiry, not a sale. Never ask about cash or bond, source of funds, proof of funds, buying in a personal name, company or trust, or whether they need to sell a home first. Those questions are for buyers only. Your first reply confirms the listing is available with one standout detail (or if they haven't named a listing yet, help them pick one), then asks the first missing item. Ask one thing at a time, in this order.
budget: their monthly rental budget, in Rands (skip it if they already said the amount).
income: ask naturally, like "and what is your monthly income, roughly?"
occupants: how many people will be living there.
pets: whether they have any pets.
timeline: when they would like to move in.
name: their first name (ask casually, like "thanks, and whats your name?").
Then the system will offer viewing slots.`;
}

function buyerPrompt(listing, c) {
  const about = listing ? `The buyer is asking about ${listing.title} at ${listing.price}. ` : '';
  const l = c.lead;
  const proofHint = fromSale(l)
    ? `This buyer is paying from the sale of their own property. Do NOT ask for proof of funds or bank statements. The system has noted it.`
    : isBond(l)
      ? `This is a bond buyer. Their bond pre approval letter IS the proof, never ask for bank statements. If they have a pre approval, ask once if they'd like to send the letter here, it's optional ("if you have the pre approval letter handy you can send it here, otherwise ${A.agentName} can get it later"). If they don't have pre approval yet, offer that ${A.agentName} can help them get pre approved through a bond originator, set proofOfFunds to "pre approval pending, agent to help" and move on.`
      : `For cash from savings, investments, an inheritance or a business, ask once, phrased as optional, like "if you have a bank letter or recent statement handy you can send it here, otherwise ${A.agentName} can get it from you later". Never insist and never ask again.`;
  return `BUYER QUALIFICATION. ${about}You qualify like an experienced, smart senior agent who knows the process, warm and respectful but thorough. This replaces the normal qualifying list above. Never pushy, never rude, never accusing. Your first reply confirms the listing is available with one standout detail (or if they haven't named a listing yet, help them pick one), then asks the first missing item. Ask one thing at a time, in this order.
finance: cash or bond. If bond, ask the bank and whether they already have a bond pre approval. Cash that will come from selling their own property counts as cash, that is completely normal.
budget: the amount they have available or approved, in Rands (skip it if they already said the amount).
buyingAs: buying in their personal name, a company or a trust.
sourceOfFunds: where the funds come from (salary, savings, business, sale of their own property, investments, inheritance etc). Frame it politely as a FICA requirement every agency has to ask, nothing personal. Skip it if they already told you. If the money comes from selling their current or previous property (any wording, like "sale of my house", "once my place sells", "proceeds from my property", "when we sell our flat"), set sourceOfFunds to "sale of own property", accept it warmly and never ask them to prove it now. If they mention physical cash, a briefcase or cash they want to bring, explain kindly that by law we can't accept cash, the funds need to sit in a South African bank account and come through the bank.
saleStatus: only when the funds come from selling their own property or they need to sell first. Ask naturally whether their place is already sold, under offer or still on the market. Set saleStatus to exactly one of "sold", "under offer", "on the market", "not listed yet". When they answer, reply warmly along the lines of "no problem, once your sale goes through ${A.agentName} will just need the sale agreement or a letter from the conveyancer" (if it's already sold say ${A.agentName} will just need the sale agreement or a conveyancer letter, they can send it whenever it suits them) and then ask the next missing item in the same message.
timeline: when they want to buy. homeToSell: whether they need to sell first (skip it if you already know, for example from saleStatus).
name: their full name exactly as on their ID, and mention that ${A.agentName} will need their ID and proof of address for FICA before any offer.
proofOfFunds: optional, never a condition for the viewing. ${proofHint} Set proofOfFunds to "received" ONLY when they say they have sent or attached it now (e.g. "sent", "just sent it", "attached", "here you go") or the message says they attached a document, "promised" if they say they will send it, and "later" if they say no, not now, they'd rather not, or push back in any way. Leave it null until they've answered the proof question.
Never repeat the same question more than once. If the buyer pushes back or gives a reasonable answer to anything, accept it graciously and move on to the next missing item. Never insist, never loop, never lecture.
Never say you have everything you need, and never offer or discuss viewing times, while anything is still missing.
Set declined true ONLY when the buyer clearly refuses to say where the funds come from at all (FICA requires it). Then your reply must politely say you understand, but you can't book a viewing without it, that the door stays open, and offer to keep them posted on other listings. Never set declined because of proof of funds.
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
  const ready = /pre-?approv|cash/.test(f) || !!l.income;
  const soon = /now|asap|immediate|week|month|1|2|3/.test(t) && !/year|12|6 month/.test(t);
  const chain = /yes|true|need to sell/.test(sell) && !/sold|no\b/.test(sell);
  if (ready && soon && !chain) return 'Hot';
  if (ready || soon) return 'Warm';
  return 'Cold';
}

function verified(l) { return l.proofOfFunds === 'received' && !!l.sourceOfFunds; }
function proofLine(c) {
  const l = c.lead, p = String(l.proofOfFunds || '');
  if (p === 'received') return 'received' + (c.docs && c.docs.length ? ' (' + c.docs.join(', ') + ')' : '') + ', agent to check';
  if (fromSale(l)) return l.saleStatus === 'sold' ? 'to follow, sale agreement or conveyancer letter' : 'after own sale, sale agreement or conveyancer letter';
  if (p === 'promised') return 'promised, not received';
  if (/pre ?-?approv/i.test(p)) return 'bond pre-approval pending, agent to help';
  if (p === 'later') return isBond(l) ? 'pre-approval letter to follow, agent to collect' : 'not sent yet, agent to collect later';
  return p || 'not provided';
}
function summary(c, from) {
  const l = c.lead, listing = listingOf(c);
  if (strictBuyer(c)) {
    const v = verified(l);
    const listed = listing ? `${listing.title} (${listing.price})` : (l.listing || '-');
    const head = v ? 'Verified buyer, Hot' : c.stage === 'declined' ? 'Not verified, do not book' : 'Qualified buyer, proof to follow';
    const sale = needsSaleStatus(l) ? `\nOwn property: ${l.saleStatus || 'status not given'}${subjectToSale(l) ? ', SUBJECT TO SALE OF OWN PROPERTY' : ''}` : '';
    return `*${head}* (${A.name})\nName as on ID: ${l.name || '-'}\nWhatsApp: +${from}\nListing: ${listed}\nBuying as: ${l.buyingAs || '-'}\nFunds: ${l.finance || '-'}\nAmount confirmed: ${l.budget || '-'}\nSource of funds: ${l.sourceOfFunds || 'not given'}${sale}\nProof of funds: ${proofLine(c)}\nFICA (ID, proof of address): requested\nTimeline: ${l.timeline || '-'}\nHome to sell: ${l.homeToSell === false ? 'no' : l.homeToSell === true ? 'yes' : (l.homeToSell ?? '-')}\nViewing: ${c.booked || 'not booked'}\nFirst contact: ${c.started}`;
  }
  return `*New rental lead – ${score(l)}* (${A.name})\nName: ${l.name || '-'}\nWhatsApp: +${from}\nListing: ${l.listing || '-'}\nBudget: ${l.budget || '-'}\nMonthly income: ${l.income || '-'}\nOccupants: ${l.occupants || '-'}\nPets: ${l.pets || '-'}\nMove in: ${l.timeline || '-'}\nViewing: ${c.booked || 'not booked'}\nFirst contact: ${c.started}`;
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
  const strict0 = strictBuyer(c);
  const asking = strict0 && c.stage === 'qualify' && c.history.some(h => h.r === 'bot') ? need(c, true)[0] : null;
  if (strict0 && c.stage === 'qualify' && SALE_WORDS.test(text) && OWN_PROP.test(text) && !/\?\s*$/.test(text) && !c.lead.sourceOfFunds && need(c, true)[0] !== 'listing') c.lead.sourceOfFunds = 'sale of own property';
  let g = await gemini(c, text);
  if (c.stage === 'done') { out.push(clean(g.reply)); }
  else {
    const strict = strictBuyer(c);
    const prevPof = c.lead.proofOfFunds;
    const applyLead = gl => { for (const [k, v] of Object.entries(gl || {})) if (v !== null && v !== '' && v !== 'null' && (strict || !SALE_ONLY.has(k))) c.lead[k] = v; };
    applyLead(g.lead);
    if (strict) {
      if (c.lead.saleStatus) c.lead.saleStatus = normSaleStatus(c.lead.saleStatus);
      if (fromSale(c.lead) && (c.lead.homeToSell == null || c.lead.homeToSell === '')) c.lead.homeToSell = c.lead.saleStatus === 'sold' ? 'no, already sold' : 'yes, funds come from that sale';
      if (fromSale(c.lead) && c.lead.saleStatus && c.lead.proofOfFunds !== 'received') c.lead.proofOfFunds = c.lead.saleStatus === 'sold' ? 'sale agreement to follow' : 'after own sale';
      if (/^(refused|declined|no|none)$/i.test(String(c.lead.proofOfFunds || ''))) c.lead.proofOfFunds = 'later';
      // never ask the same thing more than twice: count unanswered turns per field, then accept and move on
      c.asks = c.asks || {};
      if (asking && asking !== 'listing' && need(c, true)[0] === asking && !g.declined) {
        c.asks[asking] = (c.asks[asking] || 0) + 1;
        if (c.asks[asking] >= 2 && asking !== 'sourceOfFunds') {
          c.lead[asking] = asking === 'proofOfFunds' ? 'later' : 'not given';
          if (need(c, true).length) { const g2 = await gemini(c, `${text}\n[note for the assistant, not from the buyer: they did not answer that, accept it and move on to the next missing item without repeating the question]`); if (g2 && g2.reply) { g = { ...g2, declined: false }; applyLead(g2.lead); } }
        }
      }
    }
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
    } else if (strict && c.stage === 'qualify' && g.declined && !c.lead.sourceOfFunds) {
      out.push(clean(g.reply));
      if (c.stage !== 'declined') { c.stage = 'declined'; agentSummary = summary(c, from); }
    } else if ((c.stage === 'qualify' || c.stage === 'declined') && need(c, strict).length === 0) {
      c.offered = A.viewingSlots.slice(0, 3); c.stage = 'offer';
      const first = /not given/.test(c.lead.name) ? '' : ' ' + String(c.lead.name).split(' ')[0];
      const p = c.lead.proofOfFunds;
      const lead = !strict ? `great thanks, thats everything i need`
        : p === 'received' ? `perfect thanks${first}, got it and passed it to ${A.agentName} to check. you're all set for a private viewing`
        : p === 'later' ? `no problem at all, ${A.agentName} can get that from you later. thanks${first}, thats everything i need`
        : /pre ?-?approv/i.test(p || '') ? `no problem, ${A.agentName} can help you get pre approved through a bond originator. thanks${first}, thats everything i need`
        : p === 'promised' ? `perfect thanks${first}, just send it here whenever it suits you. thats everything i need for now`
        : `perfect thanks${first}, thats everything i need`;
      out.push(clean(lead));
      out.push(`i've got ${nice(c.offered[0])}, ${nice(c.offered[1])} or ${nice(c.offered[2])} for a viewing, which one suits you?`);
    } else {
      const m = c.stage === 'offer' && !depth && /^\s*([123])\s*$/.exec(text);
      if (m) return handle(env, from, c.offered[m[1] - 1], 1, opts);
      let rep = g.reply;
      if (strict && c.stage !== 'offer' && need(c, true).length && /everything i need|all set|you'?re booked/i.test(rep))
        rep = rep.replace(/[^.?]*(everything i need|all set|you'?re booked)[^.?]*[.?]?/i, '').trim() || `thanks`;
      if (!strict && SALE_LEAK.test(rep || '')) rep = rentalAsk(need(c, false)[0]);
      out.push(clean(rep));
    }
  }
  c.history.push({ r: 'user', t: text }, ...out.map(t => ({ r: 'bot', t })));
  c.history = c.history.slice(-30);
  await env.STATE.put(key, JSON.stringify(c), { expirationTtl: opts.ttl || 60 * 60 * 24 * 30 });
  return { replies: out, agentSummary, stage: c.stage, lead: c.lead };
}
export { handle, summary, score, CFG, clean };
