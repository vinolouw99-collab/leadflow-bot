#!/bin/bash
# Usage: put CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID) in /workspace/leadflow/cf.env, then ./deploy.sh
set -euo pipefail; cd "$(dirname "$0")"
set -a; . ../cf.env; set +a
export CLOUDFLARE_API_TOKEN=$(printf %s "$CLOUDFLARE_API_TOKEN" | tr -d '\r\n ')
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && export CLOUDFLARE_ACCOUNT_ID=$(printf %s "$CLOUDFLARE_ACCOUNT_ID" | tr -d '\r\n ')
g(){ grep "^$1=" ../bot/.env | tail -1 | cut -d= -f2- | tr -d '\r'; }
if grep -q REPLACE_KV_ID wrangler.toml; then
  ID=$(npx wrangler kv namespace list 2>/dev/null | python3 -c "import sys,json;print(next((n['id'] for n in json.load(sys.stdin) if n['title'].endswith('STATE') or n['title']=='leadflow-state'),''))" || true)
  [ -z "$ID" ] && ID=$(npx wrangler kv namespace create leadflow-state 2>&1 | grep -oE '[0-9a-f]{32}' | head -1)
  [ -z "$ID" ] && { echo "KV create failed"; exit 1; }
  sed -i "s/REPLACE_KV_ID/$ID/" wrangler.toml; echo "KV namespace ready"
fi
npx wrangler deploy 2>&1 | grep -vi token
for k in WHATSAPP_TOKEN VERIFY_TOKEN; do g $k | npx wrangler secret put $k >/dev/null && echo "secret $k set"; done
printf %s "$GEMINI_API_KEY" | npx wrangler secret put GEMINI_API_KEY >/dev/null && echo "secret GEMINI_API_KEY set"
echo "Webhook: https://leadflow-bot.<your-subdomain>.workers.dev/webhook (see deploy output above)"
