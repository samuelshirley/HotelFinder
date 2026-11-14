#!/usr/bin/env node
/**
 * Records real Google Places (New) Nearby Search responses into
 * src/server/sights/__fixtures__/ for the sights tests (docs/sights.md).
 *
 * Payloads in tests are captured, never hand-written. Each file is the
 * response body exactly as received; `manifest.json` records the request, the
 * status and a sha256 of every file, and fixturesGuard.test.ts fails if a file
 * no longer matches its hash. The API key is sent in a header and never
 * written anywhere.
 *
 * Each call is one billed Nearby Search (Enterprise) request: five in all.
 *
 *   node scripts/capture-google-fixtures.mjs
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'src/server/sights/__fixtures__');
mkdirSync(outDir, { recursive: true });

function envValue(name) {
  if (process.env[name]) return process.env[name];
  const line = readFileSync(path.join(root, '.env'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : undefined;
}

const key = envValue('GOOGLE_MAPS_API_KEY');
if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set (env or .env): run scripts/google-key.sh --local');

const URL = 'https://places.googleapis.com/v1/places:searchNearby';
// Must stay equal to FIELD_MASK and the body built in src/server/sights/google.ts (a test compares them).
const FIELD_MASK = 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.primaryType,places.businessStatus';
const body = (types, centre, languageCode = 'en') => ({
  includedPrimaryTypes: types,
  maxResultCount: 20,
  rankPreference: 'POPULARITY',
  languageCode,
  locationRestriction: { circle: { center: centre, radius: 8000 } },
});

// The points are the supplier's own for each town (liteapi/__fixtures__/place-porto.json, place-annecy.json).
const PORTO = { latitude: 41.1579438, longitude: -8.629105299999999 };
const ANNECY = { latitude: 45.9058956, longitude: 6.1259117 };
const MUSEUMS = ['museum', 'art_museum', 'history_museum'];

const CASES = [
  ['nearby-museums-porto', body(MUSEUMS, PORTO)],
  ['nearby-museums-porto-es', body(MUSEUMS, PORTO, 'es')],
  ['nearby-galleries-porto', body(['art_gallery'], PORTO)],
  ['nearby-museums-annecy', body(MUSEUMS, ANNECY)],
  // A place type Google does not have: the error body the adapter must survive.
  ['nearby-error-bad-type', body(['not_a_place_type'], PORTO)],
];

const files = {};
for (const [name, request] of CASES) {
  const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK }, body: JSON.stringify(request) });
  const text = await res.text();
  if (text.includes(key)) throw new Error(`${name}: the response echoes the key; not written`);
  writeFileSync(path.join(outDir, `${name}.json`), text);
  files[`${name}.json`] = { method: 'POST', url: URL, fieldMask: FIELD_MASK, request, status: res.status, sha256: createHash('sha256').update(text).digest('hex') };
  console.log(`${res.status} ${name} (${text.length} bytes)`);
}
writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify({ capturedAt: new Date().toISOString(), files }, null, 2)}\n`);
