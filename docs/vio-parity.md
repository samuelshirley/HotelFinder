# Vio parity: what is left

2026-11-13. Payments are out of scope (we won't take money). Sources: the Vio
click logs in `docs/competitor-flows/vio-*.csv` (walked 2026-11-11),
`docs/entry-ux.md`, `docs/build-log.md`, and a read of `src/` today. The
earlier claude.ai chats could not be read from here, so anything decided only
in them is missing. **[S]** marks an item that CLAUDE.md "Scope — hold the
line" lists as out of scope: Sam has to say yes before it is built.

How Vio makes money and what its "OTA" is: `docs/research/vio-business-model.md`.

## Already at parity (or ahead)

| Vio | Ours |
|---|---|
| One-row widget: where · dates · guests | Trip box: free text + Where/When/Who pills (`TripBox.tsx`) |
| Typed autocomplete (City / Area / Property / Airport) | Places picker with country and type; asks when ambiguous |
| Guests: adults, children, rooms | Adults, children with ages, rooms, plus a pet (Vio has none) |
| Price filter ("Up to €180") | `set_price_cap` |
| Free cancellation, pet friendly, pool, amenity, meal plan chips | Must-haves: free cancellation, breakfast, pets, parking, pool, A/C, wifi, lift, wheelchair, family rooms, soundproof, gym, airport shuttle |
| Sort: best match / lowest price / top reviewed / distance | Priorities (cheapest / closest / nicest / safe bed), combinable (Vio's sorts are single-key) |
| "Why results appear this way" | A reason on every card; sponsored picks always labelled |
| Property page: gallery, rating, amenities, room list, pets FAQ | Detail sheet: gallery + lightbox, review categories, key facts, other rooms & rates, "Good to know", amenities |
| Member prices behind "Unlock" (sign-in) | Email-code sign-in unlocks member prices (new searches only) |
| Price re-check ("Checking availability…") | Re-check before checkout; changed rate shown |
| My bookings, cancel | Built (test bookings in the sandbox) |

## Gaps

Ordered by how visible they are to a Vio user. "Chat-only" means the capability
exists only as something you type; Vio has a control for it.

| # | Vio feature | State here | Notes |
|---|---|---|---|
| 1 | **Map** of the results | Done on main (PR #2): MapLibre + OpenFreeMap, `docs/design/map.md` | A map on the property page is not checked |
| 2 | **Many results, then narrow** (Vio lists hundreds; we show 3–5) | By design | Deliberate difference (`docs/entry-ux.md` §0). "Show others" exists. A "see all N" list would be parity; decide whether we want it |
| 3 | **Filter chips visible on the results page** (stars, 8.0+ rating, property type, neighbourhood, brand, meal plans) | Partly: amenity must-haves only; stars, min rating, property type, neighbourhood, brand are missing | Architecture §13 says filters are messages, not a sidebar. Min rating and stars need new actions + finder rules |
| 4 | **Price comparison across providers** (Expedia / Agoda / "vio rate" on one hotel) | Not possible | Needs more suppliers **[S]** ("a second supplier") |
| 5 | **Home rentals** (Airbnb, apartments) | Not built | Needs another supplier **[S]** |
| 6 | **Favourites / saved hotels** | Not built | Small: a table + a heart on the card |
| 7 | **"Continue your search"** on the home page | Trips list exists ("Your trips") | Roughly at parity; check it shows on the first screen |
| 8 | **Currency and language selector** | Currency is set per session, no selector; English only (open question 15) | Currency selector is small; other languages are large (slot extraction is per language) |
| 9 | **"Freeze deal"** (hold a price) | Not built | Needs a supplier hold or our own risk; research it before deciding |
| 10 | **15-minute price timer at checkout** | Not built | Small UI; only honest if the rate really expires |
| 11 | **Pay later on a date / pay now choice** | We show pay-at-hotel amounts; no choice | Payments are out of scope, so display only |
| 12 | **Special requests** field at checkout | Not built | Small, if LiteAPI's book call takes remarks |
| 13 | **Strike-through "was" price** (€104 → €76) | Not built | Only with a real reference price; otherwise misleading |
| 14 | **Hotel FAQ section** (pets, parking, check-in) | Answered in chat by Jev / agent from the rows | Chat-only. Could render the same answers as an FAQ block |
| 15 | **Mobile app**, app-only prices | Not built | **[S]** ("a native app"). Narrow web layout exists |
| 16 | **Price alerts / price drop** | Not built | **[S]** ("price alerts") |
| 17 | **Rewards / loyalty** (if Vio has one; see research) | Not built | **[S]** ("loyalty") |
| 18 | **Trustpilot / app-store trust strip** | Not built | Marketing, no reviews to show yet |
| 19 | **Split booking / room optimisation** (cheaper total by combining rooms or stays) | Not built | Vio's default "Optimize for best price" for rooms |
| 20 | **Rebooking** (re-book when the price drops) | Not built | Close to price alerts **[S]** |
| 21 | **Vio app in ChatGPT / MCP server** for AI agents | Not built | Our product is the chat itself; an MCP endpoint is a distribution channel, not a screen |

Rows 9, 16, 19, 20 and 21 come from `docs/research/vio-business-model.md`.
They were not seen in the walked flows.

## Not verified (affects the list)

- Jev has never answered a real message (`scripts/jev-live.sh` not run), so
  every "chat-only" row above is only as good as the agent fallback.
- Vio was walked on desktop in three flows only; their account area, app and
  any AI assistant were not walked.
