import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { FetchLike } from './http';

/** Test support: the recorded sandbox responses and a fetch that replays them. */

export const FIXTURES_DIR = path.resolve(import.meta.dirname, '__fixtures__');

type ManifestEntry = { method: string; url: string; request: unknown; status: number; sha256: string };
export const manifest = JSON.parse(readFileSync(path.join(FIXTURES_DIR, 'manifest.json'), 'utf8')) as {
  capturedAt: string;
  files: Record<string, ManifestEntry>;
};

/** A recorded body, reachable by any path without `any`. Validate with a schema before trusting a value. */
export interface Loose {
  [key: string]: Loose;
  [index: number]: Loose;
}

export function fixture(name: string): Loose {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${name}.json`), 'utf8')) as Loose;
}

/** Place ids that have recorded details, read from the URL each was recorded at: id → fixture name. */
export function recordedPlaceIds(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [file, entry] of Object.entries(manifest.files)) {
    const m = /\/data\/places\/([^/?]+)$/.exec(entry.url);
    if (m) out.set(decodeURIComponent(m[1]), file.replace(/\.json$/, ''));
  }
  return out;
}

export type RecordedCall = { url: string; method: string; headers: Record<string, string>; body: unknown };

/**
 * A fetch that answers every call with one recorded fixture, at the HTTP
 * status it was recorded with, and remembers what it was asked. `mutate`
 * derives a broken variant from the recording for schema-drift tests; the
 * file on disk is never the thing being edited.
 */
export function replay(name: string, mutate?: (body: Loose) => void): { fetchImpl: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const body = fixture(name);
    mutate?.(body);
    return new Response(JSON.stringify(body), {
      status: manifest.files[`${name}.json`].status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}
