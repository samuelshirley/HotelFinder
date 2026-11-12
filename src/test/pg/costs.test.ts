import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', async () => (await import('./harness')).clientModule());

import { rawQuery, resetDb, seedUser } from './harness';
import { seedSearch } from './fixtures';
import { costDistribution, searchCosts, searchLedger, unattributedSince } from '@/server/repos/costs';
import { logUsage, type UsageInput } from '@/server/repos/usage';

beforeEach(resetDb);

const T0 = new Date('2026-11-12T09:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

/** A ledger row at a fixed time: `logUsage` stamps now(), so the time is set after. */
async function row(minute: number, event: UsageInput) {
  const r = await logUsage(event);
  await rawQuery('update usage_events set created_at = $1 where id = $2', [at(minute), r.id]);
  return r;
}
async function startedAt(sessionId: string, minute: number) {
  await rawQuery('update search_sessions set created_at = $1 where id = $2', [at(minute), sessionId]);
}

describe('cost per search', () => {
  it('sums own rows by provider, counts Jev settles and agent calls, and leaves analytics out', async () => {
    const { session } = await seedSearch();
    await startedAt(session.id, 0);
    const s = { sessionId: session.id, success: true };
    await row(1, { ...s, provider: 'jev', costMicrocents: 9_513, meta: { decision: 'settled' } });
    await row(2, { ...s, provider: 'jev', costMicrocents: 9_000, meta: { decision: 'defer' } });
    await row(2, { ...s, provider: 'anthropic', model: 'claude-haiku-5-5', costMicrocents: 60_000, meta: { purpose: 'agent' } });
    await row(3, { ...s, provider: 'anthropic', costMicrocents: 8_000, meta: { purpose: 'near' } });
    await row(3, { ...s, provider: 'liteapi:search', costMicrocents: 0, meta: { pricing: 'free', sandbox: true } });
    await row(3, { ...s, provider: 'liteapi:content', costMicrocents: 0, meta: { pricing: 'unpriced', sandbox: true } });
    await row(4, { ...s, provider: 'liteapi:place', success: false, costMicrocents: 1_000_000, meta: { pricing: 'per_call' } });
    await row(5, { ...s, provider: 'app', costMicrocents: 0, meta: { event: 'detail_open' } });

    const [c] = await searchCosts(at(-1));
    expect(c).toMatchObject({
      sessionId: session.id,
      label: 'Porto',
      totalMicrocents: 1_086_513,
      split: { anthropic: 68_000, jev: 18_513, liteapi: 1_000_000, other: 0 },
      calls: 7,
      failures: 1,
      unpricedCalls: 1,
      jevAsked: 2,
      jevSettled: 1,
      agentCalls: 1,
      sandbox: true,
    });
  });

  it("charges a visitor's place lookups to the search they start next, and only that one", async () => {
    const a1 = (await seedSearch({ anonId: 'visitor' })).session;
    await startedAt(a1.id, 10);
    const a2 = (await seedSearch({ anonId: 'visitor' })).session;
    await startedAt(a2.id, 30);
    const other = (await seedSearch({ anonId: 'someone-else' })).session;
    await startedAt(other.id, 30);

    const lookup = { anonId: 'visitor', provider: 'liteapi:places', success: true, costMicrocents: 1_000_000 };
    await row(5, lookup); // before a1
    await row(8, lookup); // before a1
    await row(20, lookup); // after a1, before a2 → a2
    await row(40, lookup); // after both: no search yet
    await row(6, { ...lookup, anonId: 'stranger' }); // never searched

    const ledger1 = await searchLedger(a1.id);
    expect(ledger1.map((r) => [r.provider, r.preSearch])).toEqual([
      ['liteapi:places', true],
      ['liteapi:places', true],
    ]);
    expect((await searchLedger(a2.id)).length).toBe(1);
    expect(await searchLedger(other.id)).toEqual([]);

    const costs = Object.fromEntries((await searchCosts(at(0))).map((c) => [c.sessionId, c.totalMicrocents]));
    expect(costs).toEqual({ [a1.id]: 2_000_000, [a2.id]: 1_000_000, [other.id]: 0 });

    // Not charged to any search: the stranger's lookup and the visitor's latest one.
    expect(await unattributedSince(at(0))).toEqual({
      calls: 2,
      totalMicrocents: 2_000_000,
      byProvider: [{ provider: 'liteapi:places', calls: 2, totalMicrocents: 2_000_000 }],
    });
  });

  it("matches a signed-in visitor's lookups by user, not by anon id", async () => {
    const user = await seedUser();
    const { session } = await seedSearch({ userId: user.id });
    await startedAt(session.id, 10);
    await row(5, { userId: user.id, provider: 'liteapi:places', success: true, costMicrocents: 1_000_000 });
    await row(5, { anonId: 'anon-1', provider: 'liteapi:places', success: true, costMicrocents: 1_000_000 });
    expect((await searchCosts(at(0)))[0].totalMicrocents).toBe(1_000_000);
  });

  it('gives the median, p90 and max over searches in the window, zero-cost searches included', async () => {
    const totals = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900];
    for (const [i, t] of totals.entries()) {
      const { session } = await seedSearch({ anonId: `v${i}` });
      await startedAt(session.id, i);
      if (t) await row(i, { sessionId: session.id, provider: 'anthropic', success: true, costMicrocents: t });
    }
    const old = (await seedSearch({ anonId: 'old' })).session;
    await startedAt(old.id, -60);
    await row(-60, { sessionId: old.id, provider: 'anthropic', success: true, costMicrocents: 1_000_000 });

    expect(await costDistribution(at(0))).toEqual({
      searches: 10,
      medianMicrocents: 450,
      p90Microcents: 810,
      maxMicrocents: 900,
      totalMicrocents: 4_500,
    });
    expect((await searchCosts(at(0), 3)).map((c) => c.totalMicrocents)).toEqual([900, 800, 700]);
  });

  it('is empty, not an error, with no searches', async () => {
    expect(await costDistribution(at(0))).toEqual({ searches: 0, medianMicrocents: 0, p90Microcents: 0, maxMicrocents: 0, totalMicrocents: 0 });
    expect(await searchCosts(at(0))).toEqual([]);
  });
});
