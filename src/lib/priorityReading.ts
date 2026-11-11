import { z } from 'zod';

import { canonicalPriorities, PRIORITY_KEYS, type PriorityKey } from '@/lib/finder/rank';
import { SETTLE, type Readings } from '@/lib/router/route';

/**
 * What a typed answer to "what matters most?" means, from Jev or Haiku.
 * Pure. The model only transcribes: keys from a fixed list, and a place to be
 * near as the WORDS the user used (never coordinates or an id: the supplier
 * resolves those).
 */
export type PriorityReading = { priorities: PriorityKey[]; nearQuery: string | null; nearQueryLocal: string | null };

/**
 * Jev's yes/no answers, when they settle the whole set: every want read
 * decisively, at least one yes, and no named place (a place needs a lookup,
 * which the model call does). Otherwise null: Haiku reads it.
 */
export function readingFromJev(readings: Readings | null): PriorityReading | null {
  if (!readings) return null;
  const decided = (p: number | null) => (p === null ? null : p >= SETTLE.noulYes ? true : p <= SETTLE.noulNo ? false : null);
  if (decided(readings.namesPlace) !== false) return null;
  const wants: Array<[PriorityKey, boolean | null]> = [
    ['cheapest', decided(readings.wantsPrice)],
    ['nicest', decided(readings.wantsQuality)],
    ['closest', decided(readings.wantsLocation)],
  ];
  if (wants.some(([, w]) => w === null)) return null;
  const picked = wants.filter(([, w]) => w).map(([k]) => k);
  return picked.length ? { priorities: picked, nearQuery: null, nearQueryLocal: null } : null;
}

const place = z
  .string()
  .transform((s) => s.replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(2).max(80))
  .nullish()
  .catch(null);

const raw = z
  .object({ priorities: z.array(z.string()).catch([]), near_place: place, near_place_local: place, no_preference: z.boolean().catch(false) })
  .passthrough();

/**
 * Haiku's record_priorities input, checked. Unknown keys are dropped; a
 * place to be near implies "closest". `null` when it says nothing usable, so
 * the question stays open instead of a guess being searched.
 */
export function validatePriorityReading(input: unknown): PriorityReading | null {
  const parsed = raw.safeParse(input);
  if (!parsed.success) return null;
  const r = parsed.data;
  const keys = r.priorities.filter((p): p is PriorityKey => (PRIORITY_KEYS as readonly string[]).includes(p));
  const nearQuery = r.near_place ?? null;
  const priorities = canonicalPriorities(nearQuery ? [...keys, 'closest'] : keys);
  if (priorities.length === 0) return r.no_preference ? { priorities: [], nearQuery: null, nearQueryLocal: null } : null;
  return { priorities, nearQuery, nearQueryLocal: nearQuery ? (r.near_place_local ?? null) : null };
}
