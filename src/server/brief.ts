import 'server-only';
import { z } from 'zod';

import { canonicalPriorities, PRIORITY_KEYS } from '@/lib/finder/rank';
import type { ModelId } from '@/lib/models';
import { mentionsDates, pickPlace, whichOne } from '@/lib/placePick';
import { formatGuests } from '@/lib/replies';
import type { ScannedTrip } from '@/lib/scannedTrip';
import { MAX_NIGHTS } from '@/lib/store/reduce';
import { nightsBetween } from '@/lib/finder/geo';
import { scanIntent, type CallModel } from '@/server/agent';
import { logModelCalls } from '@/server/modelLedger';
import { answerForm, askQuestion } from '@/server/onboarding';
import { appendMessage } from '@/server/repos/chat';
import { updateSession, type SearchSession } from '@/server/repos/sessions';
import { aiBudget } from '@/server/spend';
import type { SupplierAdapter } from '@/server/supplier';

/**
 * The first screen (docs/entry-ux.md): one box for the whole trip, three
 * pills, optional priorities. One payload; each source fills what it can:
 *
 *  - a pill the user SET wins; a pill left alone is a default the words may
 *    override (2 adults, tonight);
 *  - the words go through the intent scan once, and only when there are words;
 *  - a picked place is used as is; a typed one is searched and picked by
 *    lib/placePick (ambiguous → "Which Lisbon?");
 *  - no dates anywhere → tonight, unless the words talk about when but did
 *    not give two dates ("3 nights in March") → the nights are asked.
 *
 * Then the existing onboarding steps run, so a search that has everything
 * goes straight to its first results.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const briefSchema = z
  .object({
    text: z.string().max(1000).default(''),
    place: z.object({ placeId: z.string().min(1).max(400), label: z.string().min(1).max(200) }).strict().nullable().default(null),
    /** Only when the user set the When pill. */
    dates: z.object({ checkIn: isoDate, checkOut: isoDate }).strict().nullable().default(null),
    /** Only when the user set the Who pill. */
    guests: z
      .object({
        adults: z.number().int().min(1).max(12),
        childrenAges: z.array(z.number().int().min(0).max(17)).max(8),
        rooms: z.number().int().min(1).max(6),
        pets: z.boolean(),
      })
      .strict()
      .nullable()
      .default(null),
    priorities: z
      .array(z.enum(PRIORITY_KEYS))
      .max(PRIORITY_KEYS.length)
      .refine((p) => new Set(p).size === p.length)
      .default([]),
  })
  .strict();
export type Brief = z.infer<typeof briefSchema>;

export type BriefError = 'empty_brief' | 'dates_in_past' | 'checkout_not_after_checkin' | 'stay_too_long' | 'more_rooms_than_adults';

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Checks the pills before anything is stored. Pure. */
export function checkBrief(brief: Brief, today: string): BriefError | null {
  if (!brief.text.trim() && !brief.place) return 'empty_brief';
  if (brief.dates) {
    if (brief.dates.checkIn < today) return 'dates_in_past';
    const nights = nightsBetween(brief.dates.checkIn, brief.dates.checkOut);
    if (!(nights >= 1)) return 'checkout_not_after_checkin';
    if (nights > MAX_NIGHTS) return 'stay_too_long';
  }
  if (brief.guests && brief.guests.rooms > brief.guests.adults) return 'more_rooms_than_adults';
  return null;
}

/** What the pills and the words add up to, before the place is known. Pure. */
export function mergeBrief(brief: Brief, scanned: ScannedTrip, today: string): { trip: ScannedTrip; priorities: (typeof PRIORITY_KEYS)[number][]; askDates: boolean } {
  const trip: ScannedTrip = {};
  if (brief.dates) {
    trip.checkIn = brief.dates.checkIn;
    trip.checkOut = brief.dates.checkOut;
  } else if (scanned.checkIn && scanned.checkOut) {
    trip.checkIn = scanned.checkIn;
    trip.checkOut = scanned.checkOut;
  }
  const askDates = !trip.checkIn && mentionsDates(brief.text);
  if (askDates && scanned.datesHint) trip.datesHint = scanned.datesHint;
  if (!trip.checkIn && !askDates) {
    trip.checkIn = today;
    trip.checkOut = addDays(today, 1);
  }
  trip.guests = brief.guests
    ? { adults: brief.guests.adults, childrenAges: brief.guests.childrenAges, rooms: brief.guests.rooms }
    : (scanned.guests ?? { adults: 2, childrenAges: [], rooms: 1 });
  const musts = new Set([...(scanned.mustHaves ?? []), ...(brief.guests?.pets ? (['pets_allowed'] as const) : [])]);
  if (brief.guests && !brief.guests.pets) musts.delete('pets_allowed');
  if (musts.size) trip.mustHaves = [...musts];
  if (scanned.priceCapMinor) trip.priceCapMinor = scanned.priceCapMinor;
  const priorities = canonicalPriorities(brief.priorities.length ? brief.priorities : (scanned.priorities ?? []));
  return { trip, priorities, askDates };
}

export async function startFromBrief(args: {
  session: SearchSession;
  brief: Brief;
  supplier: SupplierAdapter;
  callModel: CallModel;
  model: ModelId;
  now: Date;
  today: string;
}): Promise<{ ok: true } | { ok: false; error: BriefError }> {
  const { session, brief, supplier, now, today } = args;
  const bad = checkBrief(brief, today);
  if (bad) return { ok: false, error: bad };

  const text = brief.text.trim();
  await appendMessage({ sessionId: session.id, role: 'user', kind: 'user', content: text || bubble(brief) });

  // The words, read once. A bare picked place has none: no model call.
  let scanned: ScannedTrip = {};
  if (text) {
    const budget = await aiBudget(session.id, now);
    if (budget.ok) {
      const scan = await scanIntent({ message: text, today, currency: session.currency, callModel: args.callModel, model: args.model });
      await logModelCalls(session, 'scan', [scan.reply]);
      scanned = scan.trip;
    }
  }
  const { trip, priorities, askDates } = mergeBrief(brief, scanned, today);
  await updateSession(session.id, { draft: { ...session.draft, scanned: trip, words: scanned }, priorities });

  const place = brief.place ?? (await findPlace(supplier, scanned.destination ?? text));
  if (place === 'unavailable') {
    await appendMessage({ sessionId: session.id, role: 'assistant', kind: 'line', content: 'The place search did not answer. Type the place again.' });
    await askQuestion(session.id, 'destination');
    return { ok: true };
  }
  if (place === null || 'ask' in place) {
    await askQuestion(session.id, 'destination', place ? place.ask : {});
    return { ok: true };
  }

  // The rest is the onboarding the form already runs: the stay, the nights if
  // missing, then the first search.
  const result = await answerForm({
    sessionId: session.id,
    answer: { field: 'destination', placeId: place.placeId, label: place.label },
    guestsAnswered: true,
    supplier,
    now,
    today,
    // Pills only: the user's bubble already says it all. Words: say which place they were read as.
    quiet: !text,
    readBack: text ? `Searching ${place.label}.` : undefined,
    words: scanned,
  });
  // When the nights are missing (askDates), answerForm has just asked for them.
  if (!result.ok) throw new Error(`brief: destination step refused (${result.error})`);
  return { ok: true };
}

type Found = { placeId: string; label: string } | { ask: ReturnType<typeof whichOne> } | null | 'unavailable';

async function findPlace(supplier: SupplierAdapter, query: string): Promise<Found> {
  if (!query.trim()) return null;
  const places = await supplier.searchPlaces(query);
  if (!places.ok) return 'unavailable';
  const label = (p: { name: string; address: string | null }) => (p.address ? `${p.name}, ${p.address}` : p.name);
  const picked = pickPlace(query, places.value);
  if (picked.kind === 'one') return { placeId: picked.place.placeId, label: label(picked.place) };
  if (picked.kind === 'ask') return { ask: whichOne(picked.places) };
  return null;
}

/** The user's bubble for a search made with the pills only. */
function bubble(brief: Brief): string {
  const parts = [brief.place?.label ?? ''];
  if (brief.guests) parts.push(`${formatGuests(brief.guests.adults, brief.guests.childrenAges, brief.guests.rooms)}${brief.guests.pets ? ', with a pet' : ''}`);
  return parts.filter(Boolean).join(' · ');
}
