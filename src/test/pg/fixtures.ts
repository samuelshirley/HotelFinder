import { insertOffers, type OfferInput } from '@/server/repos/offers';
import { upsertProperty } from '@/server/repos/properties';
import { addStay, createSession, type Owner } from '@/server/repos/sessions';

/** A session with one two-night Porto stay. Import only from a file that has mocked the db client. */
export async function seedSearch(owner: Owner = { anonId: 'anon-1' }) {
  const session = await createSession(owner);
  const stay = await addStay(session.id, {
    destinationText: 'Porto',
    checkIn: '2026-12-11',
    checkOut: '2026-12-13',
  });
  return { session, stay };
}

export async function seedProperty(supplierHotelId = 'lp1f67a6', name = 'PortoBay Flores') {
  return upsertProperty({ supplier: 'liteapi', supplierHotelId, name, latitude: 41.143694, longitude: -8.61421 });
}

export const FETCHED = new Date('2026-11-11T10:00:00Z');
export const EXPIRES = new Date('2026-11-11T10:15:00Z');

export async function seedOffer(
  ids: { sessionId: string; stayId: string; propertyId: string },
  over: Partial<OfferInput> = {},
) {
  const [offer] = await insertOffers([
    {
      ...ids,
      supplier: 'liteapi',
      supplierOfferId: `offer-${crypto.randomUUID()}`,
      audience: 'public',
      marginPct: '10.00',
      currency: 'EUR',
      totalMinor: 28129,
      suggestedSellingMinor: 28129,
      payAtPropertyMinor: 1200,
      refundableTag: 'NRFN',
      fetchedAt: FETCHED,
      expiresAt: EXPIRES,
      ...over,
    },
  ]);
  return offer;
}
