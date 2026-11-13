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

/**
 * `--add-static-facts` records ONE more fixture next to the existing set
 * (compact static facts for the hotels already in rates-city-porto.json) and
 * leaves every other file and hash as it was. Rates move from minute to
 * minute, so re-recording everything would change the values the tests pin.
 */
const addStaticFacts = process.argv.includes('--add-static-facts');
const addPublicRates = process.argv.includes('--add-public-rates');
const addPlaces = process.argv.includes('--add-places');
const addCountries = process.argv.includes('--add-countries');
const addRibeiraDetails = process.argv.includes('--add-ribeira-details');
const addNonrefundableCancel = process.argv.includes('--add-nonrefundable-cancel');
const addCurrencies = process.argv.includes('--add-currencies');
const manifestPath = path.join(outDir, 'manifest.json');
const manifest = addStaticFacts || addPublicRates || addPlaces || addCountries || addRibeiraDetails || addNonrefundableCancel || addCurrencies
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : { capturedAt: new Date().toISOString(), note: 'LiteAPI sandbox. Do not edit fixture files by hand.', files: {} };

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

if (addNonrefundableCancel) {
  // A NON-refundable rate booked and cancelled: the supplier keeps the price and
  // answers CANCELLED_WITH_CHARGES (seen live 2026-11-11). Makes one sandbox booking.
  const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const search = await fetch(`${DATA}/hotels/rates`, {
    method: 'POST',
    headers: { 'X-API-Key': key, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ occupancies: [{ adults: 2 }], currency: 'EUR', guestNationality: 'ES', checkin: day(30), checkout: day(32), cityName: 'Porto', countryCode: 'PT', maxRatesPerHotel: 5, limit: 30 }),
  }).then((r) => r.json());
  const nonRefundable = search.data
    ?.flatMap((h) => h.roomTypes ?? [])
    .find((rt) => rt.rates?.some((r) => r.cancellationPolicies?.refundableTag === 'NRFN'));
  if (!nonRefundable) throw new Error('no non-refundable rate in this search; try again later');
  const pre = await capture('prebook-nonrefundable', 'POST', `${BOOK}/rates/prebook`, { offerId: nonRefundable.offerId, usePaymentSdk: true });
  const guest = { firstName: 'Fixture', lastName: 'Guest', email: 'guest@fixture.hotelfinder.invalid' };
  const booked = await capture('book-nonrefundable', 'POST', `${BOOK}/rates/book`, {
    prebookId: pre.json.data.prebookId, holder: guest, payment: { method: 'ACC_CREDIT_CARD' }, guests: [{ occupancyNumber: 1, ...guest }],
  });
  await capture('booking-cancel-with-charges', 'PUT', `${BOOK}/bookings/${booked.json.data.bookingId}`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('added prebook-nonrefundable.json, book-nonrefundable.json, booking-cancel-with-charges.json');
  process.exit(0);
}

if (addStaticFacts) {
  const recorded = JSON.parse(readFileSync(path.join(outDir, 'rates-city-porto.json'), 'utf8'));
  const ids = recorded.data.map((h) => h.hotelId).join(',');
  await capture('hotels-static-porto', 'GET', `${DATA}/data/hotels?hotelIds=${ids}`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('added hotels-static-porto.json');
  process.exit(0);
}

if (addPublicRates) {
  // The same 20 hotels at a 15% margin: what an anonymous visitor would be quoted.
  const recorded = JSON.parse(readFileSync(path.join(outDir, 'rates-city-porto.json'), 'utf8'));
  await capture('rates-city-porto-margin-15', 'POST', `${DATA}/hotels/rates`, {
    occupancies: [{ adults: 2 }], currency: 'EUR', guestNationality: 'ES', checkin: '2026-12-11', checkout: '2026-12-13',
    hotelIds: recorded.data.map((h) => h.hotelId), margin: 15, maxRatesPerHotel: 1, includeHotelData: true,
  });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('added rates-city-porto-margin-15.json');
  process.exit(0);
}

if (addRibeiraDetails) {
  // Details for every place in the recorded "Ribeira Porto" search, so a test that picks any of them has a real point.
  const places = JSON.parse(readFileSync(path.join(outDir, 'places-porto-ribeira.json'), 'utf8')).data;
  for (const [i, p] of places.entries()) await capture(`place-porto-ribeira-${i + 1}`, 'GET', `${DATA}/data/places/${encodeURIComponent(p.placeId)}`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('added Ribeira place details');
  process.exit(0);
}

if (addCountries) {
  // The countries the supplier accepts as guestNationality: src/lib/countries.ts is checked against it.
  await capture('countries', 'GET', `${DATA}/data/countries`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('added countries.json');
  process.exit(0);
}

if (addCurrencies) {
  // The currencies the supplier prices in (src/lib/currencies.ts is checked against it), the
  // same 20 Porto hotels priced in USD (the supplier converts; we never do), and what an
  // unknown code gets back.
  await capture('currencies', 'GET', `${DATA}/data/currencies`);
  const recorded = JSON.parse(readFileSync(path.join(outDir, 'rates-city-porto.json'), 'utf8'));
  const sameStay = { occupancies: [{ adults: 2 }], guestNationality: 'ES', checkin: '2026-12-11', checkout: '2026-12-13', hotelIds: recorded.data.map((h) => h.hotelId), maxRatesPerHotel: 1, includeHotelData: true };
  await capture('rates-city-porto-usd', 'POST', `${DATA}/hotels/rates`, { ...sameStay, currency: 'USD' });
  await capture('rates-currency-unknown', 'POST', `${DATA}/hotels/rates`, { ...sameStay, currency: 'XQZ' });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('added currencies.json, rates-city-porto-usd.json, rates-currency-unknown.json');
  process.exit(0);
}

if (addPlaces) {
  // Destination resolution and "close to" targets (docs/onboarding.md §1, §3.4):
  // place searches, the details that carry each place's map point, and one
  // radius search around an airport. Adds files; leaves the others untouched.
  const find = async (name, query) => (await capture(name, 'GET', `${DATA}/data/places?textQuery=${encodeURIComponent(query)}`)).json.data ?? [];
  const first = (places, type) => places.find((p) => (p.types ?? []).includes(type));
  const details = (name, placeId) => capture(name, 'GET', `${DATA}/data/places/${encodeURIComponent(placeId)}`);

  const annecy = await find('places-annecy', 'Annecy, France');
  await details('place-annecy', first(annecy, 'locality').placeId);
  await find('places-lisbon', 'Lisbon');
  const vieille = await find('places-vieille-ville-annecy', 'Vieille Ville Annecy');
  if (vieille[0]) await details('place-vieille-ville-annecy', vieille[0].placeId);
  await find('places-old-town-annecy', 'old town, Annecy');
  const porto = await find('places-porto', 'Porto, Portugal');
  await details('place-porto', first(porto, 'locality').placeId);
  const bcn = await find('places-barcelona-airport', 'Barcelona airport');
  await details('place-barcelona-airport', first(bcn, 'airport').placeId);
  const opoPlaces = await find('places-porto-airport', 'Porto airport');
  const opo = (await details('place-porto-airport', first(opoPlaces, 'airport').placeId)).json.data.location;
  await capture('countries', 'GET', `${DATA}/data/countries`);
  await capture('rates-radius-porto-airport', 'POST', `${DATA}/hotels/rates`, {
    occupancies: [{ adults: 2 }], currency: 'EUR', guestNationality: 'ES', checkin: '2026-12-11', checkout: '2026-12-13',
    latitude: opo.latitude, longitude: opo.longitude, radius: 5000, limit: 30, maxRatesPerHotel: 1, includeHotelData: true,
  });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('added place fixtures');
  process.exit(0);
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
