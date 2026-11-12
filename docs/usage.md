# Usage ledger and cost per search

Every paid or metered external call writes one `usage_events` row, failures
included. `/admin` (gated by `ADMIN_EMAILS`) reads it to answer one question:
what does one search really cost?

## What is metered, and where

| Provider | Calls | Ledger writer | Price source |
|---|---|---|---|
| `anthropic` | agent, intent scan, priorities, near | `server/modelLedger.ts` | `lib/models.ts` (per token) |
| `jev` | router, every chat message | `server/turn.ts` | `jevCostMicrocents` in `server/jev/index.ts` |
| `liteapi:<op>` | places, place, search, facts, content, prebook, book, booking, cancel | `server/supplier/index.ts` (adapter meter) | `lib/supplierPrices.ts` |
| `resend:email` | sign-in codes | `server/auth/mailer.ts` | unpriced (plan, not per message) |
| `app` | UI analytics events, not calls | `api/events` | — excluded from every cost view |

`meterGuard.test.ts` makes this table structural: only these four server files
may call out (`fetch`, an injected `fetch`, or the Anthropic client), each has
a `logUsage` writer, the browser only fetches our own API through `withBase`,
and every supplier op the adapter uses has a price entry (also a type error
via `Record<SupplierOp, OpPrice>`). Mutation-checked 2026-11-12: an unmetered
server fetch, an injected-fetch default, the mailer's meter removed, a browser
fetch to another host, and an unpriced new op each fail it.

## LiteAPI prices (read 2026-11-12)

From docs.liteapi.travel/reference/api-pricing-usage-costs: place search and
location lookup **$0.01 per request**; the core booking flow (rates → prebook →
book) and booking management free under a reasonable look-to-book ratio.
Static hotel content (`/data/hotels`, `/data/hotel`) is `unpriced`: the page's
"Other API Endpoints" section could not be read, so those calls are counted
and flagged, never shown as free. A search's total is a floor while it has
unpriced calls; the admin page says so. Confirm on the LiteAPI billing page
and set a price in `lib/supplierPrices.ts`.

List price is charged on failures too (a refused request is still a request).
Sandbox (`sand_`) calls are not billed; rows carry `meta.sandbox` and the list
price, so the numbers are what production would pay.

## Attribution: place lookups made before a search

The trip box looks places up before a search session exists, so those rows
have no `session_id`. They carry the visitor's `anon_id` (or `user_id`), and
`repos/costs.ts` charges each one to the next search that visitor starts,
back to their previous search. Rows no search accounts for (a visitor who
never searched; sign-in emails) are shown as "Not tied to a search" so the
per-search totals plus that bucket equal the ledger.

## Measured (2026-11-12, live sandbox, full e2e run with Jev on)

| Search | Calls | Total | Haiku | Jev | LiteAPI | Unpriced calls |
|---|---|---|---|---|---|---|
| search spec (Porto, typed message) | 14 | $0.0201 | $0 | $0.000095 | $0.0200 | 7 |
| book spec | 10 | $0.0200 | $0 | $0 | $0.0200 | 1 |
| admin spec | 4 | $0.0200 | $0 | $0 | $0.0200 | 1 |

An earlier run of the search spec made two Haiku calls ($0.00068) and one
Jev call: $0.00078 of AI. The two $0.01 place calls (the lookup and the
place details) are ~96–99% of a search's priced cost. Each extra lookup typed
into the trip box adds $0.01.

## Not done

- Reconciling against the providers' own figures (Anthropic Admin API cost
  report): needs `ANTHROPIC_ADMIN_KEY`, not in this repo's `.env`. The page
  labels every figure as calculated.
- Per-cookie spend caps: `server/spend.ts` still caps per search session.
