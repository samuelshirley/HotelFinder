import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { FIXTURES_DIR, manifest } from './fixtures';

/**
 * Google's payloads are recorded, never hand-written. The capture script
 * writes a sha256 of every file into manifest.json; an edited, added or
 * hand-made fixture fails here. To change one, re-run
 * `node scripts/capture-google-fixtures.mjs`.
 */
describe('recorded Google Places fixtures', () => {
  const onDisk = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort();

  it('every fixture on disk is in the manifest and nothing in the manifest is missing', () => {
    expect(onDisk).toEqual(Object.keys(manifest.files).sort());
    expect(onDisk.length).toBeGreaterThanOrEqual(5);
  });

  it('every fixture is byte-identical to what was captured', () => {
    for (const file of onDisk) {
      const hash = createHash('sha256').update(readFileSync(path.join(FIXTURES_DIR, file))).digest('hex');
      expect(hash, `${file} was edited after capture`).toBe(manifest.files[file].sha256);
    }
  });

  it('no fixture carries an API key', () => {
    for (const file of [...onDisk, 'manifest.json']) {
      const text = readFileSync(path.join(FIXTURES_DIR, file), 'utf8');
      expect(text, file).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
      expect(text, file).not.toMatch(/X-Goog-Api-Key/i);
    }
  });

  it('came from Google Places (New) Nearby Search', () => {
    for (const [file, entry] of Object.entries(manifest.files)) {
      expect(entry.url, file).toBe('https://places.googleapis.com/v1/places:searchNearby');
    }
  });
});
