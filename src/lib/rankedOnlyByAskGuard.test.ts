import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { searchMarginPct } from '@/lib/pricing';

/**
 * The first screen promises "Ranked only by what you asked for". Two things
 * keep that true: the ranking code never sees what we earn on a hotel, and our
 * margin is one number, the same for every hotel and every visitor, so it can
 * never move one hotel above another. (The checkout lifts a signed-out
 * visitor's price to the hotel's own public price, per hotel; that never
 * ranks anything: server/checkout.ts `roomFor`.)
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

  it('the search margin depends on the configuration only, never on the hotel or the visitor', () => {
    expect(searchMarginPct.length).toBeLessThanOrEqual(1);
    const src = readFileSync(path.resolve(import.meta.dirname, 'pricing.ts'), 'utf8');
    const signature = src.match(/export function searchMarginPct\(([^)]*)\)/)?.[1] ?? '';
    expect([...signature.matchAll(/(?:^|,)\s*(\w+)\s*[?]?:/g)].map((m) => m[1])).toEqual(['env']);
  });
});
