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
| `admin:anthropic` | Admin API reads for the /admin check | `server/providerUsage.ts` | free |
| `app` | UI analytics events, not calls | `api/events` | — excluded from every cost view |

`meterGuard.test.ts` makes this table structural: only these five server files
may call out (`fetch`, an injected `fetch`, or the Anthropic client), each has
a `logUsage` writer, the browser only fetches our own API through `withBase`,
and every supplier op the adapter uses has a price entry (also a type error
via `Record<SupplierOp, OpPrice>`). Mutation-checked 2026-11-12: an unmetered
server fetch, an injected-fetch default, the mailer's meter removed, a browser
fetch to another host, and an unpriced new op each fail it.

## LiteAPI prices (page re-read in full 2026-11-12)

From docs.liteapi.travel/reference/api-pricing-usage-costs: place search and
location lookup **$0.01 per request**; everything else we call is free under
the Terms of Service: rates → prebook → book, booking management and hotel
content, "subject to a 5000:1 search-to-book ratio and fair usage". Excess
hotel search "may be billed" (no price given). Billed monthly; the page says
nothing on free allowances, minimums, sandbox billing, or whether a payment
method is required.

List price is charged on failures too (a refused request is still a request).
Sandbox (`sand_`) calls are not billed; rows carry `meta.sandbox` and the list
price, so the numbers are what production would pay.

### What production would cost (measured 2026-11-12)

Per search: one place-details call ($0.01) plus the trip box's lookups ($0.01
each). The box waits 250 ms after a key, so a lookup fires on every pause
longer than that. Typed in a real browser:

| Typing speed | "Porto" | "Barcelona" | "San Sebastian" |
|---|---|---|---|
| 90 ms/key (fast) | 1 | 1 | 1 |
| 180 ms/key (average) | 1 | 1 | 1 |
| 300 ms/key (slow, phone-like) | 4 | 8 | 12 |

So **$0.02 per search** for most people, up to **$0.13** for a slow typist and
a long name; **$20 per 1,000 searches** at the typical rate. A "near X" request
resolved by the agent adds place calls of its own. The search spec makes up to
4 rate searches per search, so with no bookings the 5000:1 ratio is passed at
roughly 1,250 searches.

## Attribution: place lookups made before a search

The trip box looks places up before a search session exists, so those rows
have no `session_id`. They carry the visitor's `anon_id` (or `user_id`), and
`repos/costs.ts` charges each one to the next search that visitor starts,
back to their previous search. Rows no search accounts for (a visitor who
never searched; sign-in emails) are shown as "Not tied to a search" so the
per-search totals plus that bucket equal the ledger.

## Measured (2026-11-12, live sandbox, full e2e run with Jev on)

| Search | Calls | Total | Haiku | Jev | LiteAPI |
|---|---|---|---|---|---|
| search spec (Porto, typed message) | 14 | $0.0201 | $0 | $0.000095 | $0.0200 |
| book spec | 10 | $0.0200 | $0 | $0 | $0.0200 |
| admin spec | 4 | $0.0200 | $0 | $0 | $0.0200 |

(Hotel-content calls were `unpriced` in this run; the price page since says
they are free, so the totals stand as they are.)

An earlier run of the search spec made two Haiku calls ($0.00068) and one
Jev call: $0.00078 of AI. The two $0.01 place calls (the lookup and the
place details) are ~96–99% of a search's priced cost. Each extra lookup typed
into the trip box adds $0.01.

## Anthropic's own figures

With `ANTHROPIC_ADMIN_KEY`, /admin puts Anthropic's usage report for the app's
key (found by matching `ANTHROPIC_API_KEY` to the Admin API's key hints) next
to this ledger, for the same span: hourly buckets for windows up to 7 days
(to the last full hour), daily beyond. Tokens are compared directly; both
sides are priced with `lib/models.ts`. The cost report is not used: it splits
by workspace, and the app's key shares the default workspace.

Measured 2026-11-12: the report trails by about an hour, and the key is shared
by every environment that holds it (local dev, other agents' test runs), so
on 09:00–10:00 UTC Anthropic saw ~4× the tokens one sandbox's ledgers held.
The comparison is only meaningful once production has its own key.

## Not done

- Per-cookie spend caps: `server/spend.ts` still caps per search session.
