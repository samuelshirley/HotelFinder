import { describe, expect, it } from 'vitest';
import { formatKm, reasonText } from './reasonText';

const ctx = { currency: 'EUR', hasMustHaves: false };

describe('reason wording', () => {
  it.each([
    [{ kind: 'cheapest_meeting_all_musts' }, ctx, 'Cheapest available'],
    [{ kind: 'cheapest_meeting_all_musts' }, { ...ctx, hasMustHaves: true }, 'Cheapest that has everything you asked for'],
    [{ kind: 'closest', km: 0.1, to: 'place' }, ctx, 'Closest: 100 m from the place you named'],
    [{ kind: 'closest', km: 1.4, to: 'search_centre' }, ctx, 'Closest: 1.4 km from the middle of the results'],
    [{ kind: 'closest', km: 0.2, to: 'place', to_label: 'Ribeira' }, ctx, 'Closest: 200 m from Ribeira'],
    [{ kind: 'closest', km: 1.5, to: 'destination', to_label: 'Porto Airport (OPO)' }, ctx, 'Closest: 1.5 km from Porto Airport (OPO)'],
    [{ kind: 'best_mix', of: ['cheapest', 'nicest'], km: 0.3, to: 'search_centre', to_label: null, rating: 9.2, reviews: 2361, price_rank: 7, eligible: 20 }, ctx, 'Best mix of low price and great reviews: rated 9.2, 7th cheapest of 20'],
    [{ kind: 'best_mix', of: ['cheapest', 'closest'], km: 0.1, to: 'place', to_label: 'Ribeira', rating: 8.4, reviews: 9474, price_rank: 4, eligible: 20 }, ctx, 'Best mix of low price and location: 4th cheapest of 20, 100 m from Ribeira'],
    [{ kind: 'best_mix', of: ['cheapest', 'nicest', 'closest'], km: 0.2, to: 'place', to_label: 'Ribeira', rating: 9.8, reviews: 3056, price_rank: 1, eligible: 3 }, ctx, 'Best mix of low price, great reviews and location: rated 9.8, 1st cheapest of 3, 200 m from Ribeira'],
    [{ kind: 'best_mix', of: ['nicest', 'closest'], km: null, to: null, to_label: null, rating: null, reviews: null, price_rank: 2, eligible: 5 }, ctx, 'Best mix of great reviews and location'],
    [{ kind: 'best_rated', rating: 9.8, reviews: 3056 }, ctx, 'Best rated: 9.8 from 3,056 reviews'],
    [{ kind: 'cheapest_well_reviewed', rating: 8.7, reviews: 9333 }, ctx, 'Cheapest rated 8.7 or better by 9,333 guests'],
    [{ kind: 'best_balance' }, ctx, 'Best balance of price, rating and distance'],
    [{ kind: 'runner_up', price_delta_minor: 989, km_delta: 0.4, rating_delta: -0.2 }, ctx, 'Than the first: €9.89 more, 400 m further, rated 0.2 lower'],
    [{ kind: 'runner_up', price_delta_minor: 0, km_delta: -1.2, rating_delta: 0.5 }, ctx, 'Than the first: same price, 1.2 km closer, rated 0.5 higher'],
    [{ kind: 'runner_up', price_delta_minor: 2000, km_delta: null, rating_delta: null }, ctx, 'Than the first: €20 more'],
  ])('%j', (reason, c, text) => {
    expect(reasonText(reason, c)).toBe(text);
  });

  it('says nothing for a reason it does not know, rather than inventing one', () => {
    expect(reasonText({ kind: 'editor_pick' }, ctx)).toBe('');
    expect(reasonText(null, ctx)).toBe('');
  });

  it('formats distances', () => {
    expect(formatKm(0)).toBe('0 m');
    expect(formatKm(0.9)).toBe('900 m');
    expect(formatKm(1)).toBe('1.0 km');
  });
});

describe('near-miss words', () => {
  const say = (misses: unknown[]) => reasonText({ kind: 'near_miss', misses }, { currency: 'EUR', hasMustHaves: true });
  it('says each miss, from the finder\'s list only', () => {
    expect(say([{ kind: 'over_price_cap', over_by_minor: 1230 }])).toBe('Misses: €12.30 a night over your cap');
    expect(say([{ kind: 'missing_must_have', must: ['parking', 'pool'], unknown: [] }])).toBe('Misses: no parking or a pool');
    expect(say([{ kind: 'missing_must_have', must: ['breakfast_included'], unknown: ['pets_allowed'] }])).toBe(
      'Misses: no breakfast included; the listing does not say if it has pets allowed',
    );
    expect(say([{ kind: 'member_price' }, { kind: 'over_price_cap', over_by_minor: 500 }])).toBe(
      'Misses: its rate is a member price, not shown before you sign in; €5 a night over your cap',
    );
  });
  it('out of town: both distances, as the finder gave them; without them, nothing', () => {
    expect(say([{ kind: 'out_of_town', km: 10.7, max_km: 8 }])).toBe('Misses: out of town, 10.7 km from the middle of the results (a city search keeps to 8.0 km)');
    expect(say([{ kind: 'out_of_town' }])).toBe('');
  });
  it('a member-price miss never says a number', () => {
    expect(say([{ kind: 'member_price' }])).not.toMatch(/\d/);
  });
  it('anything it does not know says nothing rather than guessing', () => {
    expect(say([{ kind: 'mystery' }])).toBe('');
    expect(say([{ kind: 'missing_must_have', must: ['not_a_must'], unknown: [] }])).toBe('');
  });
});
