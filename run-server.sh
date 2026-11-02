#!/bin/bash
cd /workspace/leadflow/bot
while true; do node server.js >> bot.log 2>&1; echo "restart $(date)" >> bot.log; sleep 2; done
