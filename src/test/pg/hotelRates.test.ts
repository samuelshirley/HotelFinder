import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { rawQuery, resetDb, seedUser } from './harness';
import { listShortlist } from '@/server/repos/shortlist';
import { RECORDED_AT, recordedSupplier } from './recordedSupplier';
import { startCheckout } from '@/server/checkout';
import { hotelRates } from '@/server/hotelRates';
import { answerForm, askQuestion, type FormAnswer } from '@/server/onboarding';
import { listLiveOffersForRanking } from '@/server/repos/offers';
import { createSession, getSession, listStays } from '@/server/repos/sessions';
import { buildSessionView } from '@/server/view';

beforeEach(resetDb);

const ANSWERS: FormAnswer[] = [
  { field: 'destination', placeId: 'ChIJwVPhxKtlJA0RvBSxQFbZSKY', label: 'Porto, Portugal' },
  { field: 'dates', checkIn: '2026-12-11', checkOut: '2026-12-13' },
  { field: 'guests', adults: 2, childrenAges: [], rooms: 1, pets: false },
  { field: 'priorities', priorities: ['cheapest'] },
];

async function searched() {
  const recorded = recordedSupplier();
  const session = await createSession({ anonId: 'rates' });
  await askQuestion(session.id, 'destination');
  let guestsAnswered = false;
  for (const answer of ANSWERS) {
    await answerForm({ sessionId: session.id, answer, guestsAnswered, supplier: recorded.supplier, now: RECORDED_AT, today: '2026-11-11' });
    if (answer.field === 'guests') guestsAnswered = true;
  }
  const current = (await getSession(session.id))!;
  return { recorded, session: current, stay: (await listStays(current.id))[0], view: await buildSessionView(current) };
}

describe("a hotel's rooms and rates when nobody fixed the rooms", () => {
  it('are for the rooms on its card (one search, not one per split), and rates held for another split are not reused', async () => {
    const recorded = recordedSupplier();
    const session = await createSession({ userId: (await seedUser()).id });
    await askQuestion(session.id, 'destination');
    const answers: FormAnswer[] = [ANSWERS[0], ANSWERS[1], { field: 'guests', adults: 4, childrenAges: [], rooms: null, pets: false }, ANSWERS[3]];
    let guestsAnswered = false;
    for (const answer of answers) {
      await answerForm({ sessionId: session.id, answer, guestsAnswered, supplier: recorded.supplier, now: RECORDED_AT, today: '2026-11-11' });
      if (answer.field === 'guests') guestsAnswered = true;
    }
    const current = (await getSession(session.id))!;
    const stay = (await listStays(current.id))[0];
    expect(stay.rooms).toBeNull();
    const listed = await listShortlist(current.id, stay.id, 'member');
    const twoRooms = listed.find((r) => r.offer?.rooms?.length === 2)!;
    const searchesBefore = recorded.searches.length;

    const r = await hotelRates({ session: current, stay, propertyId: twoRooms.property.id, shownRooms: twoRooms.offer!.rooms, supplier: recorded.supplier, now: RECORDED_AT });
    if (!r.ok) throw new Error(r.error);
    expect(recorded.searches).toHaveLength(searchesBefore + 1);
    expect(recorded.searches.at(-1)!.occupancies).toEqual([
      { adults: 2, childrenAges: [] },
      { adults: 2, childrenAges: [] },
    ]);
    expect(r.offers.length).toBeGreaterThan(0);
    expect(r.offers.every((o) => o.rooms?.length === 2 && /^2 rooms: /.test(o.roomName ?? ''))).toBe(true);

    // The same hotel asked about as one room for four: those two-room rates are not its rates.
    const oneRoom = await hotelRates({ session: current, stay, propertyId: twoRooms.property.id, shownRooms: [{ name: 'Family Room', boardName: null, adults: 4, childrenAges: [] }], supplier: recorded.supplier, now: RECORDED_AT });
    expect(oneRoom).toMatchObject({ ok: true, fetched: true });
    expect(recorded.searches.at(-1)!.occupancies).toEqual([{ adults: 4, childrenAges: [] }]);
  });
});

describe("a hotel's rooms and rates", () => {
  it('fetched for that hotel only, once while live, and never ranked: opening a hotel does not change the shortlist', async () => {
    const t = await searched();
    const before = await listLiveOffersForRanking(t.session.id, t.stay.id, 'public', RECORDED_AT);
    const hotel = t.view.shortlist[1].property.id;
    const later = new Date(RECORDED_AT.getTime() + 60_000);

    const first = await hotelRates({ session: t.session, stay: t.stay, propertyId: hotel, supplier: t.recorded.supplier, now: later });
    expect(first).toMatchObject({ ok: true, fetched: true });
    if (!first.ok) return;
    expect(first.offers.length).toBeGreaterThan(0);
    expect(new Set(first.offers.map((o) => o.propertyId))).toEqual(new Set([hotel]));
    expect(t.recorded.searches.at(-1)!.where).toEqual({ hotelIds: [expect.any(String)] });

    const again = await hotelRates({ session: t.session, stay: t.stay, propertyId: hotel, supplier: t.recorded.supplier, now: later });
    expect(again).toMatchObject({ ok: true, fetched: false });

    const after = await listLiveOffersForRanking(t.session.id, t.stay.id, 'public', later);
    expect(after.map((r) => r.offer.id).sort()).toEqual(before.map((r) => r.offer.id).sort());
  });

  it('any of them can be booked through the same checkout', async () => {
    const t = await searched();
    const hotel = t.view.shortlist[0].property.id;
    const r = await hotelRates({ session: t.session, stay: t.stay, propertyId: hotel, supplier: t.recorded.supplier, now: RECORDED_AT });
    if (!r.ok) throw new Error(r.error);
    const sup = { ...t.recorded.supplier, recheckRate: async () => ({ ok: false as const, error: { kind: 'supplier' as const, status: 400, code: 1, message: 'x', retryable: false } }) };
    // The offer is found and re-checked (the recorded supplier refuses the re-check, which is the point reached).
    expect(await startCheckout({ session: t.session, offerId: r.offers[0].id, supplier: sup })).toEqual({ ok: false, error: 'rate_gone' });
  });

  it('an anonymous visitor never sees a rate under the hotel\'s public price, in any hotel\'s rooms and rates, nor can buy one by its id', async () => {
    const t = await searched();
    const later = new Date(RECORDED_AT.getTime() + 60_000);
    const props = await rawQuery<{ id: string }>('select distinct property_id as id from offers where session_id = $1', [t.session.id]);
    let hidden = 0;
    for (const { id } of props) {
      const r = await hotelRates({ session: t.session, stay: t.stay, propertyId: id, supplier: t.recorded.supplier, now: later });
      if (!r.ok) throw new Error(r.error);
      for (const o of r.offers) if (o.suggestedSellingMinor !== null) expect(o.totalMinor).toBeGreaterThanOrEqual(o.suggestedSellingMinor);
    }
    // The recorded search holds such rates, so the rule above was tested, not vacuous.
    const below = await rawQuery<{ id: string }>('select id from offers where session_id = $1 and total_minor < suggested_selling_minor', [t.session.id]);
    hidden = below.length;
    expect(hidden).toBeGreaterThan(0);
    for (const { id } of below) {
      expect(await startCheckout({ session: t.session, offerId: id, supplier: t.recorded.supplier })).toEqual({ ok: false, error: 'property_not_found' });
    }
  });
});
