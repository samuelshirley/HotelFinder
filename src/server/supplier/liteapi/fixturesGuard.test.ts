import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { FIXTURES_DIR, manifest } from './fixtures';

/**
 * Supplier payloads are recorded, never hand-written. The capture script
 * writes a sha256 of every file into manifest.json; an edited, added or
 * hand-made fixture fails here. To change a fixture, re-run
 * `node scripts/capture-liteapi-fixtures.mjs`.
 */
describe('recorded fixtures', () => {
  const onDisk = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort();

  it('every fixture on disk is in the manifest and nothing in the manifest is missing', () => {
    expect(onDisk).toEqual(Object.keys(manifest.files).sort());
    expect(onDisk.length).toBeGreaterThanOrEqual(18);
  });

  it('every fixture is byte-identical to what was captured', () => {
    for (const file of onDisk) {
      const hash = createHash('sha256').update(readFileSync(path.join(FIXTURES_DIR, file))).digest('hex');
      expect(hash, `${file} was edited after capture`).toBe(manifest.files[file].sha256);
    }
  });

  it('no fixture carries an API key or a payment secret', () => {
    for (const file of [...onDisk, 'manifest.json']) {
      const text = readFileSync(path.join(FIXTURES_DIR, file), 'utf8');
      expect(text, file).not.toMatch(/\b(sand|prod)_[0-9a-f]{8}-/);
      expect(text, file).not.toMatch(/_secret_/);
      expect(text, file).not.toMatch(/X-API-Key/i);
    }
  });

  it('came from the sandbox', () => {
    for (const [file, entry] of Object.entries(manifest.files)) {
      expect(entry.url, file).toMatch(/^https:\/\/(api|book)\.liteapi\.travel\/v3\.0\//);
    }
    expect(JSON.parse(readFileSync(path.join(FIXTURES_DIR, 'rates-city-porto.json'), 'utf8')).sandbox).toBe(true);
  });
});
