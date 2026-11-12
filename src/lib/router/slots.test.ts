import { describe, expect, it } from 'vitest';
import { addDays, extractGuests, extractNightsShift, extractPriceCap, extractTarget } from './slots';

describe('price cap', () => {
  it.each([
    ['under 120 a night', { kind: 'cap', amount: 120, per: 'night', currency: null }],
    ['can you make it cheaper, under €120?', { kind: 'cap', amount: 120, per: 'night', currency: 'EUR' }],
    ['max 90 euros per night', { kind: 'cap', amount: 90, per: 'night', currency: 'EUR' }],
    ['no more than 300 in total', { kind: 'cap', amount: 300, per: 'stay', currency: null }],
    ['budget of $200', { kind: 'cap', amount: 200, per: 'night', currency: 'USD' }],
    ['up to 150/night', { kind: 'cap', amount: 150, per: 'night', currency: null }],
    ['price doesn\'t matter', { kind: 'remove' }],
    ['remove the price cap', { kind: 'remove' }],
  ])('%s', (message, expected) => {
    expect(extractPriceCap(message)).toEqual(expected);
  });

  it.each([
    'something cheaper please',
    'between 80 and 120 a night',
    'under 120 a night or 300 total',
    'room 204 was nice',
    'under 100 euros or 110 dollars',
    'under 120 a night for the whole stay total',
    'arriving 12/12',
  ])('does not guess: %s', (message) => {
    expect(extractPriceCap(message)).toBeNull();
  });
});

describe('which hotel', () => {
  const names = ['YOTEL Porto', 'Porto Palácio Hotel by The Editory', 'Mercure Porto Centro Santa Catarina', 'Hotel Carris Porto Ribeira', 'NEYA Porto Hotel'];
  it.each([
    ['the second one', 2],
    ['tell me about #3', 3],
    ['option 4 looks good', 4],
    ['book the first', 1],
    ['the last one', 5],
    ['number two please', 2],
    ['what about the yotel', 1],
    ['is the Carris any good?', 4],
    ['not the palacio', 2],
    ['the Santa Catarina one', 3],
  ])('%s → %i', (message, n) => {
    expect(extractTarget(message, names)).toBe(n);
  });

  it.each(['that one', 'the first or the second', 'the sixth one', 'the porto hotel', 'option 9', 'the yotel or the neya'])(
    'does not guess: %s',
    (message) => {
      expect(extractTarget(message, names)).toBeNull();
    },
  );

  it('has nothing to point at with an empty shortlist', () => {
    expect(extractTarget('the first one', [])).toBeNull();
  });
});

describe('guests', () => {
  it.each([
    ['2 adults and 2 kids aged 4 and 9', { adults: 2, childrenAges: [4, 9], rooms: null }],
    ['there are four of us', { adults: 4, childrenAges: [], rooms: null }],
    ['just me', { adults: 1, childrenAges: [], rooms: null }],
    ['3 adults, 2 rooms', { adults: 3, childrenAges: [], rooms: 2 }],
    ['two adults and one child aged 6', { adults: 2, childrenAges: [6], rooms: null }],
    ['me and my wife, no kids', { adults: 2, childrenAges: [], rooms: null }],
    ['6 people in 3 rooms', { adults: 6, childrenAges: [], rooms: 3 }],
  ])('%s', (message, expected) => {
    expect(extractGuests(message)).toEqual(expected);
  });

  it.each([
    '2 adults and 2 kids',
    '2 adults and 2 kids aged 4',
    'we are bringing the children',
    '2 rooms',
    '2 adults and 1 child aged 19',
    'a room for the weekend',
  ])('does not guess: %s', (message) => {
    expect(extractGuests(message)).toBeNull();
  });
});

describe('nights', () => {
  it.each([
    ['one more night', 1],
    ['add two more nights', 2],
    ['stay 3 nights longer', 3],
    ['an extra night', 1],
    ['one night less', -1],
    ['two fewer nights', -2],
  ])('%s → %i', (message, shift) => {
    expect(extractNightsShift(message)).toBe(shift);
  });

  it.each(['three nights in porto', 'longer', 'one more night or one night less', 'a night out'])('does not guess: %s', (message) => {
    expect(extractNightsShift(message)).toBeNull();
  });

  it('adds days without a time zone moving the date', () => {
    expect(addDays('2026-12-13', 1)).toBe('2026-12-14');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-29', -1)).toBe('2026-03-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('the map intent: away, or on show', () => {
  it.each(['hide the map', 'close the map please', 'get rid of the map', "I don't need the map", 'no map', 'turn off the map'])('%s → hidden', async (m) => {
    const { wantsMapHidden } = await import('./slots');
    expect(wantsMapHidden(m)).toBe(true);
  });
  it.each(['show the map', 'map please', 'can I see them on a map', 'bring the map back'])('%s → shown', async (m) => {
    const { wantsMapHidden } = await import('./slots');
    expect(wantsMapHidden(m)).toBe(false);
  });
});
