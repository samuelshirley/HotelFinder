import rates from './__fixtures__/rates-city-porto.json';
import { normalizeRates } from './normalize';
import { ratesResponse } from './schemas';

/**
 * The recorded sandbox search behind the first screen's example card (Porto,
 * 11–13 Dec 2026, 2 adults, member prices), normalized like any live answer.
 */
export function recordedExampleSearch(recordedAt: Date) {
  const parsed = ratesResponse.safeParse(rates);
  return parsed.success ? normalizeRates(parsed.data, 0, recordedAt) : null;
}
