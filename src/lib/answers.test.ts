import { describe, expect, it } from 'vitest';

import { buildAnswer, hotelAnswer, rankHotels, type AnswerContext, type HotelFacts } from './answers';
import { HOTEL_FACTS, SEARCH_FIELDS, SUPERLATIVES } from './router/catalogue';
import type { FactAsk } from './router/route';
import { answerLine, listNames } from './replies';

const P = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`;
const hotel = (over: Partial<HotelFacts> = {}): HotelFacts => ({
  propertyId: P(1),
  name: 'YOTEL Porto',
  stars: 4,
  rating: 8.7,
  reviewCount: 9333,
  totalMinor: 12793,
  payAtPropertyMinor: 1936,
  roomName: 'Premium Queen',
  boardName: 'Room Only',
  refundable: false,
  freeCancellationUntil: null,
  distanceKm: 1,
  amenities: ['parking', 'wifi'],
  ...over,
});
/** A row that says nothing beyond its name. */
const silent = (over: Partial<HotelFacts> = {}): HotelFacts =>
  hotel({ stars: null, rating: null, reviewCount: null, totalMinor: null, payAtPropertyMinor: null, roomName: null, boardName: null, refundable: null, distanceKm: null, amenities: null, ...over });

const ctx: AnswerContext = {
  nights: 2,
  distanceFrom: 'search_centre',
  distanceLabel: null,
  search: { destinationText: 'Porto, Portugal', checkIn: '2026-12-11', checkOut: '2026-12-13', adults: 2, childrenAges: [], rooms: 1, priceCapMinor: null, mustHaves: [], priorities: ['cheapest'], nearLabel: 'central Porto' },
};
const say = (h: HotelFacts, ask: FactAsk) => answerLine(hotelAnswer(h, ask, ctx), 'EUR');

describe('one fact about one hotel, from its row', () => {
  it('price: the total, the per-night figure rounded up as on the card, and what is paid at the hotel', () => {
    expect(say(hotel(), { fact: 'price' })).toBe('YOTEL Porto: €127.93 for 2 nights, €63.97 a night, plus €19.36 paid at the hotel.');
    expect(say(hotel({ payAtPropertyMinor: 0, totalMinor: 20000 }), { fact: 'price' })).toBe('YOTEL Porto: €200 for 2 nights, €100 a night.');
    expect(hotelAnswer(hotel({ totalMinor: 12793 }), { fact: 'price' }, ctx)).toMatchObject({ perNightMinor: 6397 });
  });

  it('cancellation: non-refundable, a deadline, or refundable with no deadline given', () => {
    expect(say(hotel(), { fact: 'cancellation' })).toBe('YOTEL Porto: non-refundable at this price.');
    expect(say(hotel({ refundable: true, freeCancellationUntil: '2026-12-10T09:59:00.000Z' }), { fact: 'cancellation' })).toBe('YOTEL Porto: free cancellation until 10 Dec, 09:59 UTC.');
    expect(say(hotel({ refundable: true }), { fact: 'cancellation' })).toBe('YOTEL Porto: refundable, but the listing does not give the deadline.');
    // A deadline that is not a date is not printed, and does not throw.
    expect(say(hotel({ refundable: true, freeCancellationUntil: 'soon' }), { fact: 'cancellation' })).toBe('YOTEL Porto: refundable, but the listing does not give the deadline.');
    // A non-refundable rate never shows a deadline, whatever the row carries.
    expect(hotelAnswer(hotel({ refundable: false, freeCancellationUntil: '2026-12-10T09:59:00.000Z' }), { fact: 'cancellation' }, ctx)).toMatchObject({ until: null });
  });

  it('breakfast follows the board name, by the same rule the must-have filter uses', () => {
    expect(say(hotel(), { fact: 'breakfast' })).toBe('YOTEL Porto: breakfast is not included; the rate is Room Only.');
    expect(say(hotel({ boardName: 'Half Board' }), { fact: 'breakfast' })).toBe('YOTEL Porto: breakfast is included (Half Board).');
    expect(hotelAnswer(hotel({ boardName: 'Room Only (breakfast available at a surcharge)' }), { fact: 'breakfast' }, ctx)).toMatchObject({ included: false });
  });

  it('rating, stars, room and distance', () => {
    expect(say(hotel(), { fact: 'rating' })).toBe('YOTEL Porto: rated 8.7 from 9,333 reviews.');
    expect(say(hotel({ reviewCount: null }), { fact: 'rating' })).toBe('YOTEL Porto: rated 8.7; the listing gives no review count.');
    expect(say(hotel(), { fact: 'stars' })).toBe('YOTEL Porto: 4 stars.');
    expect(say(hotel({ stars: 1 }), { fact: 'stars' })).toBe('YOTEL Porto: 1 star.');
    expect(say(hotel(), { fact: 'room' })).toBe('YOTEL Porto: the price is for Premium Queen.');
    expect(say(hotel(), { fact: 'distance' })).toBe('YOTEL Porto: 1.0 km from the middle of the results.');
    expect(answerLine(hotelAnswer(hotel({ distanceKm: 0.4 }), { fact: 'distance' }, { ...ctx, distanceFrom: 'place' }), 'EUR')).toBe('YOTEL Porto: 400 m from the place you named.');
    expect(answerLine(hotelAnswer(hotel({ distanceKm: 0.4 }), { fact: 'distance' }, { ...ctx, distanceFrom: 'place', distanceLabel: 'Ribeira' }), 'EUR')).toBe('YOTEL Porto: 400 m from Ribeira.');
    expect(answerLine(hotelAnswer(hotel({ distanceKm: 1.5 }), { fact: 'distance' }, { ...ctx, distanceFrom: 'destination', distanceLabel: 'Porto Airport (OPO)' }), 'EUR')).toBe('YOTEL Porto: 1.5 km from Porto Airport (OPO).');
  });

  it('a facility is what the supplier lists: listed, not listed, or no list at all', () => {
    expect(say(hotel(), { fact: 'facility', amenity: 'parking' })).toBe('YOTEL Porto lists parking.');
    expect(say(hotel(), { fact: 'facility', amenity: 'pool' })).toBe('YOTEL Porto does not list a pool.');
    // No list is not "no pool".
    expect(say(hotel({ amenities: null }), { fact: 'facility', amenity: 'pool' })).toBe('The listing for YOTEL Porto does not say whether it has a pool.');
    // An empty list is a list.
    expect(say(hotel({ amenities: [] }), { fact: 'facility', amenity: 'pool' })).toBe('YOTEL Porto does not list a pool.');
  });

  it('a row that is silent gets "does not say" for every fact, never a value', () => {
    const asks: FactAsk[] = HOTEL_FACTS.map((fact) => (fact === 'facility' ? { fact, amenity: 'parking' } : { fact }));
    for (const ask of asks) {
      const answer = hotelAnswer(silent(), ask, ctx);
      expect(answer).toEqual({ kind: 'not_held', name: 'YOTEL Porto', ask });
      const line = answerLine(answer, 'EUR');
      expect(line).toMatch(/does not|No price is held/);
      expect(line).not.toMatch(/\d/);
    }
  });
});

const five = [
  hotel(),
  hotel({ propertyId: P(2), name: 'Mercure Santa Catarina', rating: 8.6, reviewCount: 2359, totalMinor: 14459, refundable: true, distanceKm: 0.4, amenities: ['wifi'] }),
  hotel({ propertyId: P(3), name: 'Hotel Carris', rating: 8.4, reviewCount: 9474, totalMinor: 16691, refundable: true, distanceKm: 0.5, amenities: [], stars: 5 }),
];

describe('which of the hotels on screen', () => {
  it('names the winner and its value', () => {
    const line = (s: (typeof SUPERLATIVES)[number]) => answerLine(buildAnswer({ about: 'ranking', superlative: s }, five, ctx)!, 'EUR');
    expect(line('cheapest')).toBe('Cheapest of the 3 listed: YOTEL Porto, €127.93 for 2 nights.');
    expect(line('priciest')).toBe('Most expensive of the 3 listed: Hotel Carris, €166.91 for 2 nights.');
    expect(line('closest')).toBe('Closest of the 3 listed: Mercure Santa Catarina, 400 m from the middle of the results.');
    expect(line('furthest')).toBe('Furthest of the 3 listed: YOTEL Porto, 1.0 km from the middle of the results.');
    expect(line('best_rated')).toBe('Best rated of the 3 listed: YOTEL Porto, rated 8.7 from 9,333 reviews.');
    expect(line('most_reviews')).toBe('Most reviews of the 3 listed: Hotel Carris, 9,474 reviews.');
    expect(line('most_stars')).toBe('Most stars of the 3 listed: Hotel Carris, 5 stars.');
  });

  it('a tie names every hotel in it and does not borrow one hotel\'s review count', () => {
    const tied = [hotel(), hotel({ propertyId: P(2), name: 'B', reviewCount: 10 }), hotel({ propertyId: P(3), name: 'C', rating: 8 })];
    expect(answerLine(buildAnswer({ about: 'ranking', superlative: 'best_rated' }, tied, ctx)!, 'EUR')).toBe('Best rated of the 3 listed, tied: YOTEL Porto and B, rated 8.7.');
    expect(rankHotels(tied, 'cheapest').winners).toHaveLength(3);
  });

  it('a hotel with no value is left out and counted, not ranked as zero', () => {
    const rows = [hotel({ rating: null }), hotel({ propertyId: P(2), name: 'B', rating: 7 }), hotel({ propertyId: P(3), name: 'C', totalMinor: null, rating: null })];
    expect(answerLine(buildAnswer({ about: 'ranking', superlative: 'best_rated' }, rows, ctx)!, 'EUR')).toBe('Best rated of the 3 listed: B, rated 7 from 9,333 reviews. 2 have no guest rating listed.');
    expect(answerLine(buildAnswer({ about: 'ranking', superlative: 'cheapest' }, rows, ctx)!, 'EUR')).toMatch(/1 has no price listed\.$/);
    expect(rankHotels(rows, 'cheapest').winners.map((w) => w.name)).not.toContain('C');
    expect(answerLine(buildAnswer({ about: 'ranking', superlative: 'most_stars' }, [silent(), silent({ propertyId: P(2) })], ctx)!, 'EUR')).toBe('None of the 2 listed has a star category in its listing.');
  });

  it('"at the cheapest": the fact is read from the single winner; a tie has no single winner', () => {
    expect(buildAnswer({ about: 'hotel_by_rank', superlative: 'closest', fact: 'breakfast' }, five, ctx)).toMatchObject({ kind: 'breakfast', name: 'Mercure Santa Catarina' });
    expect(buildAnswer({ about: 'hotel_by_rank', superlative: 'cheapest', fact: 'breakfast' }, [hotel(), hotel({ propertyId: P(2), name: 'B' })], ctx)).toBeNull();
    expect(buildAnswer({ about: 'hotel_by_rank', superlative: 'cheapest', fact: 'breakfast' }, [silent()], ctx)).toBeNull();
  });

  it('a fact asked of all of them sorts every hotel into yes, no or not said', () => {
    const rows = [...five, silent({ propertyId: P(4), name: 'Quiet Inn' })];
    expect(answerLine(buildAnswer({ about: 'all', fact: 'facility', amenity: 'parking' }, rows, ctx)!, 'EUR')).toBe(
      'Listing parking: YOTEL Porto. Not listing it: Mercure Santa Catarina and Hotel Carris. The listing does not say for Quiet Inn.',
    );
    expect(answerLine(buildAnswer({ about: 'all', fact: 'cancellation' }, rows, ctx)!, 'EUR')).toBe(
      'Refundable: Mercure Santa Catarina and Hotel Carris. Non-refundable: YOTEL Porto. The listing does not say for Quiet Inn.',
    );
    expect(answerLine(buildAnswer({ about: 'all', fact: 'breakfast' }, five, ctx)!, 'EUR')).toBe('Not included: YOTEL Porto, Mercure Santa Catarina and Hotel Carris.');
  });

  it('a hotel that is no longer on screen, or an empty screen, has no answer', () => {
    expect(buildAnswer({ about: 'hotel', propertyId: P(9), fact: 'price' }, five, ctx)).toBeNull();
    expect(buildAnswer({ about: 'ranking', superlative: 'cheapest' }, [], ctx)).toBeNull();
    expect(buildAnswer({ about: 'all', fact: 'breakfast' }, [], ctx)).toBeNull();
  });
});

describe('what the search is set to', () => {
  const line = (field: (typeof SEARCH_FIELDS)[number], search: Partial<AnswerContext['search']> = {}) =>
    answerLine(buildAnswer({ about: 'search', field }, [], { ...ctx, search: { ...ctx.search, ...search } })!, 'EUR');

  it('each part, from the stay row', () => {
    expect(line('dates')).toBe('11–13 Dec, 2 nights.');
    expect(line('guests')).toBe('2 adults.');
    expect(line('guests', { adults: 2, childrenAges: [4, 9], rooms: 2 })).toBe('2 adults, 2 children (4, 9), 2 rooms.');
    expect(line('destination')).toBe('Searching Porto, Portugal.');
    expect(line('budget')).toBe('No price cap is set.');
    expect(line('budget', { priceCapMinor: 7000 })).toBe('Capped at €70 a night.');
    expect(line('must_haves')).toBe('Nothing is required of the hotel yet.');
    expect(line('must_haves', { mustHaves: ['parking', 'pool', 'wifi'] })).toBe('Must have parking, a pool and wifi.');
    expect(line('priority')).toBe('Ranked for low price.');
    expect(line('priority', { priorities: ['closest', 'nicest'] })).toBe('Ranked for great reviews and being close to central Porto.');
    expect(line('priority', { priorities: [] })).toBe('Balanced: price, rating and distance.');
    expect(line('priority', { priorities: null })).toBe('No order is set.');
  });

  it('everything: only what is set', () => {
    expect(line('everything')).toBe('Searching Porto, Portugal. 11–13 Dec, 2 nights. 2 adults. Ranked for low price.');
    expect(line('everything', { priceCapMinor: 7000, mustHaves: ['parking'], priorities: null })).toBe('Searching Porto, Portugal. 11–13 Dec, 2 nights. 2 adults. Capped at €70 a night. Must have parking.');
  });
});

it('lists names', () => {
  expect(listNames(['A'])).toBe('A');
  expect(listNames(['A', 'B'])).toBe('A and B');
  expect(listNames(['A', 'B', 'C'])).toBe('A, B and C');
});
