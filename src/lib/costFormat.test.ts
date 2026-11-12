import { describe, expect, it } from 'vitest';

import { formatMicrocents } from './costFormat';

describe('formatMicrocents', () => {
  it('keeps sub-cent costs readable', () => {
    expect(formatMicrocents(0)).toBe('$0');
    expect(formatMicrocents(77_571)).toBe('$0.000776');
    expect(formatMicrocents(9_513)).toBe('$0.000095');
    expect(formatMicrocents(1_000_000)).toBe('$0.0100');
    expect(formatMicrocents(1_086_513)).toBe('$0.0109');
    expect(formatMicrocents(250_000_000)).toBe('$2.50');
    expect(formatMicrocents(-1_000_000)).toBe('-$0.0100');
  });
});
