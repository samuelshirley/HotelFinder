import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './pgErrors';

describe('isUniqueViolation', () => {
  it('reads a bare driver error and a wrapped one', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation(new Error('wrapped', { cause: { code: '23505' } }))).toBe(true);
  });

  it('is false for other codes and non-errors', () => {
    expect(isUniqueViolation({ code: '23514' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });

  it('matches a named constraint when the driver reports one', () => {
    expect(isUniqueViolation({ code: '23505', constraint: 'a_idx' }, 'a_idx')).toBe(true);
    expect(isUniqueViolation({ code: '23505', constraint: 'b_idx' }, 'a_idx')).toBe(false);
  });
});
