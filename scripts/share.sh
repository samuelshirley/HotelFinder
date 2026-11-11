#!/usr/bin/env bash
# Run the app in ONE place (this Mac) and give it ONE public https URL through
# an ngrok tunnel, so it opens from a phone or another computer.
#
# The URL stays the same across runs when NGROK_DOMAIN is in .env (ngrok gives
# every account one free static domain: dashboard.ngrok.com/domains). Without
# it ngrok hands out a new random URL each run.
#
# If the app is already running on port 3000 it is reused, not started twice.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=3000

if ! command -v ngrok >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Installing ngrok…"
    brew install ngrok
  else
    echo "ngrok is not installed and Homebrew is missing. Install ngrok from https://ngrok.com/download, then run this again." >&2
    exit 1
  fi
fi
if ! ngrok config check >/dev/null 2>&1; then
  echo "ngrok needs your account token once. Copy it from https://dashboard.ngrok.com/get-started/your-authtoken"
  read -r -s -p "Paste the token (it is not shown): " token; echo
  ngrok config add-authtoken "$token" >/dev/null
fi

# Only this one line is read from .env; the rest of the file is the app's business.
DOMAIN="$(grep -E '^NGROK_DOMAIN=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"

APP_PID=""
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Using the app already running on port $PORT."
else
  scripts/dev.sh &
  APP_PID=$!
  trap '[ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null || true' EXIT
  until curl -s -o /dev/null "http://localhost:$PORT"; do sleep 1; done
fi

if [ -n "$DOMAIN" ]; then
  echo "Public URL: https://$DOMAIN"
  ngrok http "$PORT" --url="$DOMAIN"
else
  echo "No NGROK_DOMAIN in .env: ngrok will show a new random URL below."
  ngrok http "$PORT"
fi
