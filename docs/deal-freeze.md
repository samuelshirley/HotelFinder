# Deal Freeze

2026-11-13. Vio.com parity: hold a free-cancellation room for free, with no
card, and a reminder before the hold ends.

## 1. How Vio does it (public sources, read 2026-11-13)

From Vio's help article *What is Deal Freeze and how does it work?*
(support.vio.com/hc/en-us/articles/13983005000221, edited 2026-07-17, read
through the Zendesk JSON API because the page answers bots with 403):

- "available on selected Vio deals"; free; **only for users signed in with a
  Google account**; up to **5 frozen at a time, 10 a month**.
- Freezing shows "how long your deal will be held and the deadline for
  completing your payment"; nothing is paid to freeze.
- **The guest details are taken at freeze time** and "can't be changed
  later": the booking is made with them.
- A confirmation email carries the payment deadline and a manage link.
  **Reminder emails go out 72 hours and 24 hours before the deadline.**
- Pay before the deadline to confirm. Otherwise the freeze "will expire
  automatically" and an email confirms it. The guest can also "Unfreeze"
  early; that cannot be undone.
- Vio keeps watching the price. If it drops, it "automatically refreezes" at
  the lower price, possibly "with a different payment deadline", but only if
  at least 7 days remain to pay.
- After that, the booking falls under the normal booking conditions.

vio.com/how-vio-works: "guarantees the room and price until the expiry date
shown"; "no card details are required and there's no obligation to book".
vio.com/about: "Lock in today's hotel price … with no card details required".
A Travel Tech Essentialist profile of Vio
(traveltechessentialist.substack.com/p/viocom-reimagining-metasearch-for)
says the guest can "book a free cancellation offer" and is "notified when the
free cancellation window is about to expire".

**What Vio does not say:** how the room is held. The pieces fit one
mechanism and no other: guest details fixed at freeze, a deadline tied to
the free-cancellation window, refreezing at a new rate with a new deadline.
That is **Vio booking the refundable rate itself, on its own credit, and
cancelling it at the supplier if the guest does not pay in time.** This is
an inference, not a published fact; Vio carries the risk of a late cancel.

## 2. What LiteAPI offers

- **No hold or option booking.** The flow is search → prebook → book; the
  docs describe no hold-without-payment, no pay-later, no option booking
  (docs.liteapi.travel/docs/user-payment; LiteAPI FAQ).
- **Prebook expiry is short and unpublished.** "prebook validity is limited"
  (docs.nuitee.com/docs/deeplinking-to-whitelabel), no duration given. A
  prebook is not a hold: nothing is reserved by it. We already re-check
  after 20 minutes (`PRICE_CHECK_TTL_MS`).
- **A payment-SDK hold** on the guest's card lasts "1-2 business days" when
  the booking is not finalized (docs/user-payment). That is a card hold, the
  opposite of "no card".
- **Cancel:** `PUT /bookings/{bookingId}` (docs.liteapi.travel/reference/
  put_bookings-bookingid). A refundable (`RFN`) booking is refunded per its
  `cancelPolicyInfos`; before the first `cancelTime` the refund is full
  (docs.nuitee.com/docs/canceling-a-booking). Recorded in the sandbox:
  `booking-cancel.json` (`CANCELLED`, fee 0, full refund) and
  `booking-cancel-with-charges.json` (non-refundable: `CANCELLED_WITH_CHARGES`,
  refund 0).
- **Book is not idempotent** (docs/supplier.md): a lost book response cannot
  be retried.

So the only honest freeze on this stack is Vio's inferred one: **book the
free-cancellation rate for real, cancel it before the deadline unless the
guest confirms.** The supplier then genuinely holds the room at that price,
because it is booked.

## 3. What we built

- **Who:** signed in (email code, as checkout). Names are taken at freeze,
  as Vio does: the booking is in them.
- **Which rates:** refundable, with a stated free-cancellation deadline
  (`lib/freeze.ts` `freezeTerms`). The hold ends `RELEASE_MARGIN_MS` (48 h)
  before that deadline, and must last at least `MIN_HOLD_MS` (24 h), so the
  deadline must be at least 72 h away. The 48 h margin is there so a daily
  sweep that misses one run still releases before the hotel would charge.
- **Freeze:** `prebooked → freezing` is the claim (only the winner calls the
  supplier's book; never retried), then `freezing → frozen` with the
  supplier reference. Nothing is paid: the sandbox books with its test
  method. The booking's own cancellation terms are read back; if they give
  an earlier deadline, the hold ends earlier; if they say non-refundable or
  leave less than the minimum hold, the booking is released at once and the
  guest is told the rate cannot be frozen.
- **Confirm (keep):** `frozen → keeping` is a claim so two presses cannot
  pay twice; the test wallet takes the payment; `keeping → confirmed`. A
  failed payment goes back to `frozen`. There is no book call here: the room
  is already booked.
- **Release:** `frozen → releasing` is the claim, then the supplier's cancel.
  Done → `cancelled`, with what the supplier says was refunded and charged.
  A refusal → back to `frozen` (still held, still releasable). No answer →
  stays `releasing`; the sweep reads the booking back from the supplier, and
  never cancels blind a second time.
- **Expiry:** `sweepFreezes` releases every frozen booking whose hold has
  ended (`releasedBy: 'expiry'`). It runs from `GET /api/freeze/sweep`
  (needs `CRON_SECRET`; refuses without it) and, for the bookings in view, on
  every booking page and bookings list read.
- **Reminder:** one, due 24 h before the hold ends (Vio sends two, at 72 h and
  24 h; ours can be shorter than 72 h). Recorded on the row
  (`freezeReminderDueAt`). Sent by email through Resend when
  `RESEND_API_KEY` is set, and marked sent only then. **Locally there is no
  Resend key, so the reminder is display-only**: the booking page shows when
  it is due and says no email will be sent.
- **Limit:** 3 frozen at a time per account (Vio: 5).
- **Sandbox only.** In the sandbox nobody's money is at risk. In production
  the freeze would book on the business's own LiteAPI credit (the sandbox
  test method is refused for a live key), so with a live key the freeze is
  not offered: `freeze_unavailable`.

What we do **not** do from Vio's version: refreeze at a lower price (needs a
price watcher), the 72 h reminder, a freeze from the shortlist card (it is
offered on the checkout page after the price re-check).

## 4. Open risks and decisions (for Sam)

1. **Production needs a credit decision.** A live freeze books on the
   business's account before anyone pays; a missed release costs the full
   cancellation fee. Needs: LiteAPI credit/VCC on the account, and a cron
   that is monitored.
2. **The sweep is not scheduled.** No `vercel.json` cron was added (the plan's
   cron limits are not known here). Until one is, a freeze nobody looks at is
   released only when someone opens it. Harmless in the sandbox.
3. **A freeze whose book call timed out** stays in `freezing` with an unknown
   outcome, exactly like `booking` today: it may be a real booking nobody will
   release. Same missing piece as checkout: a client reference on book and a
   lookup by it.
4. Margins (48 h release margin, 24 h minimum hold, 24 h reminder) are
   guesses, not measured.

## Verified

- `src/test/pg/freeze.test.ts` (25, real Postgres, recorded sandbox answers),
  `src/lib/freeze.test.ts`, `src/lib/bookingStates.test.ts`, and an
  error-copy guard case for every freeze error.
- `e2e/freeze.spec.ts` against the live sandbox, 2026-11-13: a Porto
  free-cancellation card frozen (real sandbox booking, nothing paid, held
  until 48 h before its deadline, reminder display-only), confirmed with the
  test wallet, cancelled; frozen again and released. Every booking it makes
  ends cancelled. The search depends on the sandbox offering at least one
  free-cancellation card on the first five; it did.
- **Not verified:** a reminder email actually delivered (no Resend key here:
  the send is tested against a stubbed `fetch`); the sweep run by a real
  scheduler; release by expiry against the live sandbox (tested on recorded
  answers only).

## Mutation checks

21, all caught: freeze claim ignored; keep claim ignored (payments counted);
release claim ignored; eligibility not checked; live key allowed; the booked
terms ignored; a book timeout read as failed; a cancel timeout read as
refused; payment after the hold ended; freeze limit off; a failed reminder
not given back; a reminder sent with no mail key; the reminder claim not
exclusive (two sweeps at once); sweep secret length unchecked; the hold
ending one instant late; no release margin; the later deadline winning;
`frozen → booking` allowed; `frozen → failed` allowed; a freeze error
without copy.
