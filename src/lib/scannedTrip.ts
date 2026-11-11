import { z } from 'zod';

import { MUST_HAVES, type MustHave } from '@/lib/amenities';
import { nightsBetween } from '@/lib/finder/geo';
import { canonicalPriorities, PRIORITY_KEYS, type PriorityKey } from '@/lib/finder/rank';
import { minorUnitDigits } from '@/lib/money';

/**
 * What a free-text first message said about the trip, after the server has
 * checked every field. The model only transcribes; anything it returns that
 * does not pass here is dropped and asked for by the form instead. A missing
 * field is never filled with a default.
 */
export type ScannedTrip = {
  destination?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: { adults: number; childrenAges: number[]; rooms: number };
  priceCapMinor?: number;
  mustHaves?: MustHave[];
  /** What "best" means, when the message said: a set, canonical order. */
  priorities?: PriorityKey[];
};

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rawScan = z
  .object({
    destination: z.string().nullish(),
    check_in: z.string().nullish(),
    check_out: z.string().nullish(),
    nights: z.number().nullish(),
    adults: z.number().nullish(),
    children_ages: z.array(z.number()).nullish(),
    rooms: z.number().nullish(),
    max_per_night: z.number().nullish(),
    must_haves: z.array(z.string()).nullish(),
    priorities: z.array(z.string()).nullish(),
  })
  .passthrough();

const MAX_NIGHTS = 30;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const realDate = (s: string | null | undefined): s is string =>
  !!s && iso.safeParse(s).success && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export function validateScan(raw: unknown, today: string, currency: string): ScannedTrip {
  const parsed = rawScan.safeParse(raw);
  if (!parsed.success) return {};
  const r = parsed.data;
  const out: ScannedTrip = {};

  const destination = r.destination?.replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (destination && destination.length >= 2 && destination.length <= 120) out.destination = destination;

  if (realDate(r.check_in) && r.check_in >= today) {
    const nights = typeof r.nights === 'number' && Number.isInteger(r.nights) ? r.nights : null;
    const checkOut = realDate(r.check_out) ? r.check_out : nights !== null && nights >= 1 ? addDays(r.check_in, nights) : null;
    const length = checkOut ? nightsBetween(r.check_in, checkOut) : 0;
    // A stated length that disagrees with the two dates means the model guessed one of them.
    if (checkOut && length >= 1 && length <= MAX_NIGHTS && (nights === null || nights === length)) {
      out.checkIn = r.check_in;
      out.checkOut = checkOut;
    }
  }

  const int = (n: number | null | undefined, min: number, max: number) => (typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : null);
  const adults = int(r.adults, 1, 12);
  if (adults !== null) {
    const ages = r.children_ages ?? [];
    const rooms = r.rooms == null ? 1 : int(r.rooms, 1, 6);
    if (ages.length <= 8 && ages.every((a) => int(a, 0, 17) !== null) && rooms !== null && rooms <= adults) {
      out.guests = { adults, childrenAges: ages, rooms };
    }
  }

  if (typeof r.max_per_night === 'number' && Number.isFinite(r.max_per_night) && r.max_per_night > 0 && r.max_per_night <= 100_000) {
    const minor = Math.round(r.max_per_night * 10 ** minorUnitDigits(currency));
    if (minor >= 1) out.priceCapMinor = minor;
  }

  const musts = [...new Set((r.must_haves ?? []).filter((m): m is MustHave => (MUST_HAVES as readonly string[]).includes(m)))];
  if (musts.length) out.mustHaves = musts;

  const priorities = canonicalPriorities((r.priorities ?? []).filter((p): p is PriorityKey => (PRIORITY_KEYS as readonly string[]).includes(p)));
  if (priorities.length) out.priorities = priorities;
  return out;
}
