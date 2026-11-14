import { AMENITIES, type Amenity } from '@/lib/amenities';
import { copy } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/locale';
import { hotelAnswer, type HotelFacts } from '@/lib/answers';
import type { FactAsk } from '@/lib/router/route';
import { answerLine } from '@/lib/replies';

/**
 * The hotel page's FAQ: the questions the chat already answers without a
 * model, answered the same way. Each answer is `hotelAnswer` (lib/answers.ts)
 * over the rows, said by `answerLine` (lib/replies.ts), so the page and the
 * chat give the same words for the same row. A value the row does not hold is
 * "the listing does not say"; a missing facility list is unknown, never "no".
 *
 * Check-in and check-out are the two the chat does not template; they follow
 * the same rule over the supplier's listing, verbatim.
 */

export type FaqEntry = { id: string; question: string; answer: string; held: boolean };

export type FaqInput = {
  propertyId: string;
  name: string;
  /** The rate on screen. null when no price is held for these dates. */
  rate: {
    totalMinor: number;
    payAtPropertyMinor: number;
    currency: string;
    roomName: string | null;
    boardName: string | null;
    refundable: boolean | null;
    freeCancellationUntil: string | null;
  } | null;
  /** The property row's amenity list. null = the supplier sent none: unknown. */
  amenities: readonly Amenity[] | null;
  /** As the supplier writes them, e.g. "03:00 PM". */
  checkInFrom: string | null;
  checkOutUntil: string | null;
  nights: number;
  /** For money when no rate is held (nothing is priced then, but answerLine takes one). */
  currency: string;
  /** The page's language. English when left out. */
  locale?: Locale;
};

/** The rate questions first, then the stay's times, then the facilities. */
const RATE_QUESTIONS: Array<{ id: 'price' | 'cancellation' | 'breakfast' | 'room'; ask: FactAsk }> = [
  { id: 'price', ask: { fact: 'price' } },
  { id: 'cancellation', ask: { fact: 'cancellation' } },
  { id: 'breakfast', ask: { fact: 'breakfast' } },
  { id: 'room', ask: { fact: 'room' } },
];

export function hotelFaq(input: FaqInput): FaqEntry[] {
  const r = input.rate;
  const facts: HotelFacts = {
    propertyId: input.propertyId,
    name: input.name,
    // The page shows these in its header; the FAQ does not ask them.
    stars: null,
    rating: null,
    reviewCount: null,
    distanceKm: null,
    totalMinor: r?.totalMinor ?? null,
    payAtPropertyMinor: r?.payAtPropertyMinor ?? null,
    roomName: r?.roomName ?? null,
    boardName: r?.boardName ?? null,
    refundable: r ? r.refundable : null,
    freeCancellationUntil: r?.freeCancellationUntil ?? null,
    amenities: input.amenities,
  };
  const ctx = { nights: input.nights, distanceFrom: 'destination' as const, distanceLabel: null };
  const currency = r?.currency ?? input.currency;
  const locale = input.locale ?? 'en';
  const q = copy(locale).detail.faq;
  const said = (id: string, question: string, ask: FactAsk): FaqEntry => {
    const a = hotelAnswer(facts, ask, ctx);
    return { id, question, answer: answerLine(a, currency, locale), held: a.kind !== 'not_held' };
  };

  return [
    ...RATE_QUESTIONS.map(({ id, ask }) => said(id, q[id], ask)),
    timeEntry('check_in', q.checkIn, input.checkInFrom, (t) => q.checkInFrom(input.name, t), q.checkInNotHeld(input.name)),
    timeEntry('check_out', q.checkOut, input.checkOutUntil, (t) => q.checkOutBy(input.name, t), q.checkOutNotHeld(input.name)),
    ...AMENITIES.map((amenity) => said(amenity, q.amenity[amenity], { fact: 'facility', amenity })),
  ];
}

function timeEntry(id: string, question: string, value: string | null, line: (t: string) => string, notHeld: string): FaqEntry {
  const t = value?.trim();
  return t ? { id, question, answer: line(t), held: true } : { id, question, answer: notHeld, held: false };
}
