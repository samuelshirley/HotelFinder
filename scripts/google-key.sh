#!/usr/bin/env bash
# Borrow Feral Travels' Google Maps key for the sights lookup (docs/sights.md).
# Reads NEXT_PUBLIC_GOOGLE_MAPS_API_KEY from ../FeralTravels/.env and stores it
# here as GOOGLE_MAPS_API_KEY (server-only: never NEXT_PUBLIC_ in this repo):
#   - in .env, replacing any earlier line;
#   - in Vercel, production and preview, as a sensitive variable.
# The value goes file → file and file → stdin: never printed, never an argument.
# Safe to re-run: each run overwrites.
#
#   scripts/google-key.sh            both
#   scripts/google-key.sh --local    .env only
set -euo pipefail
trap 'echo "google-key.sh FAILED at line $LINENO" >&2' ERR
cd "$(dirname "$0")/.."

SOURCE="${FERAL_ENV:-../FeralTravels/.env}"
FROM=NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
TO=GOOGLE_MAPS_API_KEY
TEAM=samuelshirleys-projects
VERCEL="npx -y vercel@latest"

envval() { grep -E "^$1=" "$2" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true; }

[ -f "$SOURCE" ] || { echo "no $SOURCE: set FERAL_ENV to Feral Travels' .env" >&2; exit 1; }
value="$(envval "$FROM" "$SOURCE")"
[ -n "$value" ] || { echo "$FROM is not set in $SOURCE" >&2; exit 1; }

touch .env
tmp="$(mktemp)"
grep -vE "^$TO=" .env > "$tmp" || true
printf '%s=%s\n' "$TO" "$value" >> "$tmp"
cat "$tmp" > .env   # keeps .env's own permissions
rm -f "$tmp"
echo "set $TO in .env"

if [ "${1:-}" = "--local" ]; then exit 0; fi

$VERCEL whoami >/dev/null 2>&1 || { echo "Vercel CLI is not signed in: run 'npx vercel login', then re-run" >&2; exit 1; }
for target in production preview; do
  printf '%s' "$value" | $VERCEL env add "$TO" "$target" --sensitive --force --scope "$TEAM" >/dev/null
done
echo "set $TO in Vercel (production, preview)"
