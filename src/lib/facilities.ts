/**
 * A hotel's facility strings, tamed (docs/design/hotel-detail.md §4): one name
 * per thing ("WiFi available" + "Free WiFi" = Free WiFi), compliance notices
 * hidden, the eight that matter most first, the rest grouped. Only the
 * supplier's own strings are shown; nothing is added that it did not list.
 */
import { copy } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/locale';

export type Facility = { key: string; label: string };
export type CuratedFacilities = { top: Facility[]; groups: Array<{ name: string; items: string[] }>; count: number };

const HIDE = /protocol|sanitiz|disinfect|staff (adhere|follow|wear)|contactless|social distanc|hand sanitizer|cashless|safety measure|\bppe\b|laundry washed|guest room and key/i;

/** The facilities shown first, in this order; their names are in the catalogues (`detail.facility`). */
export const FACILITY_KEYS = ['wifi', 'parking', 'pool', 'ac', 'breakfast', 'gym', 'pets', 'spa', 'restaurant', 'bar', 'frontdesk', 'shuttle', 'ev', 'accessible', 'kitchen', 'laundry'] as const;
export type FacilityKey = (typeof FACILITY_KEYS)[number];

/** How each is found in the supplier's strings, which stay English (docs/i18n.md, "The supplier"). */
const CANONICAL: Record<FacilityKey, RegExp> = {
  wifi: /wi-?fi|internet/i,
  parking: /parking|garage/i,
  pool: /pool/i,
  ac: /air.?condition/i,
  breakfast: /breakfast/i,
  gym: /fitness|gym/i,
  pets: /\bpets? (allowed|friendly)|pet bowls/i,
  spa: /\bspa\b|sauna|wellness|massage/i,
  restaurant: /restaurant/i,
  bar: /\bbar\b|snack bar|lounge/i,
  frontdesk: /24.?hour front desk|24-hour reception/i,
  shuttle: /shuttle|airport transfer/i,
  ev: /electric vehicle|ev charg/i,
  accessible: /accessib|wheelchair/i,
  kitchen: /kitchen/i,
  laundry: /laundry|dry cleaning|ironing/i,
};

export type FacilityGroup = 'internet' | 'transport' | 'wellness' | 'food' | 'comfort' | 'services' | 'family' | 'accessibility' | 'business' | 'other';

const GROUPS: Array<[FacilityGroup, RegExp]> = [
  ['internet', /wi-?fi|internet/i],
  ['transport', /parking|garage|shuttle|transfer|car hire|bicycle|electric vehicle/i],
  ['wellness', /pool|spa|sauna|fitness|gym|massage|wellness|hot tub|jacuzzi|sun ?terrace|beach/i],
  ['food', /restaurant|bar|breakfast|snack|wine|room service|coffee|kitchen|minibar/i],
  ['comfort', /air.?condition|non-smoking|smoking|heating|soundproof|balcony|terrace/i],
  ['services', /front desk|reception|luggage|laundry|dry cleaning|ironing|housekeeping|currency|concierge|lift|elevator|tour/i],
  ['family', /child|kid|family|babysit|crib|cot|adult only|adults only/i],
  ['accessibility', /accessib|wheelchair/i],
  ['business', /business|meeting|banquet|conference/i],
];

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

export function curateFacilities(raw: string[], facts: { parking: string | null; petsAllowed: boolean | null }, locale: Locale = 'en'): CuratedFacilities {
  const d = copy(locale).detail;
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
  for (const key of FACILITY_KEYS) {
    const test = CANONICAL[key];
    const label = d.facility[key];
    const hits = kept.filter((s) => test.test(s));
    if (key === 'parking' && facts.parking) {
      const p = facts.parking.toUpperCase();
      if (p === 'NOT_AVAILABLE') {
        hits.forEach((h) => claimed.add(h));
        continue;
      }
      canon.set(key, { key, label: p === 'FREE' ? d.freeParking : p === 'PAID' ? d.parkingPaid : label });
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
    canon.set(key, { key, label: free ? d.freeFacility(label) : label });
    hits.forEach((h) => claimed.add(h));
  }
  const top = [...canon.values()].slice(0, 8);
  const rest = [...[...canon.values()].slice(8).map((f) => f.label), ...kept.filter((s) => !claimed.has(s))];

  const groups = new Map<FacilityGroup, string[]>();
  for (const item of rest) {
    const name = GROUPS.find(([, test]) => test.test(item))?.[0] ?? 'other';
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  const order: FacilityGroup[] = [...GROUPS.map(([n]) => n), 'other'];
  return {
    top,
    groups: order.flatMap((g) => (groups.has(g) ? [{ name: d.facilityGroup[g], items: groups.get(g)! }] : [])),
    count: top.length + rest.length,
  };
}

/**
 * Up to three sentences from the hotel's own policy text that a guest must
 * know, verbatim. The text comes in the visitor's language when the supplier
 * has it (docs/i18n.md, "The supplier"), so Spanish is read too.
 */
const MUST_KNOW = /\bpets?\b|deposit|damage|photo id|passport|identification|\bid\b|credit card|minimum (check-in )?age|years (old|of age)|cash|payment|quiet hours|part(y|ies)|curfew/i;
const MUST_KNOW_ES = /mascota|dep[óo]sito|fianza|daños|documento de identidad|\bdni\b|pasaporte|identificaci[óo]n|tarjeta de cr[ée]dito|edad m[íi]nima|años de edad|mayores de \d+ años|efectivo|\bpago|horas? de silencio|fiestas?\b|toque de queda/i;
export function goodToKnow(text: string | null): string[] {
  if (!text) return [];
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])|\n+/).map((s) => s.trim()).filter((s) => s.length > 12);
  return sentences.filter((s) => MUST_KNOW.test(s) || MUST_KNOW_ES.test(s)).slice(0, 3);
}

export function ratingWord(rating: number | null, locale: Locale = 'en'): string | null {
  if (rating === null) return null;
  const w = copy(locale).detail.ratingWord;
  return rating >= 9 ? w.superb : rating >= 8 ? w.veryGood : rating >= 7 ? w.good : null;
}
