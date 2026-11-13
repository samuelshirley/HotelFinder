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
trap 'echo "setup-hosting.sh FAILED at line $LINENO: $BASH_COMMAND" >&2' ERR
cd "$(dirname "$0")/.."

TEAM=samuelshirleys-projects
PROJECT=hotel-finder
REPO=https://github.com/samuelshirley/HotelFinder
# Same region as Feral Travels' Neon and Vercel's default function region (iad1).
REGION=aws-us-east-1
VERCEL="npx -y vercel@latest"
NEON="npx -y neonctl@latest"

envval() { grep -E "^$1=" "$2" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true; }

# --- Neon ---------------------------------------------------------------
# Neon CLI is only needed to create the project; with .env.neon already set, skip it.
if [ -z "$(envval DATABASE_URL .env.neon)" ]; then
  $NEON me >/dev/null 2>&1 || $NEON auth
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

# A generated secret is kept in .env.neon so a re-run does not rotate it
# (which would sign every user out).
AUTH_SECRET="$(envval AUTH_SECRET .env)"
[ -n "$AUTH_SECRET" ] || AUTH_SECRET="$(envval AUTH_SECRET .env.neon)"
if [ -z "$AUTH_SECRET" ]; then
  AUTH_SECRET="$(openssl rand -base64 32)"
  printf 'AUTH_SECRET=%s\n' "$AUTH_SECRET" >> .env.neon
fi

put() { # name value [target…] — default production and preview; sensitive, overwriting
  [ -n "$2" ] || { echo "skip $1 (empty)"; return; }
  local name="$1" value="$2"
  shift 2
  local targets="${*:-production preview}"
  for t in $targets; do
    printf '%s' "$value" | $VERCEL env add "$name" "$t" --sensitive --force --scope "$TEAM" >/dev/null
  done
  echo "set $name"
}
# PRODUCTION ONLY, both. A preview gets its own Neon branch and a per-run
# secret from .github/workflows/preview.yml; production's database and
# signing secret must never sit behind a preview URL running unreviewed code
# (docs/deploy.md). src/lib/previewGuard.test.ts holds these two lines.
put DATABASE_URL "$DATABASE_URL" production
put AUTH_SECRET "$AUTH_SECRET" production
# /hotels/admin: who may open it (comma-separated). Read from .env, or asked once and saved there.
ADMIN_EMAILS="$(envval ADMIN_EMAILS .env)"
if [ -z "$ADMIN_EMAILS" ]; then
  read -r -p "Email(s) allowed to open /hotels/admin: " ADMIN_EMAILS
  printf 'ADMIN_EMAILS=%s\n' "$ADMIN_EMAILS" >> .env
fi
put ADMIN_EMAILS "$ADMIN_EMAILS"
for k in JEV_API_KEY LITE_API_KEY ANTHROPIC_API_KEY ANTHROPIC_ADMIN_KEY RESEND_API_KEY; do
  put "$k" "$(envval "$k" .env)"
done

echo
echo "Done. Vercel project: https://vercel.com/$TEAM/$PROJECT"
echo "It deploys on the next push to main."
