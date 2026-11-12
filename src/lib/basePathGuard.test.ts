import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BASE_PATH, withBase } from '@/lib/basePath';

/**
 * The app is served under /hotels on feraltravels.com, where a root path
 * ("/api/me") reaches Feral Travels instead of us. Next prefixes its own
 * links and assets; everything the browser fetches or navigates to by hand
 * must go through withBase. This fails on any root path written without it.
 */
const ROOT = path.resolve(__dirname, '../..');
const SCANNED = ['src/components', 'src/app'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

// A string literal starting with a single "/" handed straight to the browser.
const BARE_ROOT_PATH = [
  /\bfetch\(\s*[`'"]\/(?!\/)/,
  /\.(assign|replace)\(\s*[`'"]\/(?!\/)/,
  /\blocation(\.href)?\s*=\s*[`'"]\/(?!\/)/,
  /\b(href|src|action|formAction)=\s*\{?\s*[`'"]\/(?!\/)/,
];

/**
 * next/link's <Link> prefixes basePath itself, so a root path there is right,
 * and wrapping it in withBase would prefix it twice (/hotels/hotels/…).
 */
const isLink = (line: string) => /<Link\b/.test(line);
const DOUBLE_PREFIX = /<Link\b[^>]*\bhref=\{\s*withBase\(/;

describe('every browser-side URL is under BASE_PATH', () => {
  it('next.config.mjs serves the app at BASE_PATH', () => {
    const config = readFileSync(path.join(ROOT, 'next.config.mjs'), 'utf8');
    expect(config).toMatch(new RegExp(`basePath:\\s*'${BASE_PATH}'`));
  });

  it('withBase prefixes paths and maps the root to BASE_PATH itself', () => {
    expect(withBase('/api/me')).toBe('/hotels/api/me');
    expect(withBase('/')).toBe('/hotels');
  });

  it('no fetch, navigation, href or src uses a root path without withBase', () => {
    const offenders: string[] = [];
    for (const dir of SCANNED) {
      for (const file of files(path.join(ROOT, dir))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            const bare = BARE_ROOT_PATH.some((re) => re.test(line)) && !isLink(line);
            if (bare || DOUBLE_PREFIX.test(line)) offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
