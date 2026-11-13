# Vio.com (formerly FindHotel): business model research

Researched 2026-11-13 from public pages only (no sign-in, no forms). Every
claim carries a source and the date of that source. **[Inference]** marks my
reading, not something a source states. Anything dated before ~Nov 2024 is
flagged **(possibly stale)**.

Sources Vio controls (its site, developer docs, blog, CEO op-eds) are marketing
or documentation, not independent verification. Several primary pages could
not be read: the help centre and Terms of Use at `support.vio.com` (403 to
automated fetch), PhocusWire and the Phocuswright profile (403), and Vio's
Medium blog (403). Where a fact comes only from a search-result summary of
one of those pages, it says so.

---

## 0. Company in one paragraph

Amsterdam company, legal entity **Findhotel B.V.** (KvK 66043077, founded
18 May 2016) [liza.nl, KvK data, last filed year 2024]. Founder and CEO Oz Har
Adir. Rebranded from FindHotel to **Vio.com** in November 2022 and bought the
three-letter domain (search summary of 10minhotel.com and Vio's Medium post
"FindHotel is now Vio.com"; **possibly stale**, but the rebrand itself is a
settled fact). A second brand refresh ("Book like an insider", an elephant
symbol) launched 3 Feb 2026
[vio.com/blog/the-journey-behind-vios-new-brand]. It describes itself as
"an accommodation marketplace" that combines "metasearch transparency with a
fully integrated OTA and a CPA-based auction model" (Phocuswright Launch
profile 2025, via search summary). Bootstrapped and profitable, with no
venture capital (same profile; Travel Tech Essentialist, 3 Apr 2025).

---

## 1. Revenue stream A: redirects to Booking.com, Expedia, Agoda, etc.

**What is stated**

- Vio compares "100+ travel sites, including its own". When a partner has a
  better price, Vio shows it and the user completes the booking on the
  partner's site ("You'll always see who you're booking with")
  [vio.com/how-vio-works, read 2026-11-13].
- Providers it aggregates: Booking.com, Expedia, Hotels.com, Agoda
  [developers.vio.com/mcp/guide/, © 2026]; also "Expedia, Trip.com, Agoda,
  Vio.com and many others" [developers.vio.com/docs/getting-started.html].
- **It is paid per booking (CPA), not per click.** The Travel Tech Essentialist
  deep dive (sponsored by Vio, 3 Apr 2025) says Vio runs a **CPA auction**:
  "suppliers don't need to adjust bids continuously; they only pay when an
  actual booking occurs." The Phocuswright 2025 profile says the same ("a
  CPA-based auction model ... aligns its incentives with customer value
  instead of clicks"). The CEO's op-ed (Hotel Technology News / Hotel-Online,
  28 Mar 2025) argues that metasearch should move from CPC to "a cost-per-action
  revenue model based on booking conversions". It describes CPC as the
  industry norm, with Booking and Expedia bringing in more than three-quarters
  of the revenue of many metasearch sites.
- Vio's partner reporting docs confirm that the money is a **commission per
  booking, computed by the provider**: "gross commission" is "the revenue
  Vio.com receives from a booking", calculated by the booking's `provider`
  ("Vio.com or another intermediary") from booking value. It can change over
  the booking's life, is **zero if the booking is cancelled**, and is final
  60 days after checkout [developers.vio.com/docs/Reporting/reports].
- Hotels cannot pay for better placement. The ranking is described as
  unbiased, "though this may change" (Travel Tech Essentialist, Apr 2025).

**[Inference]**

- Redirect revenue is a **CPA/commission on stayed bookings paid by the OTA**
  (Booking.com, Expedia, Agoda, Trip.com ...). This is the standard
  affiliate/meta-CPA arrangement those OTAs offer, though no source names
  the contract type per partner. "Auction" means each provider's CPA bid (a
  commission %) affects how its offer is ranked or chosen alongside price.
- The redirect commission is **much thinner than an own-OTA booking.** The
  only public clue is a TopCashback UK listing for Vio, quoted in a search
  summary but not visible when I fetched the page: **8% cashback on stays
  booked on Vio.com versus 1% on stays booked through redirect travel sites**.
  Cashback is a share of what the merchant pays the cashback site, so this
  points to a several-times-higher margin on own-OTA bookings.

## 2. Revenue stream B: "book on Vio"

**What is stated**

- "We handle your booking and payment directly", with 24/7 support. For these
  bookings Vio is the provider (payment, confirmation, customer service)
  [vio.com/how-vio-works].
- The CEO frames the OTA as the fix for metasearch's conflict of interest.
  Vio is "the merchant of record, setting the final price, handling support,
  and managing service levels end to end" (Travel Tech Essentialist, Apr 2025).
- **Supply comes from bedbanks and wholesalers.** A current Vio job ad
  (Partnerships Manager, OTA) says: "Manage and grow B2B accommodation supply
  partnerships with bedbanks and wholesalers ... our B2B accounts for our
  OTA" and ensure users "always find the best rate from every supplier in the
  market" [builtinlondon.uk/job/partnerships-manager/11478714, "posted one
  month ago" as of Nov 2026]. Other ads: Senior Partnerships Manager (Supply),
  Key Accounts Director (Strategic Supply), covering "rate and distribution
  management" for its largest supply accounts (search summaries, 2026).
- Number of suppliers: "dozens", aiming for 50+ in 2025 (Travel Tech
  Essentialist, Apr 2025); "~100 supply partners" [vio.com/affiliates, read
  2026-11-13].
- **Merchant of record is not always Vio.** Some reservations are paid at
  the property, some are prepaid to Vio, and some are "handled by a
  connected provider" that collects payment (The Traveler, 4 Jul 2026).
  Results show offers side by side, some labelled **"Pay now with Vio.com"**
  and others tagged as fulfilled by a third-party partner (The Traveler,
  30 Jun 2026). The Partners API defines `provider` as "the provider
  distributing this offer, **not necessarily the same as the provider selling
  the offer**" and has a `canPayLater` flag
  [developers.vio.com/docs/Partners-API/search.html].
- How it earns: third-party reviewers say Vio takes rates from wholesalers,
  bedbanks and partner agencies and "adds a relatively modest margin" or
  "small markup" (The Traveler, 30 Jun and 4 Jul 2026). Vio's own pages do not
  state a margin.
- Which suppliers? **No source names one.** Nothing public ties Vio to
  Hotelbeds, WebBeds, Expedia Partner Solutions/Rapid, RateHawk, TBO, etc.
  A Stay22 post mentions Agoda inventory available "through Vio.com's
  partnership" (search summary only). That is consistent with Agoda being a
  supply partner as well as a redirect partner, but it is not confirmed.

**When "book on Vio" vs redirect**

- Stated: Vio lists its own offer alongside partners'. "If a trusted partner
  has a better price, we show it" [vio.com/how-vio-works]. About **25%** of its
  ~€1B+ annual bookings went through its own OTA (Travel Tech Essentialist,
  Apr 2025).
- **[Inference]** Vio shows "Pay now with Vio.com" whenever one of its
  wholesale or bedbank suppliers returns a bookable rate for that hotel and
  room, and it promotes that offer when it is cheapest or close to it,
  because the margin is higher. It redirects when a partner OTA is cheaper or
  Vio has no supply for that hotel. No source states the exact rule.
- Known operational risk with wholesale supply: user complaints of a hotel
  having "no record" of a prepaid booking, and support saying bookings appear
  "closer to check-in" because of how partners release reservations
  (sikayetvar.com complaints; search summaries; anecdotal).

## 3. What "OTA" means here

- **OTA = online travel agency**, not "online travel assistant". Vio and the
  press use it that way throughout: "a fully integrated OTA" (Phocuswright
  2025), "B2B accounts for our OTA" (job ad 2026), "an internal OTA" (CEO
  op-ed, Mar 2025), and "More than €1bn in gross booking value through Vio's
  OTA" [vio.com/affiliates].
- **OTA vs metasearch:**
  - A **metasearch** (Trivago, Kayak, Google Hotels, classic FindHotel) shows
    other sellers' prices and sends the user to them. It never takes payment
    and earns per click (CPC) or per booking (CPA) from the seller.
  - An **OTA** (Booking.com, Expedia, Agoda) sells the room itself. It takes
    the booking, usually the payment (merchant model) or passes it to the
    hotel (agency/pay-at-hotel), and owns support. It earns commission from
    the hotel or a markup over a net rate bought from a hotel or wholesaler.
- **Where Vio sits: a hybrid.** It is metasearch on the front end, an OTA for
  roughly a quarter of bookings (as of 2025), and a B2B distributor for about
  30 affiliates and white-label partners. Named partners include Kiwi.com,
  HolidayPirates, FINN, WeWard, Super.com, AirHelp and Wego
  [vio.com/affiliates]. Skyscanner, Super and Wego are named as white-label
  users (CEO bio, Mar 2025). Partners get a revenue share of Vio's commission
  on checked-out bookings [vio.com/affiliates;
  developers.vio.com/docs/Reporting/reports].
- **Is there an AI travel assistant?** Not on vio.com itself, as far as I
  could find. What exists:
  - **Vio MCP server** for AI agents, with tools `suggest_destinations`,
    `search_hotels`, `get_hotels` and `search_hotels_availability`, plus a
    "SKILL", a React UI kit, a hosted MCP app and a planned A2A agent. It is
    monetised as commission revenue share on bookings an agent drives
    [developers.vio.com/mcp/guide/, © 2026; vio.com/affiliates lists "MCP:
    real-time hotel search and booking for AI agents"].
  - **Vio app inside ChatGPT** (chatgpt.com/apps/vio): hotel cards, maps and
    booking flows, powered by that MCP server [developers.vio.com/mcp/guide/].
    A third-party directory first saw it on 21 Apr 2026, at v4.0.0 by late
    May 2026 (getdrio.com app tracker, search summary; page was 503 when
    fetched).
  - In April 2025 the CEO took a "wait-and-see" stance on AI agents (Travel
    Tech Essentialist). The ChatGPT app/MCP work came after that.
  - **[Inference]** If someone called Vio's "OTA" an assistant, they likely
    blended the OTA with this ChatGPT/MCP channel. They are different things.

## 4. Product mechanics tied to monetisation

| Mechanic | What is public | Source / date |
|---|---|---|
| Price comparison | 100+ sites including Vio's own; prices shown "include all fees and taxes" | how-vio-works (2026); blog "Is Vio.com a scam?" (4 Feb 2025) |
| Sign-in deals | The Partners API offer object has `metadata.signInDealAvailable`: "Indicates if there is a sign-in deal available for this offer." Hotels carry an `anchorRate` ("strike through price"). | developers.vio.com/docs/Partners-API/search.html |
| "Vio Deals" | **No product by that name found.** Homepage: "exclusive deals with discounts up to 45%", "Our top deals for tonight". | vio.com (2026-11-13) |
| App-only prices | "Access our best deals on our app", "Unlock exclusive savings on our app", "Save up to 60%" banner; App Store: "up to 45% off stays when you use the Vio app". Reviewer: "app-only discounts" and new-user coupons. | vio.com; App Store listing (v2.31.0, Nov 2026); The Traveler 30 Jun 2026 |
| Loyalty / rewards | Mixed. Travel Tech Essentialist (Apr 2025): a loyalty program that "maps to supplier loyalty tiers" so occasional travellers get member-only rates. Phocuswright pitch (Dec 2025): CEO "highlighted Vio's reward system" (search summary). vio.com/affiliates lists "Airlines & loyalty" as a B2B offering. But the homepage, how-vio-works and about pages do not mention rewards, and a Jul 2026 reviewer says Vio "focuses on comparing prices rather than operating a rewards programme". | as cited |
| Cashback | No Vio-run cashback found. Third-party TopCashback offers 8% on Vio-OTA stays and 1% on redirect stays. | topcashback.co.uk/viouk (search summary) |
| Deal Freeze | Hold a free-cancellation rate for free, no card needed, with a reminder before the window closes | how-vio-works; about; Travel Tech Essentialist |
| Price alerts / insights | Track itinerary prices; show where a price sits against trend | how-vio-works; about |
| Split booking / room optimisation | Combine stays or rooms for a lower total; API flag `optimizeRooms` | how-vio-works; Partners API |
| Rebooking | Listed among features ("rebooking, price alerts") | Phocuswright 2025 profile (search summary) |

**[Inference] how the member and app pricing works.** The CEO's Mar 2025 op-ed
says OTAs keep their cheapest rates for loyalty members and app users, because
public rates are bound by parity. Those are "closed user group" rates. The
Phocuswright pitch says Vio "enables brands to offer their customers lower
rates that hotels often offer to closed user groups". So sign-in and app deals
are most likely **closed-user-group wholesale or member rates** that may only
be shown to identified (signed-in or app) users. That is Vio's main way to
undercut public prices while staying within parity rules.

## 5. Scale

| Metric | Figure | Source / date |
|---|---|---|
| Gross bookings | ~€120M (2018), ~€250M (2020), ~€1B (2024); "€1B+ annual bookings", 40%+ CAGR | Travel Tech Essentialist, Apr 2025; Phocuswright 2025 |
| Own-OTA share | ~25% of bookings (2024/25) | Travel Tech Essentialist, Apr 2025 |
| Conflicting claim | "More than €1bn in gross booking value through Vio's OTA" | vio.com/affiliates, 2026. **[Inference]** Either the OTA share has grown since 2025 or "OTA" is used loosely for the whole platform. Unresolved. |
| Users | "Over 100 million users a year" | vio.com/affiliates; CEO bio Mar 2025 |
| Inventory | 1.1M hotels, 6.3M vacation rentals; ~95% hotels / 5% alternative by business | vio.com/affiliates; Travel Tech Essentialist |
| Geography | ~half North America; EMEA expected to be the majority by 2026 | Travel Tech Essentialist, Apr 2025 |
| Affiliates | ~30 active (2025) | Travel Tech Essentialist; Phocuswright |
| Headcount | "Over 200 people" (about page, 2026); 117 FTE (2024), 109 (2023), 86 (2022), 51 (2021) in Findhotel B.V. filings | vio.com/about; liza.nl (KvK data) |
| Funding | None. Bootstrapped and profitable since founding, no VC. A Spanish startup database lists a ~€250M valuation estimate (Dec 2022, not a funding round; **possibly stale**). | Phocuswright 2025; Dealroom (no external funding); startups.one.gob.es (search summary) |
| Financials (Findhotel B.V., EUR) | Gross margin: €28.7M (2021), €51.2M (2022), €46.2M (2023), €46.6M (2024). Net profit: €6.2M, €7.5M, €2.4M, €4.9M. Equity €18.3M (2024). Turnover not published (abbreviated filing). | liza.nl, from KvK filings |

**Take rate:** no reported figure.
**[Inference]** €46.6M gross margin on ~€1B GBV is about **4.6% of GBV**
(2024). Treat this as a floor-ish rough indicator only, for three reasons:

1. Dutch "brutomarge" is revenue minus cost of sales. For merchant (own-OTA)
   bookings, revenue may be booked gross with the room cost netted out. Paid
   traffic (Google, meta) may sit above or below that line; it is not
   disclosed.
2. GBV is a rounded marketing figure.
3. Other group entities may exist.

The TopCashback ratio of 8% to 1% suggests own-OTA bookings earn several times
more per euro than redirects. With ~25% of GBV through the OTA, that blend is
consistent with a low-to-mid single-digit overall take.

---

## Open items (not verifiable without signing in or reading blocked pages)

- Which entity is the merchant of record on the card statement, and the
  agent/merchant wording in the Terms of Use. Read
  `support.vio.com/hc/en-us/articles/37509195342109-Terms-of-Use` in a normal
  browser.
- Names of the bedbanks and wholesalers.
- Whether a live Vio rewards program exists today, and what a signed-in user
  actually sees for sign-in deals.

## Source list

- https://www.vio.com/how-vio-works
- https://www.vio.com/affiliates
- https://www.vio.com/about
- https://www.vio.com (homepage)
- https://www.vio.com/blog/the-journey-behind-vios-new-brand (3 Feb 2026)
- https://www.vio.com/blog/is-vio-com-a-scam (4 Feb 2025)
- https://www.vio.com/blog/why-book-with-vio-vs-hotel-direct (4 Feb 2025)
- https://developers.vio.com/mcp/guide/
- https://developers.vio.com/docs/getting-started.html
- https://developers.vio.com/docs/Partners-API/search.html
- https://developers.vio.com/docs/Reporting/reports
- https://developers.vio.com/docs/White-Label/getting-started.html
- https://traveltechessentialist.substack.com/p/viocom-reimagining-metasearch-for (3 Apr 2025, sponsored)
- https://www.phocuswrightconference.com/Whos-Coming/Innovators/2025/Vio-com (search summary; 403)
- https://www.phocuswire.com/vio-innovator-launch-phocuswright-conference-2025 (17 Dec 2025; search summary; 403)
- https://hoteltechnologynews.com/2025/03/how-reimagining-metasearch-can-deliver-wins-for-both-hotels-and-otas/ (28 Mar 2025)
- https://www.hotel-online.com/index.php/news/whats-wrong-with-metasearch-today (28 Mar 2025)
- https://builtinlondon.uk/job/partnerships-manager/11478714 (2026)
- https://www.thetraveler.org/why-vio-com-is-winning-over-deal-focused-travelers/ (4 Jul 2026)
- https://www.thetraveler.org/can-vio-com-really-save-you-money-on-hotel-bookings/ (30 Jun 2026)
- https://appsavvytraveller.com/vio-com-review/ (16 Jul 2026, updated 14 Sep 2026)
- https://www.topcashback.co.uk/viouk/ (rates from search summary)
- https://www.liza.nl/en/66043077/findhotel (KvK-derived financials, through 2024)
- https://apps.apple.com/us/app/vio-hotels-travel-deals/id1639101398
- https://www.getdrio.com/app-tracker/vio-com (search summary; 503)
- https://medium.com/viodotcom/findhotel-is-now-vio-com-154c4b9da045 (Nov 2022; possibly stale; search summary; 403)
