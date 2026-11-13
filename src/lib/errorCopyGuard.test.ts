import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ERROR_COPY, errorCopy } from './errors';
import { CATALOGUES, LOCALES } from './i18n';

const SRC = path.resolve(import.meta.dirname, '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? (name === '__fixtures__' ? [] : walk(full)) : /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') ? [full] : [];
  });

/** Every error code the server can send has a sentence the user sees. */
describe('error copy', () => {
  const sources = walk(SRC).map((f) => ({ file: path.relative(SRC, f), text: readFileSync(f, 'utf8') }));

  it('every code passed to errorResponse has copy', () => {
    const used = new Set<string>();
    for (const { text } of sources) for (const m of text.matchAll(/errorResponse\(\s*'([a-z_]+)'/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(5);
    expect([...used].filter((code) => !(code in ERROR_COPY))).toEqual([]);
  });

  it('every form and turn error the server can produce has copy', () => {
    const onboarding = sources.find((s) => s.file === 'server/onboarding.ts')!.text;
    const union = /export type FormError =([^;]+);/.exec(onboarding)![1];
    const codes = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(4);
    expect(codes.filter((c) => !(c in ERROR_COPY))).toEqual([]);
    const turn = sources.find((s) => s.file === 'server/turn.ts')!.text;
    for (const m of turn.matchAll(/(?:code|errorCode): '([a-z_]+)'/g)) expect(m[1] in ERROR_COPY, m[1]).toBe(true);
  });

  it('every Deal Freeze error the server can produce has copy', () => {
    const freeze = sources.find((s) => s.file === 'server/freeze.ts')!.text;
    const codes = ['FreezeError', 'KeepError', 'ReleaseError'].flatMap((name) => {
      const union = new RegExp(`export type ${name} =([^;]+);`).exec(freeze)![1];
      return [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    });
    expect(codes.length).toBeGreaterThan(15);
    expect(codes.filter((c) => !(c in ERROR_COPY))).toEqual([]);
  });

  it('an unknown code still gets a sentence, and no copy is empty or generic', () => {
    expect(errorCopy('never_heard_of_it')).toBe(ERROR_COPY.server_error);
    expect(errorCopy(null)).toBe(ERROR_COPY.server_error);
    for (const [code, copy] of Object.entries(ERROR_COPY)) {
      expect(copy.length, code).toBeGreaterThan(15);
      expect(copy, code).not.toMatch(/something went wrong|please try again later|oops/i);
    }
  });

  it('every code has a sentence in every language, and none is empty or generic', () => {
    for (const locale of LOCALES) {
      const table = CATALOGUES[locale].errors as Record<string, string>;
      expect(Object.keys(table).sort(), locale).toEqual(Object.keys(ERROR_COPY).sort());
      for (const [code, copy] of Object.entries(table)) {
        expect(copy.length, `${locale}.${code}`).toBeGreaterThan(15);
        expect(copy, `${locale}.${code}`).not.toMatch(/something went wrong|please try again later|oops|algo (ha )?sali[oó] mal|int[eé]ntalo m[aá]s tarde|ups/i);
        expect(errorCopy(code, locale)).toBe(copy);
      }
    }
  });

  it('nothing swallows an error silently', () => {
    const offenders = sources.filter(({ text }) => /catch\s*(\([^)]*\))?\s*\{\s*\}/.test(text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});
