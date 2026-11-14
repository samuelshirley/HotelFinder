import { describe, expect, it } from 'vitest';
import { isUuid } from './ids';

describe('isUuid', () => {
  it('takes a canonical uuid in either case', () => {
    expect(isUuid('3f2b8c1e-9a4d-4c2e-8b1f-0a6d5e7c9b21')).toBe(true);
    expect(isUuid('3F2B8C1E-9A4D-4C2E-8B1F-0A6D5E7C9B21')).toBe(true);
  });
  it('refuses 36 characters that are not one', () => {
    expect(isUuid('a'.repeat(36))).toBe(false);
    expect(isUuid('-'.repeat(36))).toBe(false);
    expect(isUuid('3f2b8c1e9a4d-4c2e-8b1f-0a6d5e7c9b21-')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});
