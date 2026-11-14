import { describe, expect, it } from 'vitest';

import { AMENITIES } from './amenities';
import { buildAnswer, type AnswerContext, type HotelFacts } from './answers';
import { hotelFaq, type FaqInput } from './hotelFaq';
import { answerLine } from './replies';
import type { FactAsk } from './router/route';

const BASE: FaqInput = {
  propertyId: 'p1',
  name: 'Vincci Porto',
  rate: {
    totalMinor: 31608,
    payAtPropertyMinor: 1200,
    currency: 'EUR',
    roomName: 'Vincci Room',
    boardName: 'Room Only',
    refundable: true,
    freeCancellationUntil: '2026-11-25T09:59:00.000Z',
  },
  amenities: ['wifi', 'lift', 'air_conditioning'],
  checkInFrom: '03:00 PM',
  checkOutUntil: '12:00 PM',
  nights: 2,
  currency: 'EUR',
};

const byId = (input: FaqInput) => Object.fromEntries(hotelFaq(input).map((e) => [e.id, e]));

/** What the chat says for the same row and the same question (server/turn.ts, `answer`). */
function chatLine(input: FaqInput, ask: FactAsk): string {
  const r = input.rate;
  const facts: HotelFacts = {
    propertyId: input.propertyId,
    name: input.name,
    stars: 4,
    rating: 8.6,
    reviewCount: 1200,
    distanceKm: 1.2,
    totalMinor: r?.totalMinor ?? null,
    payAtPropertyMinor: r?.payAtPropertyMinor ?? null,
    roomName: r?.roomName ?? null,
    boardName: r?.boardName ?? null,
    refundable: r ? r.refundable : null,
    freeCancellationUntil: r?.freeCancellationUntil ?? null,
    amenities: input.amenities,
  };
  const ctx: AnswerContext = {
    nights: input.nights,
    distanceFrom: 'destination',
    distanceLabel: null,
    search: { destinationText: 'Porto', checkIn: '2026-12-11', checkOut: '2026-12-13', adults: 2, childrenAges: [], rooms: 1, priceCapMinor: null, mustHaves: [], priorities: null, nearLabel: 'the centre' },
  };
  return answerLine(buildAnswer({ about: 'hotel', propertyId: input.propertyId, ...ask }, [facts], ctx)!, input.currency);
}

describe('the hotel FAQ', () => {
  it('asks the rate questions, the times and every facility the chat can check', () => {
    expect(hotelFaq(BASE).map((e) => e.id)).toEqual(['price', 'cancellation', 'breakfast', 'room', 'check_in', 'check_out', ...AMENITIES]);
  });

  it('answers in exactly the words the chat uses for the same row', () => {
    const faq = byId(BASE);
    const asks: Array<[string, FactAsk]> = [
      ['price', { fact: 'price' }],
      ['cancellation', { fact: 'cancellation' }],
      ['breakfast', { fact: 'breakfast' }],
      ['room', { fact: 'room' }],
      ...AMENITIES.map((amenity): [string, FactAsk] => [amenity, { fact: 'facility', amenity }]),
    ];
    for (const [id, ask] of asks) expect(faq[id].answer, id).toBe(chatLine(BASE, ask));
    for (const [id, ask] of asks) expect(byId({ ...BASE, rate: null, amenities: null })[id].answer, id).toBe(chatLine({ ...BASE, rate: null, amenities: null }, ask));
  });

  it('reads the values off the rows', () => {
    const faq = byId(BASE);
    expect(faq.price.answer).toBe('Vincci Porto: €316.08 for 2 nights, €158.04 a night, plus €12 paid at the hotel.');
    expect(faq.cancellation.answer).toBe('Vincci Porto: free cancellation until 25 Nov, 09:59 UTC.');
    expect(faq.breakfast.answer).toBe('Vincci Porto: breakfast is not included; the rate is Room Only.');
    expect(faq.check_in.answer).toBe('Vincci Porto: check-in from 03:00 PM.');
    expect(faq.check_out.answer).toBe('Vincci Porto: check-out by 12:00 PM.');
    expect(faq.wifi.answer).toBe('Vincci Porto lists wifi.');
    expect(faq.pets_allowed.answer).toBe('Vincci Porto does not list pets allowed.');
    expect(Object.values(faq).every((e) => e.held)).toBe(true);
  });

  it('no facility list is unknown, never "no": every facility says the listing does not say', () => {
    const faq = hotelFaq({ ...BASE, amenities: null }).filter((e) => (AMENITIES as readonly string[]).includes(e.id));
    expect(faq).toHaveLength(AMENITIES.length);
    for (const e of faq) {
      expect(e.held, e.id).toBe(false);
      expect(e.answer, e.id).toMatch(/^The listing for Vincci Porto does not say whether it has /);
      expect(e.answer, e.id).not.toMatch(/does not list/);
    }
    // An empty list is known: the hotel lists none of them.
    expect(byId({ ...BASE, amenities: [] }).pool).toMatchObject({ held: true, answer: 'Vincci Porto does not list a pool.' });
  });

  it('with no rate held, the rate questions say so and invent nothing', () => {
    const faq = byId({ ...BASE, rate: null });
    expect(faq.price).toMatchObject({ held: false, answer: 'No price is held for Vincci Porto on these dates.' });
    expect(faq.cancellation).toMatchObject({ held: false, answer: 'The listing for Vincci Porto does not say whether it can be cancelled.' });
    expect(faq.breakfast).toMatchObject({ held: false, answer: 'The listing for Vincci Porto does not say which meals are included.' });
    expect(faq.room).toMatchObject({ held: false });
  });

  it('a refundable rate with no deadline does not make one up; a rate with no board is not guessed', () => {
    const faq = byId({ ...BASE, rate: { ...BASE.rate!, freeCancellationUntil: null, boardName: null } });
    expect(faq.cancellation.answer).toBe('Vincci Porto: refundable, but the listing does not give the deadline.');
    expect(faq.breakfast.held).toBe(false);
    expect(byId({ ...BASE, rate: { ...BASE.rate!, refundable: false } }).cancellation.answer).toBe('Vincci Porto: non-refundable at this price.');
  });

  it('times the listing does not give say so, and blank is not a time', () => {
    for (const blank of [null, '', '   ']) {
      const faq = byId({ ...BASE, checkInFrom: blank, checkOutUntil: blank });
      expect(faq.check_in).toMatchObject({ held: false, answer: 'The listing for Vincci Porto does not say when check-in starts.' });
      expect(faq.check_out).toMatchObject({ held: false, answer: 'The listing for Vincci Porto does not say the check-out time.' });
    }
  });

  it('every unanswered question says the listing does not say, or that no price is held', () => {
    for (const e of hotelFaq({ ...BASE, rate: null, amenities: null, checkInFrom: null, checkOutUntil: null })) {
      expect(e.held, e.id).toBe(false);
      expect(e.answer, e.id).toMatch(/does not say|No price is held|does not name the room/);
    }
  });
});

describe('the hotel FAQ in Spanish', () => {
  const es = byId({ ...BASE, locale: 'es' });

  it('asks the same questions, in Spanish, and answers in the words the Spanish chat uses', () => {
    expect(hotelFaq({ ...BASE, locale: 'es' }).map((e) => e.id)).toEqual(hotelFaq(BASE).map((e) => e.id));
    expect(es.price.question).toBe('¿Cuánto cuesta en estas fechas?');
    expect(es.pool.question).toBe('¿Hay piscina?');
    expect(es.price.answer).toBe('Vincci Porto: 316,08 € por 2 noches, 158,04 € por noche, más 12 € a pagar en el hotel.');
    expect(es.check_in.answer).toBe('Vincci Porto: entrada desde las 03:00 PM.');
    expect(es.wifi.answer).toBe('Vincci Porto indica wifi.');
    // A noun where the sentence needs one: never "indica que admita mascotas" (the e2e run, 2026-11-14).
    expect(byId({ ...BASE, amenities: ['pets_allowed'], locale: 'es' }).pets_allowed.answer).toBe('Vincci Porto indica admisión de mascotas.');
    expect(byId({ ...BASE, amenities: null, locale: 'es' }).pets_allowed.answer).toBe('El anuncio de Vincci Porto no dice si tiene admisión de mascotas.');
  });

  it('no Spanish question or answer is the English one', () => {
    const en = byId(BASE);
    for (const [id, e] of Object.entries(es)) {
      expect(e.question, id).not.toBe(en[id].question);
      expect(e.answer, id).not.toBe(en[id].answer);
    }
  });

  it('what the listing does not hold is said in Spanish too', () => {
    const silent = byId({ ...BASE, rate: null, amenities: null, checkInFrom: null, checkOutUntil: null, locale: 'es' });
    expect(silent.check_out).toMatchObject({ held: false, answer: 'El anuncio de Vincci Porto no dice la hora de salida.' });
    expect(silent.price).toMatchObject({ held: false, answer: 'No hay precio para Vincci Porto en estas fechas.' });
  });
});
