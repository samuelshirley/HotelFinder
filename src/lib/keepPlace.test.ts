import { describe, expect, it } from 'vitest';

import { placeAt, scrollTopFor } from './keepPlace';

describe('keeping the place in the hotels list over a new search', () => {
  // The list's view starts 100px down the window; each card is 130px tall.
  const cards = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, top: 100 + i * 130 - 300, bottom: 100 + (i + 1) * 130 - 300 }));

  it('the place is the first card reaching below the top of the view, and how far down it sits', () => {
    // a: -200..-70, b: -70..60, c: 60..190 (straddles the view top at 100), d: 190..320.
    expect(placeAt(cards, 100, 2400)).toEqual({ id: 'c', offset: -40, scrollTop: 2400 });
    expect(placeAt(cards, -200, 0)).toEqual({ id: 'a', offset: 0, scrollTop: 0 });
  });

  it('with no card in or below the view, only the scroll position is kept', () => {
    expect(placeAt(cards, 900, 3000)).toEqual({ id: null, offset: 0, scrollTop: 3000 });
    expect(placeAt([], 100, 50)).toEqual({ id: null, offset: 0, scrollTop: 50 });
  });

  it('the same hotel comes back to the same height, wherever the new ranking put it', () => {
    const place = { id: 'c', offset: -40, scrollTop: 2400 };
    // Now at 860px in the window (the view top is 100, the list scrolled to 900): 900 + 760 + 40.
    expect(scrollTopFor(place, 860, 100, 900)).toBe(1700);
    // Exactly where it was: no move.
    expect(scrollTopFor(place, 60, 100, 2400)).toBe(2400);
    // Never above the top of the list.
    expect(scrollTopFor({ id: 'a', offset: 50, scrollTop: 10 }, 120, 100, 0)).toBe(0);
  });

  it('a hotel the new search no longer lists on the page: the scroll position stays as it was', () => {
    expect(scrollTopFor({ id: 'gone', offset: 8, scrollTop: 3656 }, null, 100, 986)).toBe(3656);
    expect(scrollTopFor({ id: null, offset: 0, scrollTop: 1200 }, 400, 100, 986)).toBe(1200);
  });
});
