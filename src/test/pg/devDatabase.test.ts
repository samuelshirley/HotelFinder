import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import * as schema from '@/server/db/schema';

/**
 * The REAL database client (not the test harness), on the embedded Postgres
 * that `npm run dev` uses: migrations from drizzle/ applied on first use, and
 * the repos working through the lazy client.
 */
describe('the development database', () => {
  afterAll(() => vi.unstubAllEnvs());

  it('boots from the migrations and the repos work through the lazy client', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('HOTEL_FINDER_DATA_DIR', mkdtempSync(path.join(tmpdir(), 'hf-db-')));
    const { createSession, addStay, listStays, updateStay } = await import('@/server/repos/sessions');
    const { enqueueTurn, promoteToRunning, finishTurn } = await import('@/server/repos/turns');
    const { appendMessage, listMessages } = await import('@/server/repos/chat');
    const { replaceFinderShortlist } = await import('@/server/repos/finderShortlist');
    const { upsertProperty } = await import('@/server/repos/properties');
    const { insertOffers } = await import('@/server/repos/offers');
    const { listShortlist } = await import('@/server/repos/shortlist');
    const { countRequest } = await import('@/server/repos/rateLimit');

    const session = await createSession({ anonId: 'dev-anon' });
    const stay = await addStay(session.id, { destinationText: 'Porto', checkIn: '2026-12-11', checkOut: '2026-12-13' });
    expect((await updateStay(stay.id, session.id, { adults: 3 }))?.adults).toBe(3);
    expect(await listStays(session.id)).toHaveLength(1);

    const { turn } = await enqueueTurn({ sessionId: session.id, idempotencyKey: 'dev-key-1', userMessage: 'hello' });
    expect((await promoteToRunning(turn.id))?.status).toBe('running');
    expect((await finishTurn(turn.id, { finalText: 'ok', resultMeta: { a: 1 } }))?.status).toBe('done');
    await appendMessage({ sessionId: session.id, role: 'user', kind: 'user', content: 'one' });
    await appendMessage({ sessionId: session.id, role: 'assistant', kind: 'line', content: 'two' });
    expect((await listMessages(session.id)).map((m) => m.content)).toEqual(['one', 'two']);

    // A transaction, a join and an upsert all go through the same lazy client.
    const property = await upsertProperty({ supplier: 'liteapi', supplierHotelId: 'lp1', name: 'Dev Hotel' });
    const [offer] = await insertOffers([
      { sessionId: session.id, stayId: stay.id, propertyId: property.id, supplier: 'liteapi', supplierOfferId: 'o', audience: 'public', marginPct: '15.00', currency: 'EUR', totalMinor: 10000, fetchedAt: new Date('2026-11-11T10:00:00Z'), expiresAt: new Date('2026-11-11T10:15:00Z') },
    ]);
    await replaceFinderShortlist(session.id, stay.id, [{ propertyId: property.id, offerId: offer.id, rank: 1, reason: { kind: 'cheapest_meeting_all_musts' } }]);
    expect((await listShortlist(session.id, stay.id, 'public'))[0]).toMatchObject({ property: { name: 'Dev Hotel' }, offer: { totalMinor: 10000 } });

    const now = new Date('2026-11-11T10:00:30Z');
    expect((await countRequest('turn:1.2.3.4', now, 60_000, 2)).allowed).toBe(true);
    expect((await countRequest('turn:1.2.3.4', now, 60_000, 2)).allowed).toBe(true);
    expect(await countRequest('turn:1.2.3.4', now, 60_000, 2)).toEqual({ allowed: false, count: 3 });
    expect((await countRequest('turn:5.6.7.8', now, 60_000, 2)).count).toBe(1);
    expect((await countRequest('turn:1.2.3.4', new Date('2026-11-11T10:01:00Z'), 60_000, 2)).count).toBe(1);
  }, 30_000);

  it('the migrations in drizzle/ build exactly the schema: nothing left to generate', async () => {
    // One database from the migrations, one from the schema itself; they must
    // have the same columns, indexes and constraints.
    const describeDb = async (client: PGlite) => {
      const q = async (sql: string) => (await client.query<Record<string, unknown>>(sql)).rows.map((r) => JSON.stringify(r)).sort();
      return {
        columns: await q(
          `select table_name, column_name, data_type, udt_name, is_nullable, column_default
             from information_schema.columns where table_schema = 'public'`,
        ),
        indexes: await q(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public'`),
        constraints: await q(
          `select c.conname, c.contype, t.relname, pg_get_constraintdef(c.oid) as def
             from pg_constraint c join pg_class t on t.oid = c.conrelid
             join pg_namespace n on n.oid = t.relnamespace where n.nspname = 'public'`,
        ),
        enums: await q(`select t.typname, e.enumlabel, e.enumsortorder from pg_enum e join pg_type t on t.oid = e.enumtypid`),
      };
    };

    const migrated = new PGlite();
    await migrate(drizzle(migrated, { schema }), { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });
    const pushed = new PGlite();
    for (const statement of inject('pgSchemaDdl')) await pushed.exec(statement);

    const [a, b] = [await describeDb(migrated), await describeDb(pushed)];
    await migrated.close();
    await pushed.close();
    expect(a.columns.length).toBeGreaterThan(100);
    expect(a, 'run `npm run db:generate` and commit the new migration').toEqual(b);
  }, 30_000);
});
