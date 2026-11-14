#!/usr/bin/env bash
# Ask the real Jev the router's questions for 87 typical messages (21 in Spanish) and
# print what it answered. Reads JEV_API_KEY from .env. Costs a fraction of a cent.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
LIVE_JEV=1 JEV_TIMEOUT_MS=5000 ./node_modules/.bin/vitest run src/server/jev/live.test.ts
