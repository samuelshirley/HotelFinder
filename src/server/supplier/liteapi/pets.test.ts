import { describe, expect, it } from 'vitest';

import { fixture } from './fixtures';
import { normalizeDetails } from './normalize';
import { hotelDetailsResponse } from './schemas';

/**
 * Whether a hotel takes pets, read from real recorded listings
 * (scripts/capture-liteapi-fixtures.mjs --add-pet-details). Found on
 * 2026-11-13: the finder ranked Novotel Annecy Centre as THE hotel for a
 * trip with a dog while its hotel page said "No pets". The page was reading
 * a flag that is false for most hotels whose facility list says yes.
 */
const pets = (id: string) => normalizeDetails(hotelDetailsResponse.parse(fixture(`hotel-details-${id}`))).petsAllowed;

describe('pets from a hotel listing', () => {
  it('a "Pets allowed" facility is a yes even when the flag is false (Novotel Annecy Centre)', () => {
    expect(pets('lp42f1e')).toBe(true);
  });

  it('a pet policy is a yes even with no facility (ibis Annecy Centre Vieille Ville)', () => {
    expect(pets('lp2c368')).toBe(true);
  });

  it('an explicit "not allowed" policy is a no (Hebe Hotel)', () => {
    expect(pets('lpd1449')).toBe(false);
  });

  it('an explicit no wins over a "Pets allowed" facility (Hilton Porto Gaia lists both)', () => {
    expect(pets('lp6557454d')).toBe(false);
  });

  it('a false flag with nothing else is "the listing does not say", never a no (Vincci Porto)', () => {
    expect(pets('lp76a2a')).toBeNull();
  });
});
