import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { pgError, rawQuery, resetDb, seedUser, testDb } from './harness';
import * as schema from '@/server/db/schema';
import {
  addStay,
  adoptAnonymousSessions,
  assertSessionOwned,
  audienceFor,
  createSession,
  listStays,
  SessionNotOwnedError,
  updateSession,
  updateStay,
} from '@/server/repos/sessions';

beforeEach(resetDb);

describe('search sessions', () => {
  it('an anonymous session opens for its cookie and for nobody else', async () => {
    const s = await createSession({ anonId: 'anon-a' });
    expect((await assertSessionOwned(s.id, { anonId: 'anon-a' })).id).toBe(s.id);
    await expect(assertSessionOwned(s.id, { anonId: 'anon-b' })).rejects.toBeInstanceOf(SessionNotOwnedError);
    const user = await seedUser();
    await expect(assertSessionOwned(s.id, { userId: user.id })).rejects.toBeInstanceOf(SessionNotOwnedError);
  });

  it('adoption hands the session to the account and locks out the cookie', async () => {
    const user = await seedUser();
    const other = await seedUser();
    const mine = await createSession({ anonId: 'anon-a' });
    const theirs = await createSession({ anonId: 'anon-z' });
    const alreadyOwned = await createSession({ userId: other.id });

    expect(await adoptAnonymousSessions('anon-a', user.id)).toBe(1);

    expect((await assertSessionOwned(mine.id, { userId: user.id })).userId).toBe(user.id);
    await expect(assertSessionOwned(mine.id, { anonId: 'anon-a' })).rejects.toBeInstanceOf(SessionNotOwnedError);
    await expect(assertSessionOwned(theirs.id, { userId: user.id })).rejects.toBeInstanceOf(SessionNotOwnedError);
    await expect(assertSessionOwned(alreadyOwned.id, { userId: user.id })).rejects.toBeInstanceOf(SessionNotOwnedError);
  });

  it('a later sign-in on the same browser does not take sessions another account already adopted', async () => {
    const first = await seedUser();
    const second = await seedUser();
    const s = await createSession({ anonId: 'shared-browser' });
    expect(await adoptAnonymousSessions('shared-browser', first.id)).toBe(1);
    expect(await adoptAnonymousSessions('shared-browser', second.id)).toBe(0);
    expect((await assertSessionOwned(s.id, { userId: first.id })).userId).toBe(first.id);
    await expect(assertSessionOwned(s.id, { userId: second.id })).rejects.toBeInstanceOf(SessionNotOwnedError);
  });

  it('audience follows sign-in state', async () => {
    const user = await seedUser();
    expect(audienceFor(await createSession({ anonId: 'a' }))).toBe('public');
    expect(audienceFor(await createSession({ userId: user.id }))).toBe('member');
  });

  it('a session with no owner at all is refused by the database', async () => {
    const { db } = await testDb();
    const err = await pgError(db.insert(schema.searchSessions).values({}));
    expect(err.code).toBe('23514');
  });

  it('stores the priority and nationality', async () => {
    const s = await createSession({ anonId: 'a' });
    const updated = await updateSession(s.id, { priority: 'closest', guestNationality: 'ES', status: 'active' });
    expect(updated).toMatchObject({ priority: 'closest', guestNationality: 'ES', status: 'active' });
  });
});

describe('stays', () => {
  it('round-trips a stay with dates as dates and children as ages', async () => {
    const s = await createSession({ anonId: 'a' });
    const stay = await addStay(s.id, {
      destinationText: 'Porto',
      checkIn: '2026-12-11',
      checkOut: '2026-12-13',
      adults: 2,
      childrenAges: [4, 9],
      mustHaves: ['pets_allowed'],
      priceCapMinor: 12000,
    });
    expect(stay).toMatchObject({ position: 0, checkIn: '2026-12-11', checkOut: '2026-12-13', childrenAges: [4, 9] });

    const [col] = await rawQuery<{ data_type: string }>(
      `select data_type from information_schema.columns where table_name = 'stays' and column_name = 'check_in'`,
    );
    expect(col.data_type).toBe('date');
  });

  it('appends stays in order and updates only within the session', async () => {
    const s = await createSession({ anonId: 'a' });
    const other = await createSession({ anonId: 'b' });
    const porto = await addStay(s.id, { destinationText: 'Porto', checkIn: '2026-12-11', checkOut: '2026-12-13' });
    await addStay(s.id, { destinationText: 'Lisbon', checkIn: '2026-12-13', checkOut: '2026-12-16' });
    expect((await listStays(s.id)).map((x) => [x.position, x.destinationText])).toEqual([
      [0, 'Porto'],
      [1, 'Lisbon'],
    ]);

    expect(await updateStay(porto.id, other.id, { adults: 4 })).toBeNull();
    expect((await updateStay(porto.id, s.id, { adults: 4 }))?.adults).toBe(4);
  });

  it('refuses a check-out on or before check-in', async () => {
    const s = await createSession({ anonId: 'a' });
    const err = await pgError(addStay(s.id, { destinationText: 'Porto', checkIn: '2026-12-13', checkOut: '2026-12-13' }));
    expect(err.code).toBe('23514');
  });
});
