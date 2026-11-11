import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { pgError, rawQuery, resetDb, seedUser, testDb } from './harness';
import { seedOffer, seedProperty, seedSearch } from './fixtures';
import { eq } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { getMeta, setMeta } from '@/server/repos/appMeta';
import { createPrebooked, getBookingByPrebook, listBookingsForUser, transitionBooking } from '@/server/repos/bookings';
import { confirmPreferences, getPreferences } from '@/server/repos/preferences';
import { aiSpendMicrocentsSince, logUsage } from '@/server/repos/usage';

beforeEach(resetDb);

describe('usage ledger', () => {
  it('only Anthropic and Jev rows count toward AI spend', async () => {
    const user = await seedUser();
    const base = { userId: user.id, success: true };
    await logUsage({ ...base, provider: 'anthropic', model: 'claude-haiku-4-5-20251001', costMicrocents: 2_000_000 });
    await logUsage({ ...base, provider: 'anthropic:intent-scan', costMicrocents: 50_000 });
    await logUsage({ ...base, provider: 'jev', model: 'jev-latest', costMicrocents: 2_100 });
    await logUsage({ ...base, provider: 'liteapi:search', costMicrocents: 0, latencyMs: 3600 });
    await logUsage({ ...base, provider: 'google:places', costMicrocents: 3_200_000 });
    expect(await aiSpendMicrocentsSince({ userId: user.id }, new Date(0))).toBe(2_052_100);
  });

  it('scopes spend to a session for anonymous users and to a time window', async () => {
    const { session } = await seedSearch();
    const other = await seedSearch({ anonId: 'anon-2' });
    await logUsage({ sessionId: session.id, provider: 'anthropic', success: true, costMicrocents: 100 });
    await logUsage({ sessionId: other.session.id, provider: 'anthropic', success: true, costMicrocents: 999 });
    expect(await aiSpendMicrocentsSince({ sessionId: session.id }, new Date(0))).toBe(100);
    expect(await aiSpendMicrocentsSince({ sessionId: session.id }, new Date(Date.now() + 60_000))).toBe(0);
  });

  it('holds a cost larger than int4 and keeps failures', async () => {
    const row = await logUsage({
      provider: 'anthropic',
      success: false,
      errorMessage: 'overloaded',
      costMicrocents: 3_000_000_000,
      meta: { toolTrace: ['resolve_place'] },
    });
    expect(row).toMatchObject({ costMicrocents: 3_000_000_000, success: false, errorMessage: 'overloaded' });
  });

  it('spend history survives account deletion anonymously', async () => {
    const user = await seedUser();
    await logUsage({ userId: user.id, provider: 'anthropic', success: true, costMicrocents: 5 });
    const { db } = await testDb();
    await db.delete(schema.users).where(eq(schema.users.id, user.id));
    const rows = await rawQuery<{ user_id: string | null; cost_microcents: string }>(
      'select user_id, cost_microcents from usage_events',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBeNull();
  });
});

describe('preferences', () => {
  it('stores only what was confirmed and replaces it on the next yes', async () => {
    const user = await seedUser();
    expect(await getPreferences(user.id)).toBeNull();
    await confirmPreferences(
      user.id,
      { priority: 'closest', adults: 2, childrenAges: [], mustHaves: ['pets_allowed'], guestNationality: 'ES' },
      new Date('2026-11-11T10:00:00Z'),
    );
    const second = await confirmPreferences(
      user.id,
      { priority: 'cheapest', adults: 4, childrenAges: [6], mustHaves: [], guestNationality: 'ES' },
      new Date('2026-12-01T09:00:00Z'),
    );
    expect(second).toMatchObject({ priority: 'cheapest', adults: 4, childrenAges: [6], mustHaves: [] });
    expect(second.confirmedAt.toISOString()).toBe('2026-12-01T09:00:00.000Z');
    expect(await rawQuery('select 1 from user_preferences')).toHaveLength(1);
  });
});

describe('bookings', () => {
  async function prebooked() {
    const user = await seedUser();
    const { session, stay } = await seedSearch({ userId: user.id });
    const property = await seedProperty();
    const offer = await seedOffer({ sessionId: session.id, stayId: stay.id, propertyId: property.id });
    const booking = await createPrebooked({
      userId: user.id,
      sessionId: session.id,
      offerId: offer.id,
      supplier: 'liteapi',
      prebookId: 'xZFwjDyps',
      transactionId: 'tr_ct_K5NdYC5eG',
      currency: 'EUR',
      totalMinor: 28500,
      quotedTotalMinor: 28129,
    });
    return { user, booking };
  }

  it('keeps the prebook pair and both prices', async () => {
    const { booking } = await prebooked();
    expect(await getBookingByPrebook('liteapi', 'xZFwjDyps')).toMatchObject({
      id: booking.id,
      transactionId: 'tr_ct_K5NdYC5eG',
      status: 'prebooked',
      totalMinor: 28500,
      quotedTotalMinor: 28129,
    });
  });

  it('walks the legal path and refuses to skip a step', async () => {
    const { booking } = await prebooked();
    expect(await transitionBooking(booking.id, 'confirmed')).toBeNull();
    expect(await transitionBooking(booking.id, 'paid')).toBeNull();
    expect((await transitionBooking(booking.id, 'payment_pending'))?.status).toBe('payment_pending');
    expect((await transitionBooking(booking.id, 'paid'))?.status).toBe('paid');
    expect(await transitionBooking(booking.id, 'confirmed')).toBeNull();
    expect((await transitionBooking(booking.id, 'booking'))?.status).toBe('booking');
    const confirmed = await transitionBooking(booking.id, 'confirmed', {
      supplierBookingId: 'bk_1',
      hotelConfirmationCode: 'H123',
    });
    expect(confirmed).toMatchObject({ status: 'confirmed', supplierBookingId: 'bk_1', hotelConfirmationCode: 'H123' });
    expect(await transitionBooking(booking.id, 'failed')).toBeNull();
    expect((await transitionBooking(booking.id, 'cancelled'))?.status).toBe('cancelled');
  });

  it('only one caller wins the claim to call the supplier', async () => {
    const { booking } = await prebooked();
    await transitionBooking(booking.id, 'payment_pending');
    await transitionBooking(booking.id, 'paid');
    const claims = await Promise.all([1, 2, 3, 4].map(() => transitionBooking(booking.id, 'booking')));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('a payment that cleared can still fail at book', async () => {
    const { booking } = await prebooked();
    await transitionBooking(booking.id, 'payment_pending');
    await transitionBooking(booking.id, 'paid');
    await transitionBooking(booking.id, 'booking');
    expect((await transitionBooking(booking.id, 'failed'))?.status).toBe('failed');
    expect(await transitionBooking(booking.id, 'confirmed')).toBeNull();
  });

  it('the same prebook cannot be recorded twice', async () => {
    const { user } = await prebooked();
    const err = await pgError(
      createPrebooked({
        userId: user.id,
        sessionId: (await seedSearch({ userId: user.id })).session.id,
        offerId: null as never,
        supplier: 'liteapi',
        prebookId: 'xZFwjDyps',
        transactionId: 'tr_other',
        currency: 'EUR',
        totalMinor: 1,
        quotedTotalMinor: 1,
      }),
    );
    expect(err.code).toBe('23505');
  });

  it('the booking record outlives the account', async () => {
    const { user, booking } = await prebooked();
    expect(await listBookingsForUser(user.id)).toHaveLength(1);
    const { db } = await testDb();
    await db.delete(schema.users).where(eq(schema.users.id, user.id));
    const rows = await rawQuery<{ id: string; user_id: string | null; session_id: string | null }>(
      'select id, user_id, session_id from bookings',
    );
    expect(rows).toEqual([{ id: booking.id, user_id: null, session_id: null }]);
  });
});

describe('app meta', () => {
  it('reads back what was set and overwrites', async () => {
    expect(await getMeta('jev_mode')).toBeNull();
    await setMeta('jev_mode', 'on');
    await setMeta('jev_mode', 'compare');
    expect(await getMeta('jev_mode')).toBe('compare');
  });
});
