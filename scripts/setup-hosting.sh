#!/usr/bin/env bash
# One-time hosting setup: a Neon database and a Vercel project for this repo,
# with the server env vars copied from .env. Safe to re-run: every step checks
# what already exists first.
#
# Secrets never pass through a chat: values are read from .env here and piped
# straight into the Vercel CLI. The Neon connection string is kept in
# .env.neon (gitignored by `.env.*`), NOT in .env — dev.sh must keep using the
# embedded Postgres, or local runs would write to the hosted database.
#
# Both CLIs open a browser to sign in the first time.
set -euo pipefail
cd "$(dirname "$0")/.."

TEAM=samuelshirleys-projects
PROJECT=hotel-finder
REPO=https://github.com/samuelshirley/HotelFinder
# Same region as Feral Travels' Neon and Vercel's default function region (iad1).
REGION=aws-us-east-1
VERCEL="npx -y vercel@latest"
NEON="npx -y neonctl@latest"

envval() { grep -E "^$1=" "$2" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }

# --- Neon ---------------------------------------------------------------
$NEON me >/dev/null 2>&1 || $NEON auth
if [ -z "$(envval DATABASE_URL .env.neon)" ]; then
  id="$($NEON projects list --output json | node -e '
    const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
    const p=(d.projects||d).find(p=>p.name===process.argv[1]); process.stdout.write(p?p.id:"")' "$PROJECT")"
  if [ -z "$id" ]; then
    echo "Creating Neon project $PROJECT in $REGION…"
    id="$($NEON projects create --name "$PROJECT" --region-id "$REGION" --output json | node -e '
      const d=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(d.project.id)')"
  fi
  url="$($NEON connection-string --project-id "$id" --pooled)"
  printf 'DATABASE_URL=%s\n' "$url" > .env.neon
  chmod 600 .env.neon
  echo "Neon project $id: connection string saved to .env.neon"
fi
DATABASE_URL="$(envval DATABASE_URL .env.neon)"

echo "Applying migrations to Neon…"
DATABASE_URL="$DATABASE_URL" npx drizzle-kit migrate

# --- Vercel -------------------------------------------------------------
$VERCEL whoami >/dev/null 2>&1 || $VERCEL login
$VERCEL project ls --scope "$TEAM" 2>/dev/null | grep -qw "$PROJECT" \
  || $VERCEL project add "$PROJECT" --scope "$TEAM"
$VERCEL link --yes --scope "$TEAM" --project "$PROJECT"
$VERCEL git connect "$REPO" --yes --scope "$TEAM" || true   # already connected → non-zero; fine

AUTH_SECRET="$(envval AUTH_SECRET .env)"
[ -n "$AUTH_SECRET" ] || AUTH_SECRET="$(openssl rand -base64 32)"

put() { # name value — production and preview, sensitive, overwriting
  [ -n "$2" ] || { echo "skip $1 (empty)"; return; }
  for target in production preview; do
    printf '%s' "$2" | $VERCEL env add "$1" "$target" --sensitive --force --scope "$TEAM" >/dev/null
  done
  echo "set $1"
}
put DATABASE_URL "$DATABASE_URL"
put AUTH_SECRET "$AUTH_SECRET"
for k in JEV_API_KEY LITE_API_KEY ANTHROPIC_API_KEY RESEND_API_KEY NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; do
  put "$k" "$(envval "$k" .env)"
done

echo
echo "Done. Vercel project: https://vercel.com/$TEAM/$PROJECT"
echo "It deploys on the next push to main."
