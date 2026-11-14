import { z } from 'zod';

import { MUST_HAVES, type MustHave } from '@/lib/amenities';
import { nightsBetween } from '@/lib/finder/geo';
import { canonicalPriorities, PRIORITY_KEYS, type PriorityKey } from '@/lib/finder/rank';
import { minorUnitDigits } from '@/lib/money';
import { isRealDate } from '@/lib/isoDate';

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
  /** rooms null: the message did not say, so the finder prices the cheapest split. */
  guests?: { adults: number; childrenAges: number[]; rooms: number | null };
  priceCapMinor?: number;
  mustHaves?: MustHave[];
  /** What "best" means, when the message said: a set, canonical order. */
  priorities?: PriorityKey[];
  /**
   * Prefill only, never a stay: what the words said about when without
   * giving two dates ("3 nights in March"). It opens the nights card there.
   */
  datesHint?: { nights?: number; month?: string; checkIn?: string };
};

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
    month: z.string().nullish(),
  })
  .passthrough();

const MAX_NIGHTS = 30;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const realDate = (s: string | null | undefined): s is string => !!s && isRealDate(s);

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
    const rooms = r.rooms == null ? null : int(r.rooms, 1, 6);
    const roomsOk = r.rooms == null || (rooms !== null && rooms <= adults);
    if (ages.length <= 8 && ages.every((a) => int(a, 0, 17) !== null) && roomsOk) {
      out.guests = { adults, childrenAges: ages, rooms };
    }
  }

  if (typeof r.max_per_night === 'number' && Number.isFinite(r.max_per_night) && r.max_per_night > 0 && r.max_per_night <= 100_000) {
    const minor = Math.round(r.max_per_night * 10 ** minorUnitDigits(currency));
    if (minor >= 1) out.priceCapMinor = minor;
  }

  const musts = [...new Set((r.must_haves ?? []).filter((m): m is MustHave => (MUST_HAVES as readonly string[]).includes(m)))];
  if (musts.length) out.mustHaves = musts;

  // A start with no end ("from next Monday"): kept as where the nights card opens, never as a stay.
  // 2026-11-13: dropping it opened the card on tonight after "a week from next Monday".
  if (!out.checkIn && realDate(r.check_in) && r.check_in >= today && r.check_out == null && r.nights == null) {
    out.datesHint = { checkIn: r.check_in };
  }

  // A hint only when no date was written at all: a date that failed its checks means the length is a guess too.
  if (!out.checkIn && r.check_in == null && r.check_out == null) {
    const hint: { nights?: number; month?: string } = {};
    if (typeof r.nights === 'number' && Number.isInteger(r.nights) && r.nights >= 1 && r.nights <= MAX_NIGHTS) hint.nights = r.nights;
    if (r.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(r.month) && r.month >= today.slice(0, 7)) hint.month = r.month;
    if (hint.nights || hint.month) out.datesHint = hint;
  }

  const priorities = canonicalPriorities((r.priorities ?? []).filter((p): p is PriorityKey => (PRIORITY_KEYS as readonly string[]).includes(p)));
  if (priorities.length) out.priorities = priorities;
  return out;
}
