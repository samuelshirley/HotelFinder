#!/usr/bin/env bash
# Copy the CI and preview secrets from .env into the GitHub repo's Actions
# secrets (docs/deploy.md, "One-time setup"). Values go straight from .env into
# `gh secret set` on stdin: never printed, never passed as an argument.
# Safe to re-run: each run overwrites. A key missing from .env is skipped and named.
#
#   NEON_API_KEY     Neon API key (console.neon.tech → Organization settings → API keys)
#   NEON_PROJECT_ID  defaults to the hotel-finder project when .env has none
#   LITE_API_KEY     must be the SANDBOX key (sand_…): previews and CI never get a live one
#   VERCEL_TOKEN     vercel.com/account/settings/tokens (account settings, not the project's)
set -euo pipefail
cd "$(dirname "$0")/.."

REPO=samuelshirley/HotelFinder
DEFAULT_NEON_PROJECT_ID=patient-lab-40374810

envval() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true; }
put() { printf '%s' "$2" | gh secret set "$1" -R "$REPO" >/dev/null && echo "set $1"; }

gh auth status >/dev/null 2>&1 || { echo "gh is not signed in: run 'gh auth login' first" >&2; exit 1; }

missing=()
for k in NEON_API_KEY LITE_API_KEY VERCEL_TOKEN; do
  v="$(envval "$k")"
  if [ -z "$v" ]; then missing+=("$k"); continue; fi
  if [ "$k" = LITE_API_KEY ] && [[ "$v" != sand_* ]]; then
    echo "LITE_API_KEY in .env is not a sandbox key (sand_…): not copied" >&2; missing+=("$k"); continue
  fi
  put "$k" "$v"
done
pid="$(envval NEON_PROJECT_ID)"
put NEON_PROJECT_ID "${pid:-$DEFAULT_NEON_PROJECT_ID}"

if [ ${#missing[@]} -gt 0 ]; then
  echo "not set (add to .env and re-run): ${missing[*]}" >&2
  exit 1
fi
echo "All preview and CI secrets are set. Re-run a PR's checks to use them."
