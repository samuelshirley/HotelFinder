import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(import.meta.dirname, '../server/db/schema.ts'), 'utf8');
/** Comments stripped, so prose about `timestamp(` does not count as a call. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('schema guard', () => {
  it('declares timestamps only through the ts() helper, which carries a time zone', () => {
    const calls = code.match(/\btimestamp\(/g) ?? [];
    expect(calls, 'a raw timestamp( column has no time zone; use ts()').toHaveLength(1);
    expect(code).toMatch(/const ts = \(name: string\) => timestamp\(name, \{ withTimezone: true/);
  });

  it('stores stay dates as date columns', () => {
    expect(code).toMatch(/checkIn: date\('check_in'/);
    expect(code).toMatch(/checkOut: date\('check_out'/);
  });

  it('never stores money as a float', () => {
    const moneyLines = code.split('\n').filter((l) => /Minor\b.*:/.test(l));
    expect(moneyLines.length).toBeGreaterThan(5);
    for (const line of moneyLines) expect(line, line.trim()).toMatch(/: integer\(/);
  });
});
