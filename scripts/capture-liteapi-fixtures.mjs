#!/usr/bin/env node
/**
 * Records real LiteAPI SANDBOX responses into
 * src/server/supplier/liteapi/__fixtures__/ for the adapter tests.
 *
 * Supplier payloads in tests are captured, never hand-written. Each file is
 * the response body exactly as received, with ONE exception applied here and
 * nowhere else: the prebook `secretKey` (a Stripe client secret) is replaced
 * by a fixed marker so no payment secret is committed. `manifest.json` records
 * the request, the status and a sha256 of every file; fixturesGuard.test.ts
 * fails if a file no longer matches its hash, i.e. if someone edits one.
 *
 * Refuses to run with anything but a `sand_` key. Makes one sandbox booking
 * and cancels it; no money moves in the sandbox.
 *
 *   node scripts/capture-liteapi-fixtures.mjs
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'src/server/supplier/liteapi/__fixtures__');
mkdirSync(outDir, { recursive: true });

function envValue(name) {
  if (process.env[name]) return process.env[name];
  const line = readFileSync(path.join(root, '.env'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : undefined;
}

const key = envValue('LITE_API_KEY');
if (!key) throw new Error('LITE_API_KEY is not set (env or .env)');
if (!key.startsWith('sand_')) throw new Error('refusing to capture with a non-sandbox key');

const DATA = 'https://api.liteapi.travel/v3.0';
const BOOK = 'https://book.liteapi.travel/v3.0';
const SECRET_MARKER = 'REDACTED_AT_CAPTURE';

const manifest = { capturedAt: new Date().toISOString(), note: 'LiteAPI sandbox. Do not edit fixture files by hand.', files: {} };

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, k === 'secretKey' && typeof v === 'string' ? SECRET_MARKER : redact(v)]),
    );
  }
  return value;
}

async function capture(name, method, url, body) {
  const started = Date.now();
  const res = await fetch(url, {
    method,
    headers: { 'X-API-Key': key, accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${name}: HTTP ${res.status}, body is not JSON (${text.length} bytes)`);
  }
  const redacted = redact(json);
  const serialized = JSON.stringify(redacted, null, 2) + '\n';
  writeFileSync(path.join(outDir, `${name}.json`), serialized);
  manifest.files[`${name}.json`] = {
    method,
    url,
    request: body ?? null,
    status: res.status,
    latencyMs: Date.now() - started,
    bytes: text.length,
    redactedFields: text.includes('"secretKey"') ? ['secretKey'] : [],
    sha256: createHash('sha256').update(serialized).digest('hex'),
  };
  console.log(`${String(res.status).padEnd(4)} ${name}  ${text.length} B  ${Date.now() - started} ms`);
  await new Promise((r) => setTimeout(r, 300)); // sandbox allows 5 requests per second
  return { status: res.status, json };
}

const stay = { occupancies: [{ adults: 2 }], currency: 'EUR', guestNationality: 'ES', checkin: '2026-12-11', checkout: '2026-12-13' };

await capture('places-porto-ribeira', 'GET', `${DATA}/data/places?textQuery=${encodeURIComponent('Ribeira Porto')}`);
const city = await capture('rates-city-porto', 'POST', `${DATA}/hotels/rates`, {
  ...stay, cityName: 'Porto', countryCode: 'PT', limit: 20, maxRatesPerHotel: 1, includeHotelData: true,
});
await capture('rates-family-two-rooms', 'POST', `${DATA}/hotels/rates`, {
  ...stay, occupancies: [{ adults: 2, children: [4, 9] }, { adults: 2 }], cityName: 'Porto', countryCode: 'PT', limit: 5, maxRatesPerHotel: 1, includeHotelData: true,
});
await capture('rates-no-availability', 'POST', `${DATA}/hotels/rates`, {
  ...stay, hotelIds: ['lp0000000'], maxRatesPerHotel: 1,
});
await capture('rates-error-missing-nationality', 'POST', `${DATA}/hotels/rates`, {
  occupancies: stay.occupancies, currency: 'EUR', checkin: stay.checkin, checkout: stay.checkout, hotelIds: ['lp1f67a6'],
});

const hotels = city.json.data ?? [];
const firstHotelId = hotels[0]?.hotelId;
if (!firstHotelId) throw new Error('city search returned no hotels; cannot continue');
await capture('rates-one-hotel', 'POST', `${DATA}/hotels/rates`, { ...stay, hotelIds: [firstHotelId], maxRatesPerHotel: 4 });
await capture('hotel-details', 'GET', `${DATA}/data/hotel?hotelId=${firstHotelId}`);
await capture('reviews-with-sentiment', 'GET', `${DATA}/data/reviews?hotelId=${firstHotelId}&limit=3&getSentiment=true`);

// Prefer a refundable offer so the cancel fixture shows a real policy.
const all = hotels.flatMap((h) => h.roomTypes.map((rt) => ({ hotelId: h.hotelId, rt })));
const refundable = all.find((x) => x.rt.rates?.[0]?.cancellationPolicies?.refundableTag === 'RFN') ?? all[0];
const other = all.find((x) => x !== refundable) ?? refundable;

await capture('prebook-payment-sdk', 'POST', `${BOOK}/rates/prebook`, { offerId: other.rt.offerId, usePaymentSdk: true });
await capture('prebook-error-invalid-offer', 'POST', `${BOOK}/rates/prebook`, { offerId: 'not-a-real-offer', usePaymentSdk: true });

// The booking chain. ACC_CREDIT_CARD is the sandbox-only way to book without a
// browser payment; the app itself only ever books with TRANSACTION_ID.
const pre = await capture('prebook-for-booking', 'POST', `${BOOK}/rates/prebook`, { offerId: refundable.rt.offerId, usePaymentSdk: false });
const prebookId = pre.json.data?.prebookId;
if (prebookId) {
  const guest = { firstName: 'Fixture', lastName: 'Guest', email: 'guest@fixture.hotelfinder.invalid' };
  const booked = await capture('book-confirmed', 'POST', `${BOOK}/rates/book`, {
    prebookId, holder: guest, payment: { method: 'ACC_CREDIT_CARD' }, guests: [{ occupancyNumber: 1, ...guest }],
  });
  const bookingId = booked.json.data?.bookingId;
  if (bookingId) {
    await capture('booking-get', 'GET', `${BOOK}/bookings/${bookingId}`);
    await capture('booking-cancel', 'PUT', `${BOOK}/bookings/${bookingId}`);
    await capture('booking-get-after-cancel', 'GET', `${BOOK}/bookings/${bookingId}`);
  }
  // Sending the same prebookId again. On 2026-11-11 the sandbox answered with a
  // SECOND confirmed booking, not an error, so the app must never call book
  // twice for one prebook. Recorded as evidence; the extra booking is cancelled.
  const again = await capture('book-same-prebook-again', 'POST', `${BOOK}/rates/book`, {
    prebookId, holder: guest, payment: { method: 'ACC_CREDIT_CARD' }, guests: [{ occupancyNumber: 1, ...guest }],
  });
  const secondId = again.json.data?.bookingId;
  if (secondId && secondId !== bookingId) await capture('booking-cancel-second', 'PUT', `${BOOK}/bookings/${secondId}`);
}
await capture('booking-get-error-unknown', 'GET', `${BOOK}/bookings/does-not-exist`);

writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${Object.keys(manifest.files).length} fixtures + manifest.json`);
