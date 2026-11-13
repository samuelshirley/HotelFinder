import { describe, expect, it } from 'vitest';

import { CATALOGUES } from './index';
import { en } from './catalogue/en';
import { DEFAULT_LOCALE, LOCALES } from './locale';

/**
 * Every English key has an entry in every other language, of the same kind,
 * and that entry is translated. tsc already refuses a missing key; this holds
 * at runtime too (vitest does not typecheck) and catches the English left in
 * by copy-paste, which tsc cannot see. Mutation-checked: docs/i18n.md.
 */

type Leaf = { path: string; value: unknown };
const leaves = (value: unknown, path = ''): Leaf[] =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k))
    : [{ path, value }];
const at = (root: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o !== null && typeof o === 'object' && k in (o as object) ? (o as Record<string, unknown>)[k] : undefined), root);
const kind = (v: unknown) => (Array.isArray(v) ? 'array' : typeof v);

/** A phrase function, said with stand-in values. "2" works as a count, a name and a price. */
const say = (fn: (...args: string[]) => unknown) => String(fn(...Array.from({ length: Math.max(fn.length, 1) }, () => '2')));

/** Entries that are the same words in both languages, each for a stated reason. */
const SAME_ON_PURPOSE: Record<string, string> = {
  'replies.mustHave.wifi': '"wifi" is the Spanish word too',
  'ui.chat': '"chat" is the Spanish word too',
  'words.deadline': 'a time and "UTC" only',
  'answers.stars': 'a name and the star words, which are translated in words.stars',
  'answers.acrossGroup': 'a heading and names, both translated where they are made',
};

describe('message catalogues', () => {
  const source = leaves(en);

  it('the source catalogue is real and English is the default', () => {
    expect(source.length).toBeGreaterThan(300);
    expect(DEFAULT_LOCALE).toBe('en');
    expect(LOCALES).toContain('es');
  });

  for (const locale of LOCALES.filter((l) => l !== 'en')) {
    describe(locale, () => {
      const target = CATALOGUES[locale];

      it('has every English key, of the same kind, and nothing else', () => {
        const missing = source.filter(({ path, value }) => kind(at(target, path)) !== kind(value)).map((l) => l.path);
        expect(missing).toEqual([]);
        const extra = leaves(target).filter(({ path }) => at(en, path) === undefined).map((l) => l.path);
        expect(extra).toEqual([]);
      });

      it('every entry is filled in, and the phrase functions take the same values', () => {
        for (const { path, value } of source) {
          const theirs = at(target, path);
          if (typeof value === 'string') expect((theirs as string).trim().length, path).toBeGreaterThan(0);
          if (Array.isArray(value)) expect((theirs as unknown[]).length, path).toBe(value.length);
          if (typeof value === 'function') {
            expect((theirs as () => unknown).length, path).toBe(value.length);
            expect(say(theirs as (...a: string[]) => unknown).trim().length, path).toBeGreaterThan(0);
          }
        }
      });

      it('nothing is left in English', () => {
        const untranslated = source
          .filter(({ path, value }) => {
            if (path in SAME_ON_PURPOSE) return false;
            const theirs = at(target, path);
            if (typeof value === 'function') return say(theirs as (...a: string[]) => unknown) === say(value as (...a: string[]) => unknown);
            return JSON.stringify(theirs) === JSON.stringify(value);
          })
          .map((l) => l.path);
        expect(untranslated).toEqual([]);
      });
    });
  }
});
