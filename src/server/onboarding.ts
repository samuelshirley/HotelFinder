import 'server-only';
import { z } from 'zod';

import { canonicalPriorities, PRIORITY_KEYS } from '@/lib/finder/rank';
import { nightsBetween } from '@/lib/finder/geo';
import { placeName } from '@/lib/finder/searchPlan';
import { inferNationality } from '@/lib/nationality';
import type { PriorityReading } from '@/lib/priorityReading';
import { reduce } from '@/lib/store/reduce';
import { formatDates, formatGuests, formatMoney, MUST_HAVE_LABEL, nearLabel, outcomeLine, prioritiesLabel, prioritiesLine } from '@/lib/replies';
import type { ScannedTrip } from '@/lib/scannedTrip';
import { MAX_NIGHTS } from '@/lib/store/reduce';
import { dispatchActions, resolveDestination, toSearchState } from '@/server/dispatch';
import type { FinderOutcome } from '@/server/finder';
import { appendMessage, type ChatMessage } from '@/server/repos/chat';
import { addStay, getSession, listStays, updateSession, updateStay, type SearchSession, type Stay } from '@/server/repos/sessions';
import type { SupplierAdapter } from '@/server/supplier';

/**
 * Onboarding is a deterministic form inside the chat. Questions are chat rows
 * of kind `form_question` whose `meta` tells the client which control to
 * render; answers are `form_answer` rows. No model call: a new user's first
 * search costs nothing in AI.
 *
 * Order: destination → dates → guests → priorities, then the first search.
 * Each answer is validated here, on the server, and must be the answer to the
 * question currently being asked.
 *
 * The nationality used for rates is NOT a question (docs/onboarding.md §4):
 * it is inferred when the session is created (saved, browser, IP) or, failing
 * those, from the destination, and shown on the results as an editable chip.
 */

export const FIELDS = ['destination', 'dates', 'guests', 'priorities'] as const;
export type Field = (typeof FIELDS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The ONE payload the form endpoint accepts. */
export const formAnswerSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('destination'), placeId: z.string().min(1).max(400), label: z.string().min(1).max(200) }).strict(),
  z.object({ field: z.literal('dates'), checkIn: isoDate, checkOut: isoDate }).strict(),
  z
    .object({
      field: z.literal('guests'),
      adults: z.number().int().min(1).max(12),
      childrenAges: z.array(z.number().int().min(0).max(17)).max(8),
      rooms: z.number().int().min(1).max(6),
      /** Travelling with a pet: only hotels that take them are shown. */
      pets: z.boolean(),
    })
    .strict(),
  /** [] = no preference. A set: each key once, any order. */
  z
    .object({
      field: z.literal('priorities'),
      priorities: z
        .array(z.enum(PRIORITY_KEYS))
        .max(PRIORITY_KEYS.length)
        .refine((p) => new Set(p).size === p.length, 'each priority once'),
    })
    .strict(),
]);
export type FormAnswer = z.infer<typeof formAnswerSchema>;

const QUESTION: Record<Field, string> = {
  destination: 'Where are you going?',
  dates: 'Which nights?',
  guests: 'Who is travelling?',
  priorities: 'What matters most? Pick any, or say it in your own words.',
};

/** The first thing still unknown, or null when the search can run. */
export function nextField(session: SearchSession, stay: Stay | null, guestsAnswered: boolean): Field | null {
  if (!stay && !session.draft.destination) return 'destination';
  if (!stay) return 'dates';
  if (!guestsAnswered) return 'guests';
  if (session.priorities === null) return 'priorities';
  return null;
}

export async function askQuestion(sessionId: string, field: Field, extra: Record<string, unknown> = {}) {
  return appendMessage({
    sessionId,
    role: 'assistant',
    kind: 'form_question',
    content: QUESTION[field],
    meta: { field, ...extra },
  });
}

/** Has the party been stated, by the form or by the first message? The default of two adults is never assumed. */
export function guestsAnsweredIn(session: SearchSession, messages: ChatMessage[]): boolean {
  return session.draft.scanned?.guests !== undefined || messages.some((m) => m.kind === 'form_answer' && m.meta?.field === 'guests');
}

/** The parts of a scanned first message that live on the stay. */
function scannedStayFields(scanned: ScannedTrip) {
  return {
    ...(scanned.guests ?? {}),
    ...(scanned.priceCapMinor ? { priceCapMinor: scanned.priceCapMinor } : {}),
    ...(scanned.mustHaves ? { mustHaves: scanned.mustHaves } : {}),
  };
}

/** What was taken from the first message, so the user can see it and correct it. Only what will not be asked again. */
function understoodLine(scanned: ScannedTrip, datesTaken: boolean, currency: string): string {
  const parts: string[] = [];
  if (datesTaken && scanned.checkIn && scanned.checkOut) parts.push(formatDates(scanned.checkIn, scanned.checkOut));
  if (scanned.guests) parts.push(formatGuests(scanned.guests.adults, scanned.guests.childrenAges, scanned.guests.rooms));
  if (scanned.priceCapMinor) parts.push(`up to ${formatMoney(scanned.priceCapMinor, currency)} a night`);
  for (const m of scanned.mustHaves ?? []) parts.push(MUST_HAVE_LABEL[m]);
  if (scanned.priorities?.length) parts.push(prioritiesLabel(scanned.priorities, 'the centre').toLowerCase());
  return parts.length ? `From your message: ${parts.join(' · ')}.` : '';
}

export type FormError = 'wrong_step' | 'dates_in_past' | 'checkout_not_after_checkin' | 'stay_too_long' | 'more_rooms_than_adults' | 'not_onboarding';

export type FormResult = { ok: true; done: boolean } | { ok: false; error: FormError; expected?: Field | null };

function answerText(answer: FormAnswer): string {
  switch (answer.field) {
    case 'destination':
      return answer.label;
    case 'dates':
      return formatDates(answer.checkIn, answer.checkOut);
    case 'guests':
      return `${formatGuests(answer.adults, answer.childrenAges, answer.rooms)}${answer.pets ? ', with a pet' : ''}`;
    case 'priorities':
      return answer.priorities.length === 0 ? 'No preference' : prioritiesLabel(answer.priorities, 'the centre');
  }
}

/**
 * Apply one form answer. `guestsAnswered` is derived from the chat rows by
 * the caller (a guests answer exists), so the default party of two is never
 * silently assumed: the question is always asked once.
 */
export async function answerForm(args: {
  sessionId: string;
  answer: FormAnswer;
  guestsAnswered: boolean;
  supplier: SupplierAdapter;
  now: Date;
  today: string;
  /**
   * The answer was typed, so the user's own words are already in the chat.
   * Say how they were read instead of echoing a form answer.
   */
  readBack?: string;
  /**
   * The answer came from the first screen's pills, which the user's own bubble
   * already shows: no echo, and no "From your message" line for it.
   */
  quiet?: boolean;
}): Promise<FormResult> {
  const { sessionId, answer, supplier, now, today } = args;
  const session = await getSession(sessionId);
  if (!session || session.status !== 'onboarding') return { ok: false, error: 'not_onboarding' };
  let stay: Stay | null = (await listStays(sessionId))[0] ?? null;

  const expected = nextField(session, stay, args.guestsAnswered || session.draft.scanned?.guests !== undefined);
  if (expected !== answer.field) return { ok: false, error: 'wrong_step', expected };

  const scanned = session.draft.scanned ?? {};
  let guestsAnswered = args.guestsAnswered || scanned.guests !== undefined;
  let current = session;
  let understood = '';

  switch (answer.field) {
    case 'destination': {
      // The destination's own point, kind and country: where "close" is
      // measured from, whether to search a radius, and the last-resort nationality.
      const resolved = await resolveDestination(supplier, answer.placeId, answer.label);
      const point = resolved ? { latitude: resolved.latitude, longitude: resolved.longitude, kind: resolved.kind, country: resolved.country } : undefined;
      const inferred = session.guestNationality
        ? null
        : inferNationality({ saved: null, acceptLanguage: null, ipCountry: null, destinationCountry: resolved?.country ?? null });
      current = (await updateSession(sessionId, {
        draft: { ...session.draft, destination: { placeId: answer.placeId, label: answer.label, ...(point ? { point } : {}) } },
        ...(scanned.priorities ? { priorities: scanned.priorities } : {}),
        ...(inferred ? { guestNationality: inferred.code, nationalitySource: inferred.source } : {}),
      }))!;
      // The first message already gave the nights: the dates question is not asked again.
      if (scanned.checkIn && scanned.checkOut && scanned.checkIn >= today) {
        stay = await addStay(sessionId, { destinationText: answer.label, placeId: answer.placeId, ...destFields(current), checkIn: scanned.checkIn, checkOut: scanned.checkOut, ...scannedStayFields(scanned) });
      }
      understood = understoodLine(scanned, stay !== null, session.currency);
      break;
    }
    case 'dates': {
      if (answer.checkIn < today) return { ok: false, error: 'dates_in_past' };
      const nights = nightsBetween(answer.checkIn, answer.checkOut);
      if (!(nights >= 1)) return { ok: false, error: 'checkout_not_after_checkin' };
      if (nights > MAX_NIGHTS) return { ok: false, error: 'stay_too_long' };
      const destination = session.draft.destination!;
      stay = await addStay(sessionId, {
        destinationText: destination.label,
        placeId: destination.placeId,
        ...destFields(session),
        checkIn: answer.checkIn,
        checkOut: answer.checkOut,
        ...scannedStayFields(scanned),
      });
      break;
    }
    case 'guests':
      if (answer.rooms > answer.adults) return { ok: false, error: 'more_rooms_than_adults' };
      stay = await updateStay(stay!.id, sessionId, {
        adults: answer.adults,
        childrenAges: answer.childrenAges,
        rooms: answer.rooms,
        mustHaves: answer.pets ? [...new Set([...stay!.mustHaves, 'pets_allowed'])] : stay!.mustHaves.filter((m) => m !== 'pets_allowed'),
      });
      guestsAnswered = true;
      break;
    case 'priorities':
      current = (await updateSession(sessionId, { priorities: canonicalPriorities(answer.priorities) }))!;
      break;
  }

  if (args.quiet) understood = '';
  else if (args.readBack) await appendMessage({ sessionId, role: 'assistant', kind: 'line', content: args.readBack, meta: { field: answer.field, readBack: true } });
  else await appendMessage({ sessionId, role: 'user', kind: 'form_answer', content: answerText(answer), meta: { field: answer.field } });
  if (understood) await appendMessage({ sessionId, role: 'assistant', kind: 'line', content: understood, meta: { scanned: true } });

  const next = nextField(current, stay, guestsAnswered);
  if (next) {
    await askQuestion(sessionId, next, questionExtra(next, stay));
    return { ok: true, done: false };
  }

  // Everything is known: the first search. Its real outcome is what gets said.
  current = (await updateSession(sessionId, { status: 'active' }))!;
  const dispatched = await dispatchActions({ session: current, stay: stay!, actions: [], supplier, now, today, alwaysRun: true });
  const line = firstSearchLine(dispatched.finder);
  await appendMessage({
    sessionId,
    role: 'assistant',
    kind: 'line',
    content: line,
    meta: { finder: dispatched.finder?.kind ?? null },
  });
  return { ok: true, done: true };
}

/** What a question's control needs to say: the priorities card names where "close" means. */
export function questionExtra(field: Field, stay: Stay | null): Record<string, unknown> {
  if (field !== 'priorities' || !stay) return {};
  return { near: nearLabel({ destinationText: stay.destinationText, destKind: stay.destKind, near: null }) };
}

/** The stay's destination columns, from the point looked up when the destination was answered. */
function destFields(session: SearchSession) {
  const point = session.draft.destination?.point;
  return point
    ? { destLatitude: point.latitude, destLongitude: point.longitude, destKind: point.kind, destCountry: point.country }
    : {};
}

/** What the first search found, in one line. */
export function firstSearchLine(outcome: FinderOutcome | null): string {
  if (outcome?.kind === 'ok' && outcome.eligible > 0) {
    const considered = outcome.eligible + Object.values(outcome.rejected).reduce((a, b) => a + b, 0);
    return `${outcome.eligible} of ${considered} hotels fit. The best ${outcome.shortlisted} are listed, each with the reason it is there.`;
  }
  return outcomeLine(outcome);
}

/**
 * A typed answer to "what matters most?", already read (by Jev or Haiku) into
 * keys and, maybe, the words for a place to be near. The place is looked up
 * at the supplier: the destination's name is added so "old town" means this
 * town's, the local-language name is tried first, and lodging is never a
 * place to be near. A place that cannot be found or is another trip is said
 * plainly and the search runs without it.
 */
export async function answerPrioritiesInWords(args: {
  sessionId: string;
  reading: PriorityReading;
  guestsAnswered: boolean;
  supplier: SupplierAdapter;
  now: Date;
  today: string;
}): Promise<FormResult & { near: 'set' | 'not_found' | 'too_far' | 'lookup_failed' | null }> {
  const { sessionId, reading, supplier } = args;
  const session = await getSession(sessionId);
  const stay = session ? ((await listStays(sessionId))[0] ?? null) : null;
  if (!session || session.status !== 'onboarding' || !stay) return { ok: false, error: 'not_onboarding', near: null };
  if (nextField(session, stay, args.guestsAnswered) !== 'priorities') return { ok: false, error: 'wrong_step', expected: nextField(session, stay, args.guestsAnswered), near: null };

  let near: 'set' | 'not_found' | 'too_far' | 'lookup_failed' | null = null;
  let nearName: string | null = null;
  if (reading.nearQuery) {
    near = 'not_found';
    const town = placeName(stay.destinationText);
    // The local name first. Measured on the sandbox: "Old Town, Annecy" finds only a
    // hotel and "Annecy railway station" the bus station; "Vieille Ville" and
    // "Gare d'Annecy" find the right places.
    for (const words of [reading.nearQueryLocal, reading.nearQuery].filter((w): w is string => !!w)) {
      const found = await supplier.searchPlaces(`${words}, ${town}`);
      if (!found.ok) {
        near = 'lookup_failed';
        break;
      }
      const candidate = found.value.find((p) => !p.types.some((t) => LODGING.includes(t)));
      if (!candidate) continue;
      const point = await supplier.getPlace(candidate.placeId);
      if (!point.ok) {
        near = 'lookup_failed';
        break;
      }
      const next = reduce(toSearchState(session, stay), { type: 'set_near', near: { placeId: candidate.placeId, label: point.value.name, latitude: point.value.latitude, longitude: point.value.longitude } }, args.today);
      if (!next.ok) {
        near = next.rejection === 'near_too_far' ? 'too_far' : near;
        break;
      }
      const n = next.state.stay.near!;
      await updateStay(stay.id, sessionId, { latitude: n.latitude, longitude: n.longitude, nearPlaceId: n.placeId, nearLabel: n.label });
      near = 'set';
      nearName = n.label;
      break;
    }
  }

  const label = nearName ?? nearLabel({ destinationText: stay.destinationText, destKind: stay.destKind, near: null });
  const words = reading.priorities.length === 0 ? 'No preference: a balanced search.' : prioritiesLine(reading.priorities, label);
  const missed =
    near === 'not_found' ? ` "${reading.nearQuery}" was not found in ${placeName(stay.destinationText)}, so close means ${label}.`
    : near === 'too_far' ? ` "${reading.nearQuery}" is too far from ${placeName(stay.destinationText)}, so close means ${label}.`
    : near === 'lookup_failed' ? ` The place lookup did not answer, so close means ${label} for now.`
    : '';
  const result = await answerForm({
    sessionId,
    answer: { field: 'priorities', priorities: reading.priorities },
    guestsAnswered: args.guestsAnswered,
    supplier,
    now: args.now,
    today: args.today,
    readBack: `${words}${missed}`,
  });
  return { ...result, near };
}

/** Place types that are somewhere to stay, never somewhere to be near. */
const LODGING = ['lodging', 'hotel', 'hostel', 'campground', 'rv_park'];
