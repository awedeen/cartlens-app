#!/bin/bash
# CartLens persistent server + ngrok tunnel
# Starts the Remix app and ngrok tunnel with static domain

cd /Users/knoxai/.openclaw/workspace/projects/shopify-apps/cartlens-app

# Start the app (production build)
export NODE_ENV=production
npx remix-serve build/server/index.js &
APP_PID=$!

# Wait for app to start
sleep 3

# Start ngrok with static domain
ngrok http 3000 --url glossier-dorene-nonbearded.ngrok-free.dev --log /tmp/cartlens-ngrok.log &
NGROK_PID=$!

# Trap to clean up both
trap "kill $APP_PID $NGROK_PID 2>/dev/null" EXIT
wait
