import { describe, expect, it } from 'vitest';

import { DISPATCH_MAX_MS, hasTimeFor, MODEL_CALL_MAX_MS, TURN_BUDGET_MS } from './turnBudget';

describe('the turn budget', () => {
  it('leaves room under the platform limit for the last step to finish and be written down', () => {
    // maxDuration is 300 s. The last step allowed to start must end before it.
    expect(TURN_BUDGET_MS).toBeLessThanOrEqual(280_000);
    expect(MODEL_CALL_MAX_MS).toBeGreaterThanOrEqual(2 * 30_000); // the SDK's timeout, retried once
    expect(DISPATCH_MAX_MS).toBeGreaterThanOrEqual(20_000 + 20_000 + 15_000); // search, wider search, facts
  });

  it('a step starts only if its longest run fits before the deadline', () => {
    expect(hasTimeFor(100_000, 0, MODEL_CALL_MAX_MS)).toBe(true);
    expect(hasTimeFor(100_000, 100_000 - MODEL_CALL_MAX_MS, MODEL_CALL_MAX_MS)).toBe(true);
    expect(hasTimeFor(100_000, 100_000 - MODEL_CALL_MAX_MS + 1, MODEL_CALL_MAX_MS)).toBe(false);
    expect(hasTimeFor(undefined, 1e15, MODEL_CALL_MAX_MS)).toBe(true);
  });
});
