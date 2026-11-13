#!/usr/bin/env bash
# Deletes one PR's preview deployments from the Vercel project.
#
#   scripts/delete-pr-previews.sh <pr-number> [url-to-keep]
#
# Run by .github/workflows/preview.yml after each deploy (keeping the one it
# just made: older ones point at a Neon branch that push deleted) and by
# preview-cleanup.yml when the PR closes (keeping none). Needs VERCEL_TOKEN,
# VERCEL_ORG_ID and VERCEL_PROJECT_ID in the environment.
#
# A deployment is deleted only when ALL of these hold:
#   - its target is not "production" (production deployments carry
#     "production"; previews carry null) — the hard guard;
#   - its meta.previewPr equals this PR number, which only preview.yml sets
#     (`vercel deploy --meta previewPr=<N>`), so nothing deployed another way
#     is ever touched;
#   - its URL is not the one to keep.
#
# Best effort, like Feral Travels' sweep: every failure is a ::warning:: and
# the exit status is 0, so a Vercel hiccup never turns a PR red. The REST API
# with curl, not `vercel api` (beta, and it refuses DELETE non-interactively).
set -uo pipefail

PR="${1:-}"
KEEP="${2:-}"
KEEP="${KEEP#https://}"
KEEP="${KEEP%%/*}"
API=https://api.vercel.com

if ! [[ "$PR" =~ ^[1-9][0-9]*$ ]]; then
  echo "::warning::delete-pr-previews: '$PR' is not a PR number; nothing deleted."
  exit 0
fi
for v in VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID; do
  if [ -z "${!v:-}" ]; then
    echo "::warning::delete-pr-previews: $v is not set; nothing deleted."
    exit 0
  fi
done
if ! BODY="$(mktemp)" || ! CANDIDATES="$(mktemp)"; then
  echo "::warning::delete-pr-previews: could not create temp files; nothing deleted."
  exit 0
fi

SELECT='.deployments[]
  | select(.target != "production")
  | select((.uid | type) == "string" and (.uid | test("^dpl_[A-Za-z0-9]+$")))
  | select((.meta.previewPr // "" | tostring) == $pr)
  | select(.url != $keep)
  | "\(.uid) \(.url)"'

# Collect first, delete after: deleting mid-listing would shift the pages
# under the `until` cursor.
LISTED=0
UNTIL=""
while :; do
  CODE="$(curl -sS -o "$BODY" -w '%{http_code}' -H "Authorization: Bearer $VERCEL_TOKEN" \
    "$API/v6/deployments?projectId=$VERCEL_PROJECT_ID&teamId=$VERCEL_ORG_ID&limit=100${UNTIL:+&until=$UNTIL}")" || CODE="${CODE:-000}"
  if [ "$CODE" != 200 ] || ! jq -e '.deployments | type == "array"' "$BODY" >/dev/null 2>&1; then
    echo "::warning::Listing Vercel deployments failed (HTTP $CODE) after $LISTED; only those are swept. $(head -c 300 "$BODY")"
    break
  fi
  LISTED=$((LISTED + $(jq '.deployments | length' "$BODY")))
  jq -r --arg pr "$PR" --arg keep "$KEEP" "$SELECT" "$BODY" >> "$CANDIDATES"
  UNTIL="$(jq -r '.pagination.next // empty' "$BODY")"
  [ -n "$UNTIL" ] || break
done

DELETED=0
FAILED=0
while read -r DPL URL; do
  [ -n "$DPL" ] || continue
  CODE="$(curl -sS -o "$BODY" -w '%{http_code}' -X DELETE -H "Authorization: Bearer $VERCEL_TOKEN" \
    "$API/v13/deployments/$DPL?teamId=$VERCEL_ORG_ID")" || CODE="${CODE:-000}"
  if [ "$CODE" = 200 ]; then
    DELETED=$((DELETED + 1))
    echo "Deleted https://$URL ($DPL)"
  else
    FAILED=$((FAILED + 1))
    echo "::warning::Could not delete https://$URL ($DPL): HTTP $CODE $(head -c 300 "$BODY")"
  fi
done < "$CANDIDATES"

echo "PR #$PR previews: listed $LISTED deployments, deleted $DELETED, failed $FAILED${KEEP:+, kept $KEEP}."
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "Vercel previews of PR #$PR: deleted $DELETED, failed $FAILED${KEEP:+, kept $KEEP}." >> "$GITHUB_STEP_SUMMARY"
fi
exit 0
