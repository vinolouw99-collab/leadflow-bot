# LeadFlow WhatsApp lead-reply bot

Node 18+ with no dependencies. Files:
- `server.js`: the webhook. `GET /webhook` handles Meta verification and `POST /webhook` replies via the Graph API.
- `bot.js`: the core logic. It keeps per-sender state in `state.json`, uses Gemini for qualifying, offers 3 slots, confirms the booking, and writes a Hot/Warm/Cold agent summary.
- `config.json`: the agency profile (name, agent, listings, viewing slots) and the Gemini model fallback list.
- `simulate.js`: the terminal simulator. Run `node simulate.js` to chat, or `node simulate.js test-script.txt` to write `test-transcript.md`.

## Env vars
| Var | Purpose |
|---|---|
| GEMINI_API_KEY | Free Google AI Studio key |
| WHATSAPP_TOKEN | Meta access token. Without it, replies are only logged, never sent |
| VERIFY_TOKEN | Any secret string you choose; enter the same one in Meta |
| PHONE_NUMBER_ID | Defaults to 1423131840883763 (test number) |
| AGENT_WHATSAPP | Optional number (e.g. 27679809892) that receives lead summaries |
| GEMINI_MODEL | Optional model override |

## Deploy on Render (free)
1. Push this folder to a GitHub repo (or Cursor Origin).
2. On render.com, go to New, then Web Service, and connect the repo. Use Runtime **Node**, Build `npm install`, Start `npm start`, and instance type **Free**.
3. Add the env vars above.
4. Once it's deployed, copy the URL, e.g. `https://leadflow-bot.onrender.com`.
5. In Meta developers, open LeadFlow Demo, then WhatsApp, then Configuration, then Webhook. Set the Callback URL to `https://<render-url>/webhook` and the Verify token to your VERIFY_TOKEN. Click Verify and save, then subscribe to the **messages** field.
6. Generate an access token (the temporary one lasts 24h, or use a System User token for a permanent one) and set WHATSAPP_TOKEN.
7. Message the test number +1 555 613 0323 from the verified recipient WhatsApp.

Notes: the free Render tier sleeps after 15 minutes idle, so the first message can take about 30–50s. Meta allows that, but it's worth pinging it before demos. The free tier's disk is wiped on redeploy, so `state.json` resets. That's fine for the demo; use a free DB later.
