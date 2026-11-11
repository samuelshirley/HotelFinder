#!/usr/bin/env bash
# Run the agent and the intent scan against the real Anthropic API and print
# what the run cost. Reads ANTHROPIC_API_KEY from .env.
# Usage: scripts/agent-live.sh            (the default model)
#        scripts/agent-live.sh claude-haiku-5-5
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
if [ "${1:-}" != "" ]; then export AGENT_MODEL="$1"; fi
LIVE_ANTHROPIC=1 ./node_modules/.bin/vitest run src/server/agent/live.test.ts
