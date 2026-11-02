#!/bin/bash
while true; do /workspace/leadflow/cloudflared tunnel --no-autoupdate --protocol http2 --url http://localhost:3000 >> /workspace/leadflow/bot/tunnel.log 2>&1; sleep 3; done
