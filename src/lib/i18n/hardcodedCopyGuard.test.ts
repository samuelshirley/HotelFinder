import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The files that were translated last (docs/i18n.md, 2026-11-14) hold no
 * words of their own: every word a visitor meets comes from the catalogues.
 * A string literal, a template's text or a JSX text node with a word and a
 * space in it (placeholders aside), or one capitalised word, is a hard-coded
 * phrase. Comments are skipped.
 * Mutation-checked: docs/i18n.md.
 */

const FILES = [
  'src/components/HotelDetail.tsx',
  'src/components/Checkout.tsx',
  'src/app/book/[id]/page.tsx',
  'src/lib/hotelFaq.ts',
  'src/lib/facilities.ts',
  'src/server/checkout.ts',
  'src/server/freeze.ts',
  'src/server/view.ts',
];

/** Code, not copy: each is read by a machine, never shown. */
const NOT_COPY = new Set(['use client', 'server-only', 'noopener noreferrer', 'Escape', 'ArrowLeft', 'ArrowRight', 'Promise', 'Bearer ${secret}', 'Apple Pay', 'Google Pay']);

const stripComments = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Every piece of text in the source, with its line. Regex literals, identifiers and URLs are not text. */
export function phrases(src: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  const lines = stripComments(src).split('\n');
  const isPhrase = (text: string) => (/\s/.test(text) && /[A-Za-z]{3,}/.test(text)) || /^[A-Z][a-z]{2,}[.!?…:]?$/.test(text);
  lines.forEach((line, i) => {
    if (/^\s*import |console\.(log|warn|error)\(/.test(line)) return;
    // Quoted strings, template text, and JSX text between a tag's ">" and the next "<tag" or "</".
    for (const m of line.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`|(?<=[\w"'}/])>([^<>{}]+)<(?=[A-Za-z/])/g)) {
      const raw = (m[1] ?? m[2] ?? m[3] ?? m[4]).trim();
      if (NOT_COPY.has(raw) || /^https?:/.test(raw)) continue;
      if (isPhrase(raw.replace(/\$\{[^}]*\}/g, ' ').trim())) out.push({ line: i + 1, text: raw });
    }
    // JSX text on a line of its own, under the tag it is in.
    const text = line.trim();
    if (/^[A-Za-z][^{}<>=;'"`]*$/.test(text) && lines[i - 1]?.trim().endsWith('>') && isPhrase(text)) out.push({ line: i + 1, text });
  });
  return out;
}

describe('no hard-coded copy in the translated screens', () => {
  for (const file of FILES) {
    it(file, () => {
      expect(phrases(readFileSync(join(process.cwd(), file), 'utf8'))).toEqual([]);
    });
  }

  it('finds the kinds of phrase it is for', () => {
    expect(phrases(`<button aria-label="Close photos">✕</button>`).map((p) => p.text)).toEqual(['Close photos']);
    expect(phrases(`<h3>Amenities</h3>`).map((p) => p.text)).toEqual(['Amenities']);
    expect(phrases(`<button type="button" onClick={onClose}>\n  Collapse ▲\n</button>`).map((p) => p.text)).toEqual(['Collapse ▲']);
    expect(phrases(`const ok = (n) => n > 0 && n < 9;\nconst f = (e: React.SyntheticEvent<HTMLImageElement>) => e;`)).toEqual([]);
    expect(phrases('content: `Booked: ${hotel}. Reference ${ref}.`,').map((p) => p.text)).toEqual(['Booked: ${hotel}. Reference ${ref}.']);
    expect(phrases(`const x = cond ? 'the centre' : null;`).map((p) => p.text)).toEqual(['the centre']);
    expect(phrases(`// a comment with words\n/** and a doc comment */\nconst status = 'prebooked';`)).toEqual([]);
  });
});
