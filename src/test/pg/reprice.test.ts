import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }), headers: () => new Headers() }));

import { rawQuery, resetDb, seedUser } from './harness';
import { RECORDED_AT, recordedSupplier } from './recordedSupplier';
import { searchMarginPct } from '@/lib/pricing';
import { bookingView, repriceCheckout, startCheckout } from '@/server/checkout';
import { runFinder } from '@/server/finder';
import { answerForm, askQuestion, type FormAnswer } from '@/server/onboarding';
import { getOffer } from '@/server/repos/offers';
import { confirmPreferences } from '@/server/repos/preferences';
import { adoptAnonymousSessions, createSession, getSession, handOverSession } from '@/server/repos/sessions';
import { fixture } from '@/server/supplier/liteapi/fixtures';
import { normalizePrebook } from '@/server/supplier/liteapi/normalize';
import { prebookResponse } from '@/server/supplier/liteapi/schemas';
import type { SupplierAdapter, SupplierOffer } from '@/server/supplier/types';
import { buildSessionView } from '@/server/view';

/**
 * "Re-price for whoever is looking now" (server/checkout.ts): a signed-out
 * checkout lifted to the hotel's public price, a sign-in that prices the same
 * room as a member, and "Not you?" handing the search to the next account.
 */
beforeEach(resetDb);
const KEY = process.env.LITE_API_KEY;
beforeEach(() => {
  process.env.LITE_API_KEY = 'sand_test';
});
afterEach(() => {
  process.env.LITE_API_KEY = KEY;
});

const ANSWERS: FormAnswer[] = [
  { field: 'destination', placeId: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY', label: 'Porto, Portugal' },
  { field: 'dates', checkIn: '2026-12-11', checkOut: '2026-12-13' },
  { field: 'guests', adults: 2, childrenAges: [], rooms: 1, pets: false },
  { field: 'priorities', priorities: ['cheapest'] },
];

/**
 * The recorded supplier, with a re-check that holds what was searched: the
 * recorded prebook, at the price and public price of the offer it is asked
 * for (the recordings answered by the searches), as a real prebook does.
 */
function pricedSupplier() {
  const recorded = recordedSupplier();
  const seen = new Map<string, SupplierOffer>();
  let n = 0;
  const supplier: SupplierAdapter = {
    ...recorded.supplier,
    async searchAvailability(request) {
      const r = await recorded.supplier.searchAvailability(request);
      if (r.ok) for (const o of r.value.offers) seen.set(o.supplierOfferId, o);
      return r;
    },
    async recheckRate(offerId) {
      const o = seen.get(offerId);
      if (!o) throw new Error('re-check of an offer no search returned');
      const check = normalizePrebook(prebookResponse.parse(fixture('prebook-payment-sdk')), RECORDED_AT);
      n += 1;
      return { ok: true, value: { ...check, prebookId: `${check.prebookId}-${n}`, supplierOfferId: offerId, total: o.total, suggestedSelling: o.suggestedSelling, rooms: [] } };
    },
  };
  return { supplier, searches: recorded.searches, seen };
}

async function searchedAnonymously() {
  const s = pricedSupplier();
  const session = await createSession({ anonId: 'anon-reprice' });
  await askQuestion(session.id, 'destination');
  let guestsAnswered = false;
  for (const answer of ANSWERS) {
    expect(await answerForm({ sessionId: session.id, answer, guestsAnswered, supplier: s.supplier, now: RECORDED_AT, today: '2026-11-11' })).toMatchObject({ ok: true });
    if (answer.field === 'guests') guestsAnswered = true;
  }
  const current = (await getSession(session.id))!;
  const card = (await buildSessionView(current)).shortlist[0];
  return { ...s, session: current, card };
}

describe('re-price for whoever is looking now', () => {
  it("signed out, a room members pay less for is fetched again at the hotel's public price, and only that is held", async () => {
    const t = await searchedAnonymously();
    expect(t.card.offer).toMatchObject({ lowerForMembers: true, totalMinor: 11101 });
    const before = t.searches.length;
    const r = await startCheckout({ session: t.session, offerId: t.card.offer!.id, supplier: t.supplier, now: RECORDED_AT });
    if (!r.ok) throw new Error(r.error);
    // Two searches of that one hotel: at the search margin (kept in memory), then lifted above it.
    const extra = t.searches.slice(before);
    expect(extra).toHaveLength(2);
    expect(extra.every((q) => 'hotelIds' in q.where && q.where.hotelIds.length === 1)).toBe(true);
    expect(extra[0].marginPct).toBe(searchMarginPct());
    expect(extra[1].marginPct).toBeGreaterThan(searchMarginPct());
    // Held at or above the hotel's price, quoted as the card showed it.
    expect(r.booking).toMatchObject({ userId: null, totalMinor: 12793, quotedTotalMinor: 11101 });
    const held = (await getOffer(r.booking.offerId!, t.session.id, 'public'))!;
    expect(held).toMatchObject({ audience: 'public', lowerForMembers: false, totalMinor: 12793, detailOnly: true });
    // The member rate seen by the first search was never written.
    expect(await rawQuery('select 1 from offers where session_id = $1 and total_minor = 11068', [t.session.id])).toEqual([]);
  });

  it('signed out, a re-check under the hotel\'s price is never held: it is fetched again at the public price', async () => {
    const t = await searchedAnonymously();
    // A public row whose room is not lower for members, but whose re-check comes back under the hotel's price.
    await rawQuery('update offers set lower_for_members = false where id = $1', [t.card.offer!.id]);
    const supplier: SupplierAdapter = {
      ...t.supplier,
      async recheckRate(id) {
        const r = await t.supplier.recheckRate(id);
        if (!r.ok) return r;
        const o = t.seen.get(id)!;
        // The first re-check is of the member-margin offer: under the hotel's price.
        return { ok: true, value: { ...r.value, suggestedSelling: o.suggestedSelling && o.total.amountMinor < o.suggestedSelling.amountMinor ? o.suggestedSelling : r.value.suggestedSelling } };
      },
    };
    const r = await startCheckout({ session: t.session, offerId: t.card.offer!.id, supplier, now: RECORDED_AT });
    if (!r.ok) throw new Error(r.error);
    expect(r.booking.totalMinor).toBeGreaterThanOrEqual(11101);
  });

  it('after a sign-in, the same room is priced as a member, and the page shows both prices', async () => {
    const t = await searchedAnonymously();
    const signedOut = await startCheckout({ session: t.session, offerId: t.card.offer!.id, supplier: t.supplier, now: RECORDED_AT });
    if (!signedOut.ok) throw new Error(signedOut.error);
    const user = await seedUser('member@pg.test');
    await adoptAnonymousSessions('anon-reprice', user.id);
    const session = (await getSession(t.session.id))!;
    const r = await repriceCheckout({ session, booking: signedOut.booking, supplier: t.supplier, now: RECORDED_AT });
    if (!r.ok) throw new Error(r.error);
    // The member rate for the same room, quoted against what the signed-out checkout showed.
    expect(r.booking).toMatchObject({ userId: user.id, totalMinor: 11068, quotedTotalMinor: 12793, roomName: signedOut.booking.roomName });
    expect(bookingView(r.booking, RECORDED_AT)).toMatchObject({ priceChanged: true, quotedTotalMinor: 12793, totalMinor: 11068 });
  });

  it('a member booking a signed-out card is held at the member rate, quoted at the price the card showed', async () => {
    const t = await searchedAnonymously();
    const user = await seedUser('booker@pg.test');
    await adoptAnonymousSessions('anon-reprice', user.id);
    const before = t.searches.length;
    const r = await startCheckout({ session: (await getSession(t.session.id))!, offerId: t.card.offer!.id, supplier: t.supplier, now: RECORDED_AT });
    if (!r.ok) throw new Error(r.error);
    expect(t.searches.length).toBe(before); // its supplier offer is at the search margin: prebooked as it is
    expect(r.booking).toMatchObject({ userId: user.id, totalMinor: 11068, quotedTotalMinor: 11101 });
  });

  it('"Not you?": the search goes back to the browser; the next account gets the same room at its own nationality', async () => {
    const t = await searchedAnonymously();
    const first = await seedUser('first@pg.test');
    await adoptAnonymousSessions('anon-reprice', first.id);
    // Their results re-priced for them: the search's latest prices are member prices.
    const stayId = (await buildSessionView((await getSession(t.session.id))!)).stay!.id;
    expect(await runFinder({ sessionId: t.session.id, stayId, supplier: t.supplier, now: new Date(RECORDED_AT.getTime() + 60_000) })).toMatchObject({ kind: 'ok', fetched: true });
    expect((await buildSessionView((await getSession(t.session.id))!)).session).toMatchObject({ signedIn: true, repriceNeeded: false });
    const theirs = await startCheckout({ session: (await getSession(t.session.id))!, offerId: t.card.offer!.id, supplier: t.supplier, now: RECORDED_AT });
    if (!theirs.ok) throw new Error(theirs.error);

    // Only the owner can hand it over.
    expect(await handOverSession(t.session.id, (await seedUser('stranger@pg.test')).id, 'anon-other')).toBe(false);
    expect(await handOverSession(t.session.id, first.id, 'anon-browser')).toBe(true);
    expect(await getSession(t.session.id)).toMatchObject({ userId: null, anonId: 'anon-browser' });
    // Signed out, the view says the prices were fetched for someone else.
    expect((await buildSessionView((await getSession(t.session.id))!)).session).toMatchObject({ signedIn: false, repriceNeeded: true });

    const second = await seedUser('second@pg.test');
    await confirmPreferences(second.id, { guestNationality: 'FR' }, RECORDED_AT);
    await adoptAnonymousSessions('anon-browser', second.id);
    const before = t.searches.length;
    const r = await repriceCheckout({ session: (await getSession(t.session.id))!, booking: theirs.booking, supplier: t.supplier, now: RECORDED_AT });
    if (!r.ok) throw new Error(r.error);
    // Their nationality is the search's now: the search is fetched again for it, and the room too.
    expect(await getSession(t.session.id)).toMatchObject({ userId: second.id, guestNationality: 'FR', nationalitySource: 'user' });
    const after = t.searches.slice(before);
    expect(after.every((q) => q.guestNationality === 'FR')).toBe(true);
    expect(after.some((q) => 'hotelIds' in q.where && q.where.hotelIds.length === 1)).toBe(true);
    expect(r.booking).toMatchObject({ userId: second.id, roomName: theirs.booking.roomName, quotedTotalMinor: theirs.booking.totalMinor });
    expect(r.booking.id).not.toBe(theirs.booking.id);
  });

  it('a checkout that is no longer a price check is not priced again', async () => {
    const t = await searchedAnonymously();
    const user = await seedUser('done@pg.test');
    await adoptAnonymousSessions('anon-reprice', user.id);
    const session = (await getSession(t.session.id))!;
    const r = await startCheckout({ session, offerId: t.card.offer!.id, supplier: t.supplier, now: RECORDED_AT });
    if (!r.ok) throw new Error(r.error);
    expect(await repriceCheckout({ session, booking: { ...r.booking, status: 'confirmed' }, supplier: t.supplier, now: RECORDED_AT })).toEqual({ ok: false, error: 'booking_not_payable' });
  });
});
