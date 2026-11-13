import { isMemberOnlyPrice } from '@/lib/pricing';

/**
 * Room splits. Pure. When the user has not said how many rooms, the finder
 * prices a few sensible splits of the party (one supplier search each) and
 * ranks each hotel by its cheapest combination (docs/finder.md "Room splits").
 *
 * Measured in the sandbox on 2026-11-13 (recorded: rates-four-adults-*,
 * rates-family-*): 4 adults as ONE room were priced by 6 of 20 Porto hotels,
 * as TWO rooms by all 20; two rooms were cheaper at 5 of those 6 and one room
 * at the sixth. A family of 2 + 2 children: one room at 9 of 20 hotels, two
 * rooms at all 20, and either can be the cheaper. So both are asked for.
 */

export type Occupancy = { adults: number; childrenAges: number[] };
export type PricedRoom = Occupancy & { name: string; boardName: string | null };

/** The supplier's limit on a search, and the app's on a party. */
export const MAX_ROOMS = 6;
/** At most this many searches per search for one party: the cost bound (docs/usage.md). */
export const MAX_SPLITS = 3;

/**
 * Spread a party over rooms: adults as evenly as possible, children with the
 * first rooms. Every room gets at least one adult.
 */
export function splitParty(adults: number, childrenAges: number[], rooms: number): Occupancy[] {
  const n = Math.max(1, Math.min(rooms, adults));
  const out = Array.from({ length: n }, () => ({ adults: 0, childrenAges: [] as number[] }));
  for (let i = 0; i < adults; i++) out[i % n].adults += 1;
  childrenAges.forEach((age, i) => out[i % n].childrenAges.push(age));
  return out;
}

/**
 * The room counts worth pricing for a party nobody fixed the rooms of.
 * Fewest: rooms of up to four people. Most: one room per two adults, or per
 * three people when children make the party bigger, never more rooms than
 * adults. A couple, alone or with one child, is one room: one search, as before.
 */
export function roomCounts(adults: number, childrenAges: number[]): number[] {
  const people = adults + childrenAges.length;
  const most = Math.max(1, Math.min(adults, MAX_ROOMS, Math.max(Math.ceil(adults / 2), Math.ceil(people / 3))));
  const fewest = Math.min(most, Math.max(1, Math.ceil(people / 4)));
  const all = Array.from({ length: most - fewest + 1 }, (_, i) => fewest + i);
  if (all.length <= MAX_SPLITS) return all;
  return [fewest, Math.round((fewest + most) / 2), most];
}

/** Every occupancy list to search for this stay: the user's rooms when they said, else each sensible split. */
export function occupanciesFor(stay: { adults: number; childrenAges: number[]; rooms: number | null }): Occupancy[][] {
  if (stay.rooms !== null) return [splitParty(stay.adults, stay.childrenAges, stay.rooms)];
  return roomCounts(stay.adults, stay.childrenAges).map((n) => splitParty(stay.adults, stay.childrenAges, n));
}

/** The same rooms for the same people, in the same order. Names are not compared. */
export function sameOccupancies(a: readonly Occupancy[], b: readonly Occupancy[]): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => r.adults === b[i].adults && r.childrenAges.length === b[i].childrenAges.length && r.childrenAges.every((age, j) => age === b[i].childrenAges[j]))
  );
}

const who = (r: Occupancy) =>
  [`${r.adults} adult${r.adults === 1 ? '' : 's'}`, r.childrenAges.length ? `${r.childrenAges.length} child${r.childrenAges.length === 1 ? '' : 'ren'}` : null].filter(Boolean).join(', ');

/**
 * What a price is for, in words, from the supplier's room names only:
 * "Vincci Room", "2 rooms: 2 × Vincci Room",
 * "2 rooms: Vincci Room (2 adults) + Vincci Room Uso Individual (1 adult)".
 * Who sleeps where is said only when the rooms hold different parties.
 */
export function roomsLabel(rooms: readonly PricedRoom[]): string | null {
  if (rooms.length === 0) return null;
  const names = rooms.map((r) => r.name.trim().replace(/\s+/g, ' '));
  if (rooms.length === 1) return names[0] || null;
  const uneven = rooms.some((r) => who(r) !== who(rooms[0]));
  const parts: string[] = [];
  if (uneven) {
    rooms.forEach((r, i) => parts.push(`${names[i]} (${who(r)})`));
  } else {
    // Same party in every room: count the names, in the order they first appear.
    const counts = new Map<string, number>();
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    for (const [n, c] of counts) parts.push(c > 1 ? `${c} × ${n}` : n);
  }
  return `${rooms.length} rooms: ${parts.join(' + ')}`;
}

/** The rooms an offer row was priced for, when it says (rows written before room splits do not). */
export function roomsOf(value: unknown): PricedRoom[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ok = value.every(
    (r) =>
      r && typeof r === 'object' && typeof r.name === 'string' && Number.isInteger(r.adults) && Array.isArray(r.childrenAges) && r.childrenAges.every((a: unknown) => Number.isInteger(a)),
  );
  return ok ? (value as PricedRoom[]) : null;
}

export type HeldOffer = {
  id: string;
  propertyId: string;
  totalMinor: number;
  payAtPropertyMinor: number;
  suggestedSellingMinor: number | null;
  rooms: number;
};

/**
 * One offer per hotel: the cheapest combination this audience may be sold.
 * A rate under the hotel's public price is only chosen for an anonymous
 * visitor when it is all the hotel has (the ranking then shows it as a
 * member price, never its number). "Cheapest" counts what is paid at the
 * hotel too: two rooms pay the city tax twice. Ties: fewer rooms, then id.
 */
export function cheapestPerHotel<T extends HeldOffer>(rows: readonly T[], audience: 'public' | 'member'): T[] {
  const key = (o: T) => [isMemberOnlyPrice(o, audience) ? 1 : 0, o.totalMinor + o.payAtPropertyMinor, o.rooms, o.totalMinor] as const;
  const better = (a: T, b: T) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i];
    return a.id < b.id;
  };
  const best = new Map<string, T>();
  for (const row of rows) {
    const current = best.get(row.propertyId);
    if (!current || better(row, current)) best.set(row.propertyId, row);
  }
  return [...best.values()];
}
