import 'server-only';
import { z } from 'zod';

import { canonicalPriorities, PRIORITY_KEYS } from '@/lib/finder/rank';
import { nightsBetween } from '@/lib/finder/geo';
import { placeName } from '@/lib/finder/searchPlan';
import { inferNationality } from '@/lib/nationality';
import type { PriorityReading } from '@/lib/priorityReading';
import { reduce } from '@/lib/store/reduce';
import { copy } from '@/lib/i18n';
import { INTL, type Locale } from '@/lib/i18n/locale';
import { formatDates, formatGuests, formatMoney, mustHaveLabel, nearLabel, nearMissLine, outcomeLine, prioritiesLabel, prioritiesLine } from '@/lib/replies';
import type { ScannedTrip } from '@/lib/scannedTrip';
import { MAX_NIGHTS } from '@/lib/store/reduce';
import { dispatchActions, resolveDestination, toSearchState } from '@/server/dispatch';
import type { FinderOutcome } from '@/server/finder';
import { appendMessage, type ChatMessage } from '@/server/repos/chat';
import { pennyLine, pennyPick } from '@/lib/pennyPick';
import { SPONSORED_HOTELS } from '@/lib/sponsors';
import { listShortlist } from '@/server/repos/shortlist';
import { addStay, audienceFor, getSession, listStays, updateSession, updateStay, type SearchSession, type Stay } from '@/server/repos/sessions';
import type { SupplierAdapter } from '@/server/supplier';
import { isoDate } from '@/lib/isoDate';

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


/** The ONE payload the form endpoint accepts. */
export const formAnswerSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('destination'), placeId: z.string().min(1).max(400), label: z.string().min(1).max(200) }).strict(),
  z.object({ field: z.literal('dates'), checkIn: isoDate, checkOut: isoDate }).strict(),
  z
    .object({
      field: z.literal('guests'),
      adults: z.number().int().min(1).max(12),
      childrenAges: z.array(z.number().int().min(0).max(17)).max(8),
      /** null = not said: the finder prices the cheapest split of the party. */
      rooms: z.number().int().min(1).max(6).nullable(),
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


/** The first thing still unknown, or null when the search can run. */
export function nextField(session: SearchSession, stay: Stay | null, guestsAnswered: boolean): Field | null {
  if (!stay && !session.draft.destination) return 'destination';
  if (!stay) return 'dates';
  if (!guestsAnswered) return 'guests';
  if (session.priorities === null) return 'priorities';
  return null;
}

export async function askQuestion(sessionId: string, field: Field, extra: Record<string, unknown> = {}, locale: Locale = 'en') {
  return appendMessage({
    sessionId,
    role: 'assistant',
    kind: 'form_question',
    content: copy(locale).onboarding.question[field],
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

/** "3 nights in March", "2 nights", "some nights in March": what the words said about when, short of two dates. */
export function hintText(hint: { nights?: number; month?: string; checkIn?: string }, locale: Locale = 'en'): string {
  if (hint.checkIn) {
    // "From next Monday": the day the words gave, with no length (2026-11-13).
    const from = new Intl.DateTimeFormat(INTL[locale].date, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${hint.checkIn}T00:00:00Z`));
    return copy(locale).onboarding.hintFrom(hint.nights, from);
  }
  const month = hint.month ? new Intl.DateTimeFormat(INTL[locale].date, { month: 'long', timeZone: 'UTC' }).format(new Date(`${hint.month}-01T00:00:00Z`)) : null;
  return copy(locale).onboarding.hint(hint.nights, month);
}

/** What was taken from the first message, so the user can see it and correct it. Only what will not be asked again. */
function understoodLine(scanned: ScannedTrip, datesTaken: boolean, currency: string, locale: Locale): string {
  const c = copy(locale);
  const parts: string[] = [];
  if (datesTaken && scanned.checkIn && scanned.checkOut) parts.push(formatDates(scanned.checkIn, scanned.checkOut, locale));
  else if (scanned.datesHint) parts.push(hintText(scanned.datesHint, locale));
  if (scanned.guests) parts.push(formatGuests(scanned.guests.adults, scanned.guests.childrenAges, scanned.guests.rooms, locale));
  if (scanned.priceCapMinor) parts.push(c.onboarding.upToANight(formatMoney(scanned.priceCapMinor, currency, locale)));
  for (const m of scanned.mustHaves ?? []) parts.push(mustHaveLabel(m, locale));
  if (scanned.priorities?.length) parts.push(prioritiesLabel(scanned.priorities, c.words.theCentre, locale).toLowerCase());
  return parts.length ? c.onboarding.fromYourMessage(parts.join(' · ')) : '';
}

export type FormError = 'wrong_step' | 'dates_in_past' | 'checkout_not_after_checkin' | 'stay_too_long' | 'more_rooms_than_adults' | 'not_onboarding';

export type FormResult = { ok: true; done: boolean } | { ok: false; error: FormError; expected?: Field | null };

function answerText(answer: FormAnswer, locale: Locale): string {
  const c = copy(locale);
  switch (answer.field) {
    case 'destination':
      return answer.label;
    case 'dates':
      return formatDates(answer.checkIn, answer.checkOut, locale);
    case 'guests':
      return `${formatGuests(answer.adults, answer.childrenAges, answer.rooms, locale)}${answer.pets ? c.words.withPet : ''}`;
    case 'priorities':
      return answer.priorities.length === 0 ? c.onboarding.noPreference : prioritiesLabel(answer.priorities, c.words.theCentre, locale);
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
  /** The language of every line this writes. English when absent. */
  locale?: Locale;
  /**
   * What the words alone said, for the "From your message" line. The draft's
   * scanned trip also holds the pills and the 2-adult default, which the line
   * then claimed the message said (e2e, 2026-11-13).
   */
  words?: ScannedTrip;
}): Promise<FormResult> {
  const { sessionId, answer, supplier, now, today } = args;
  const L = args.locale ?? 'en';
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
      // Only what the words said: the draft also holds the pills and the 2-adult default (2026-11-13).
      understood = understoodLine(args.words ?? session.draft.words ?? {}, stay !== null, session.currency, L);
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
      if (answer.rooms !== null && answer.rooms > answer.adults) return { ok: false, error: 'more_rooms_than_adults' };
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
  else await appendMessage({ sessionId, role: 'user', kind: 'form_answer', content: answerText(answer, L), meta: { field: answer.field } });
  if (understood) await appendMessage({ sessionId, role: 'assistant', kind: 'line', content: understood, meta: { scanned: true } });

  const next = nextField(current, stay, guestsAnswered);
  if (next) {
    await askQuestion(sessionId, next, questionExtra(next, stay, current, L), L);
    return { ok: true, done: false };
  }

  // Everything is known: the first search. Its real outcome is what gets said.
  current = (await updateSession(sessionId, { status: 'active' }))!;
  const dispatched = await dispatchActions({ session: current, stay: stay!, actions: [], supplier, now, today, alwaysRun: true });
  const line = firstSearchLine(dispatched.finder, L);
  await appendMessage({
    sessionId,
    role: 'assistant',
    kind: 'line',
    content: line,
    meta: { finder: dispatched.finder?.kind ?? null },
  });
  await sayPennysPick(current, stay!, dispatched.finder, L);
  return { ok: true, done: true };
}

/** What a question's control needs to say: the priorities card names where "close" means. */
export function questionExtra(field: Field, stay: Stay | null, session?: SearchSession, locale: Locale = 'en'): Record<string, unknown> {
  if (field === 'dates') {
    // The words said "3 nights in March": open the card there, with that length.
    const hint = session?.draft.scanned?.datesHint;
    if (!hint) return {};
    // With a length one tap sets the stay; without one the card takes two taps.
    const prompt = hint.checkIn ? copy(locale).onboarding.whichHintFrom(hintText(hint, locale)) : copy(locale).onboarding.whichHint(hintText(hint, locale), Boolean(hint.nights));
    return { ...hint, prompt };
  }
  if (field !== 'priorities' || !stay) return {};
  return { near: nearLabel({ destinationText: stay.destinationText, destKind: stay.destKind, near: null }, locale) };
}

/** The stay's destination columns, from the point looked up when the destination was answered. */
function destFields(session: SearchSession) {
  const point = session.draft.destination?.point;
  return point
    ? { destLatitude: point.latitude, destLongitude: point.longitude, destKind: point.kind, destCountry: point.country }
    : {};
}

const kmOf = (reason: unknown): number | null => {
  const km = (reason as { distance_km?: unknown } | null)?.distance_km;
  return typeof km === 'number' ? km : null;
};

/** After a first search that found a lot: Penny names one and asks which appeals (lib/pennyPick.ts). */
async function sayPennysPick(session: SearchSession, stay: Stay, outcome: FinderOutcome | null, locale: Locale) {
  if (outcome?.kind !== 'ok') return;
  const rows = (await listShortlist(session.id, stay.id, audienceFor(session)))
    // Penny names a hotel that fits, never one shown only to fill the list.
    // Unreachable today (she picks at PICK_MIN_FITS = 8 fits; near-misses appear
    // below MIN_SHOWN = 5), so no test exercises it: it is a backstop.
    .filter((r) => r.entry.source === 'finder' && r.offer && r.entry.reason?.kind !== 'near_miss')
    .map((r) => ({
      propertyId: r.property.id,
      supplierHotelId: r.property.supplierHotelId,
      name: r.property.name,
      totalMinor: r.offer!.totalMinor,
      currency: r.offer!.currency,
      rating: r.property.rating,
      km: kmOf(r.entry.reason),
    }));
  const pick = pennyPick(rows, outcome.eligible, SPONSORED_HOTELS, locale);
  if (!pick) return;
  await appendMessage({
    sessionId: session.id,
    role: 'assistant',
    kind: 'line',
    content: pennyLine(outcome.eligible, pick, locale),
    meta: { pennyPick: { propertyId: pick.propertyId, sponsored: pick.sponsored } },
  });
}

/** What the first search found, in one line. */
export function firstSearchLine(outcome: FinderOutcome | null, locale: Locale = 'en'): string {
  const c = copy(locale);
  if (outcome?.kind === 'ok' && outcome.eligible > 0) {
    const considered = outcome.eligible + Object.values(outcome.rejected).reduce((a, b) => a + b, 0);
    const best = outcome.shortlisted === 1 ? c.onboarding.listedFirst : c.onboarding.bestListed(outcome.shortlisted);
    return `${c.replies.fit(outcome.eligible, considered)} ${best}${nearMissLine(outcome.nearMisses, outcome.eligible, locale)}`;
  }
  return outcomeLine(outcome, locale);
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
  locale?: Locale;
}): Promise<FormResult & { near: 'set' | 'not_found' | 'too_far' | 'lookup_failed' | null }> {
  const { sessionId, reading, supplier } = args;
  const L = args.locale ?? 'en';
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

  const o = copy(L).onboarding;
  const label = nearName ?? nearLabel({ destinationText: stay.destinationText, destKind: stay.destKind, near: null }, L);
  const words = reading.priorities.length === 0 ? o.noPreferenceLine : prioritiesLine(reading.priorities, label, L);
  const missed =
    near === 'not_found' ? o.nearNotFound(reading.nearQuery ?? '', placeName(stay.destinationText), label)
    : near === 'too_far' ? o.nearTooFar(reading.nearQuery ?? '', placeName(stay.destinationText), label)
    : near === 'lookup_failed' ? o.nearLookupFailed(label)
    : '';
  const result = await answerForm({
    sessionId,
    answer: { field: 'priorities', priorities: reading.priorities },
    guestsAnswered: args.guestsAnswered,
    supplier,
    now: args.now,
    today: args.today,
    readBack: `${words}${missed}`,
    locale: L,
  });
  return { ...result, near };
}

/** Place types that are somewhere to stay, never somewhere to be near. */
const LODGING = ['lodging', 'hotel', 'hostel', 'campground', 'rv_park'];
