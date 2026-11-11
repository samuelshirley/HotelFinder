#!/usr/bin/env bash
# Run the app locally. No database to set up: with DATABASE_URL unset it uses
# an embedded Postgres stored in .data/. Keys come from .env.
set -euo pipefail
cd "$(dirname "$0")/.."
# node_modules may have been installed from another OS (the build ran in a
# Linux VM on this folder). Reinstall when the native binaries do not match.
if ! node -e "require('@next/swc-$(node -p "process.platform + '-' + process.arch")')" >/dev/null 2>&1; then
  echo "Installing dependencies for $(node -p "process.platform + '-' + process.arch")…"
  rm -rf node_modules
  npm install --no-audit --no-fund
fi
# A build directory left by another machine or an interrupted run serves a
# blank "missing required error components" page. Start from a clean one.
rm -rf .next
exec npm run dev
