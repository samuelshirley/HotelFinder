import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { FetchLike } from './google';

/** Test support: the recorded Google Places responses (scripts/capture-google-fixtures.mjs) and a fetch that replays them. */

export const FIXTURES_DIR = path.resolve(import.meta.dirname, '__fixtures__');

type ManifestEntry = { method: string; url: string; fieldMask: string; request: unknown; status: number; sha256: string };
export const manifest = JSON.parse(readFileSync(path.join(FIXTURES_DIR, 'manifest.json'), 'utf8')) as {
  capturedAt: string;
  files: Record<string, ManifestEntry>;
};

export function fixtureText(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, `${name}.json`), 'utf8');
}
export function fixture(name: string): unknown {
  return JSON.parse(fixtureText(name));
}

/** A fetch that answers with one recording, at the status it was recorded with, and keeps what it was sent. */
export function replay(name: string) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(fixtureText(name), { status: manifest.files[`${name}.json`].status, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}
