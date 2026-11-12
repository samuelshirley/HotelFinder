import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { PRIORITIES } from '@/server/db/schema';
import { PRIORITY_KEYS } from './finder/rank';

const SRC = path.resolve(import.meta.dirname, '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? (name === '__fixtures__' ? [] : walk(full)) : /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
const sources = walk(SRC).map((f) => ({ file: path.relative(SRC, f), text: readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') }));

describe('guard: priorities', () => {
  it('the database enum and the ranking keys are the same set', () => {
    expect([...PRIORITIES].sort()).toEqual([...PRIORITY_KEYS].sort());
  });

  it('nothing outside the schema touches the retired single priority', () => {
    const offenders = sources
      .filter((s) => s.file !== path.join('server', 'db', 'schema.ts'))
      .filter((s) => /LEGACY_PRIORITIES|searchSessions\.priority\b|userPreferences\.priority\b|['"]basic['"]/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});

describe('guard: the nationality for rates is set in exactly three places', () => {
  // Inferred at session creation and when the destination is answered (no
  // price in scope in either), or changed by the user through the one
  // dispatch path. Nowhere else may write it, so nothing can pick it to chase a rate.
  const ALLOWED = [path.join('server', 'startSession.ts'), path.join('server', 'onboarding.ts'), path.join('server', 'dispatch.ts')];

  it('only those files write guestNationality to a session', () => {
    // The repo function itself is the write; these are its callers.
    const writers = sources.filter((s) => s.file !== path.join('server', 'repos', 'sessions.ts')).filter((s) => /updateSession\([^)]*guestNationality|guestNationality:\s*(inferred|state\.)/.test(s.text.replace(/\s+/g, ' '))).map((s) => s.file);
    expect(writers.sort()).toEqual([...ALLOWED].sort());
  });

  it('the inference is only ever fed headers, a saved choice and the destination\'s country', () => {
    for (const s of sources.filter((x) => x.text.includes('inferNationality('))) {
      // Everything from the call to the end of its statement.
      const calls = s.text.split('inferNationality(').slice(1).map((rest) => rest.slice(0, rest.indexOf(';')));
      expect(calls.length, s.file).toBeGreaterThan(0);
      for (const args of calls) expect(args, s.file).not.toMatch(/price|offer|minor|total|rate|cheap/i);
    }
  });
});
