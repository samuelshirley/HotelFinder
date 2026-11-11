import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { marginFor } from '@/lib/pricing';

/**
 * The first screen promises "Ranked only by what you asked for". Two things
 * keep that true: the ranking code never sees what we earn on a hotel, and our
 * margin is one number per audience, the same for every hotel, so it can never
 * move one hotel above another.
 */
const FINDER = path.resolve(import.meta.dirname, 'finder');
const EARNINGS = /margin|commission|markup|payout|kickback|sponsor|promot|boost/i;

describe('ranked only by what you asked for', () => {
  it('nothing in the ranking code reads what we earn on a hotel', () => {
    const offenders = readdirSync(FINDER)
      .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
      .flatMap((f) =>
        readFileSync(path.join(FINDER, f), 'utf8')
          .split('\n')
          .map((line, i) => ({ line, at: `${f}:${i + 1}` }))
          .filter(({ line }) => EARNINGS.test(line))
          .map(({ at, line }) => `${at} ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });

  it('the margin depends on the audience and the configuration only, never on the hotel', () => {
    expect(marginFor.length).toBeLessThanOrEqual(2);
    const src = readFileSync(path.resolve(import.meta.dirname, 'pricing.ts'), 'utf8');
    const signature = src.match(/export function marginFor\(([^)]*)\)/)?.[1] ?? '';
    expect([...signature.matchAll(/(?:^|,)\s*(\w+)\s*[?]?:/g)].map((m) => m[1])).toEqual(['audience', 'env']);
  });
});
