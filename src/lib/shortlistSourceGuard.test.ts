import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__fixtures__' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/**
 * Ranked, priced shortlist rows come only from the stay finder. The agent and
 * the router can add a property the user named and nothing else, so neither
 * can type a "recommended" hotel into existence.
 */
describe('shortlist source', () => {
  const app = walk(SRC).filter((f) => !f.endsWith('.test.ts'));

  it('only the finder imports the finder-row writer', () => {
    const importers = app
      .filter((f) => /from\s+['"][^'"]*finderShortlist['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f));
    expect(importers).toEqual(['server/finder.ts']);
  });

  it('nothing but the finder-row writer inserts a row with source "finder"', () => {
    const writers = app
      .filter((f) => /source:\s*['"]finder['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f));
    expect(writers).toEqual(['server/repos/finderShortlist.ts']);
  });

  it('the agent-facing writer has no source parameter', () => {
    const shortlist = readFileSync(path.join(SRC, 'server/repos/shortlist.ts'), 'utf8');
    expect(shortlist).toMatch(/source: 'user_named'/);
    expect(shortlist).not.toMatch(/source: input\.source|source\?:/);
  });
});
