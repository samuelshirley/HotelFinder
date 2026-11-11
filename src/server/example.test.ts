import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { exampleCard } from './example';

describe('the first screen example', () => {
  it('is the real ranking of the recorded Porto search, not hand-written', () => {
    expect(exampleCard()).toEqual({
      caption: 'Example from a real search: Porto, 2 nights, low price and great reviews',
      name: 'Mercure Porto Centro Aliados',
      total: '€158.55',
      nightsText: '2 nights',
      facts: '9.2 · 4★ · 300 m from the middle of the results',
      reason: 'Best mix of low price and great reviews: rated 9.2, 7th cheapest of 20',
      photo: expect.stringMatching(/^https:\/\//),
    });
  });
});
