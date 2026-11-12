import 'server-only';

import { toCandidates } from '@/lib/finder/candidates';
import { rankStay } from '@/lib/finder/rank';
import { formatKm, reasonText } from '@/lib/reasonText';
import { formatMoney } from '@/lib/replies';
import { recordedExampleSearch } from '@/server/supplier';

/**
 * The first screen's example answer: the real top card of a recorded sandbox
 * search (Porto, 11–13 Dec 2026, 2 adults, member prices), ranked by the real
 * ranking for "low price and great reviews". Nothing in it is written by hand:
 * change the ranking and the example changes with it.
 */
export type Example = { caption: string; name: string; total: string; nightsText: string; facts: string; reason: string; photo: string | null };

const RECORDED_AT = new Date('2026-11-11T12:00:00Z');

export function exampleCard(): Example | null {
  const search = recordedExampleSearch(RECORDED_AT);
  if (!search) return null;
  const candidates = toCandidates({
    offers: search.offers.map((offer) => ({ id: offer.supplierOfferId, offer })),
    properties: search.properties.map((property) => ({ id: property.supplierHotelId, property })),
    amenities: new Map(),
  });
  const result = rankStay({ candidates, checkIn: '2026-12-11', checkOut: '2026-12-13', priorities: ['cheapest', 'nicest'], mustHaves: [], priceCapMinor: null, near: null, audience: 'member' });
  const top = result.shortlist[0];
  if (!top) return null;
  const c = top.candidate;
  const photo = search.properties.find((p) => p.supplierHotelId === c.propertyId)?.mainPhoto ?? null;
  const facts = [c.rating !== null ? String(c.rating) : null, c.stars ? `${c.stars}★` : null, top.km !== null ? `${formatKm(top.km)} from the middle of the results` : null].filter(Boolean).join(' · ');
  return {
    caption: 'Example from a real search: Porto, 2 nights, low price and great reviews',
    name: c.name,
    total: formatMoney(c.totalMinor, 'EUR'),
    nightsText: '2 nights',
    facts,
    reason: reasonText(top.reason, { currency: 'EUR', hasMustHaves: false }),
    photo,
  };
}
