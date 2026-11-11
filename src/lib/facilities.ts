/**
 * A hotel's facility strings, tamed (docs/design/hotel-detail.md §4): one name
 * per thing ("WiFi available" + "Free WiFi" = Free WiFi), compliance notices
 * hidden, the eight that matter most first, the rest grouped. Only the
 * supplier's own strings are shown; nothing is added that it did not list.
 */
export type Facility = { key: string; label: string };
export type CuratedFacilities = { top: Facility[]; groups: Array<{ name: string; items: string[] }>; count: number };

const HIDE = /protocol|sanitiz|disinfect|staff (adhere|follow|wear)|contactless|social distanc|hand sanitizer|cashless|safety measure|\bppe\b|laundry washed|guest room and key/i;

/** Canonical keys: [key, label, test]. Order is the "top" priority order. */
const CANONICAL: Array<[string, string, RegExp]> = [
  ['wifi', 'WiFi', /wi-?fi|internet/i],
  ['parking', 'Parking', /parking|garage/i],
  ['pool', 'Pool', /pool/i],
  ['ac', 'Air conditioning', /air.?condition/i],
  ['breakfast', 'Breakfast', /breakfast/i],
  ['gym', 'Fitness centre', /fitness|gym/i],
  ['pets', 'Pets allowed', /\bpets? (allowed|friendly)|pet bowls/i],
  ['spa', 'Spa', /\bspa\b|sauna|wellness|massage/i],
  ['restaurant', 'Restaurant', /restaurant/i],
  ['bar', 'Bar', /\bbar\b|snack bar|lounge/i],
  ['frontdesk', '24-hour front desk', /24.?hour front desk|24-hour reception/i],
  ['shuttle', 'Airport shuttle', /shuttle|airport transfer/i],
  ['ev', 'EV charging', /electric vehicle|ev charg/i],
  ['accessible', 'Accessible rooms', /accessib|wheelchair/i],
  ['kitchen', 'Kitchen', /kitchen/i],
  ['laundry', 'Laundry', /laundry|dry cleaning|ironing/i],
];

const GROUPS: Array<[string, RegExp]> = [
  ['Internet', /wi-?fi|internet/i],
  ['Parking & transport', /parking|garage|shuttle|transfer|car hire|bicycle|electric vehicle/i],
  ['Pools & wellness', /pool|spa|sauna|fitness|gym|massage|wellness|hot tub|jacuzzi|sun ?terrace|beach/i],
  ['Food & drink', /restaurant|bar|breakfast|snack|wine|room service|coffee|kitchen|minibar/i],
  ['Room comfort', /air.?condition|non-smoking|smoking|heating|soundproof|balcony|terrace/i],
  ['Services & front desk', /front desk|reception|luggage|laundry|dry cleaning|ironing|housekeeping|currency|concierge|lift|elevator|tour/i],
  ['Family', /child|kid|family|babysit|crib|cot|adult only|adults only/i],
  ['Accessibility', /accessib|wheelchair/i],
  ['Business', /business|meeting|banquet|conference/i],
];

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

export function curateFacilities(raw: string[], facts: { parking: string | null; petsAllowed: boolean | null }): CuratedFacilities {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const r of raw) {
    const s = tidy(r);
    const k = s.toLowerCase().replace(/\b(available|on site|in all areas)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    if (s.length < 3 || HIDE.test(s) || seen.has(k)) continue;
    seen.add(k);
    kept.push(s);
  }

  // One entry per canonical thing; "free" wins over the plain version.
  const canon = new Map<string, Facility>();
  const claimed = new Set<string>();
  for (const [key, label, test] of CANONICAL) {
    const hits = kept.filter((s) => test.test(s));
    if (key === 'parking' && facts.parking) {
      const p = facts.parking.toUpperCase();
      if (p === 'NOT_AVAILABLE') {
        hits.forEach((h) => claimed.add(h));
        continue;
      }
      canon.set(key, { key, label: p === 'FREE' ? 'Free parking' : p === 'PAID' ? 'Parking (paid)' : label });
      hits.forEach((h) => claimed.add(h));
      continue;
    }
    if (key === 'pets' && facts.petsAllowed !== null) {
      hits.forEach((h) => claimed.add(h));
      if (facts.petsAllowed) canon.set(key, { key, label });
      continue;
    }
    if (hits.length === 0) continue;
    const free = hits.find((h) => /\bfree\b/i.test(h));
    canon.set(key, { key, label: free ? `Free ${label.replace(/^Free /, '')}` : label });
    hits.forEach((h) => claimed.add(h));
  }
  const top = [...canon.values()].slice(0, 8);
  const rest = [...[...canon.values()].slice(8).map((f) => f.label), ...kept.filter((s) => !claimed.has(s))];

  const groups = new Map<string, string[]>();
  for (const item of rest) {
    const name = GROUPS.find(([, test]) => test.test(item))?.[0] ?? 'Other';
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  const order = [...GROUPS.map(([n]) => n), 'Other'];
  return {
    top,
    groups: order.flatMap((name) => (groups.has(name) ? [{ name, items: groups.get(name)! }] : [])),
    count: top.length + rest.length,
  };
}

/** Up to three sentences from the hotel's own policy text that a guest must know, verbatim. */
const MUST_KNOW = /\bpet|deposit|damage|photo id|passport|identification|\bid\b|credit card|minimum (check-in )?age|years (old|of age)|cash|payment|quiet hours|part(y|ies)|curfew/i;
export function goodToKnow(text: string | null): string[] {
  if (!text) return [];
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])|\n+/).map((s) => s.trim()).filter((s) => s.length > 12);
  return sentences.filter((s) => MUST_KNOW.test(s)).slice(0, 3);
}

export function ratingWord(rating: number | null): string | null {
  if (rating === null) return null;
  return rating >= 9 ? 'Superb' : rating >= 8 ? 'Very good' : rating >= 7 ? 'Good' : null;
}
