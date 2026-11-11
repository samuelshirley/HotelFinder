import 'server-only';
import { z } from 'zod';

import { PRIORITY_KEYS } from '@/lib/finder/rank';
import { nightsBetween } from '@/lib/finder/geo';
import { formatDates, formatGuests, formatMoney, MUST_HAVE_LABEL, outcomeLine, PRIORITY_LINE } from '@/lib/replies';
import type { ScannedTrip } from '@/lib/scannedTrip';
import { MAX_NIGHTS } from '@/lib/store/reduce';
import { dispatchActions } from '@/server/dispatch';
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
 * Order: destination → dates → guests → nationality → priority, then the
 * first search. Each answer is validated here, on the server, and must be the
 * answer to the question currently being asked.
 */

export const FIELDS = ['destination', 'dates', 'guests', 'nationality', 'priority'] as const;
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
  z.object({ field: z.literal('nationality'), code: z.string().regex(/^[A-Z]{2}$/) }).strict(),
  z.object({ field: z.literal('priority'), priority: z.enum(PRIORITY_KEYS) }).strict(),
]);
export type FormAnswer = z.infer<typeof formAnswerSchema>;

const QUESTION: Record<Field, string> = {
  destination: 'Where are you going?',
  dates: 'Which nights?',
  guests: 'Who is travelling?',
  nationality: 'Which country do you live in? Rates depend on it.',
  priority: 'What matters most?',
};

/** The first thing still unknown, or null when the search can run. */
export function nextField(session: SearchSession, stay: Stay | null, guestsAnswered: boolean): Field | null {
  if (!stay && !session.draft.destination) return 'destination';
  if (!stay) return 'dates';
  if (!guestsAnswered) return 'guests';
  if (!session.guestNationality) return 'nationality';
  if (!session.priority) return 'priority';
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
  if (scanned.priority) parts.push(PRIORITY_LINE[scanned.priority].replace(/\.$/, '').toLowerCase());
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
    case 'nationality':
      return new Intl.DisplayNames(['en'], { type: 'region' }).of(answer.code) ?? answer.code;
    case 'priority':
      return PRIORITY_LINE[answer.priority].replace(/\.$/, '');
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
    case 'destination':
      current = (await updateSession(sessionId, {
        draft: { ...session.draft, destination: { placeId: answer.placeId, label: answer.label } },
        ...(scanned.priority ? { priority: scanned.priority } : {}),
      }))!;
      // The first message already gave the nights: the dates question is not asked again.
      if (scanned.checkIn && scanned.checkOut && scanned.checkIn >= today) {
        stay = await addStay(sessionId, { destinationText: answer.label, placeId: answer.placeId, checkIn: scanned.checkIn, checkOut: scanned.checkOut, ...scannedStayFields(scanned) });
      }
      understood = understoodLine(scanned, stay !== null, session.currency);
      break;
    case 'dates': {
      if (answer.checkIn < today) return { ok: false, error: 'dates_in_past' };
      const nights = nightsBetween(answer.checkIn, answer.checkOut);
      if (!(nights >= 1)) return { ok: false, error: 'checkout_not_after_checkin' };
      if (nights > MAX_NIGHTS) return { ok: false, error: 'stay_too_long' };
      const destination = session.draft.destination!;
      stay = await addStay(sessionId, {
        destinationText: destination.label,
        placeId: destination.placeId,
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
    case 'nationality':
      current = (await updateSession(sessionId, { guestNationality: answer.code }))!;
      break;
    case 'priority':
      current = (await updateSession(sessionId, { priority: answer.priority }))!;
      break;
  }

  await appendMessage({ sessionId, role: 'user', kind: 'form_answer', content: answerText(answer), meta: { field: answer.field } });
  if (understood) await appendMessage({ sessionId, role: 'assistant', kind: 'line', content: understood, meta: { scanned: true } });

  const next = nextField(current, stay, guestsAnswered);
  if (next) {
    await askQuestion(sessionId, next);
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

/** What the first search found, in one line. */
export function firstSearchLine(outcome: FinderOutcome | null): string {
  if (outcome?.kind === 'ok' && outcome.eligible > 0) {
    const considered = outcome.eligible + Object.values(outcome.rejected).reduce((a, b) => a + b, 0);
    return `${outcome.eligible} of ${considered} hotels fit. The best ${outcome.shortlisted} are listed, each with the reason it is there.`;
  }
  return outcomeLine(outcome);
}
