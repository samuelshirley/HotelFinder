import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/repos/usage', () => ({ logUsage: vi.fn(async () => ({})) }));

import { dayStart, findKey, hourStart, matchesHint, sumUsage } from './providerUsage';

/** Recorded from the real Admin API (2026-11-12), grouped by model only: no key or workspace ids. */
const fixture = (name: string) => JSON.parse(readFileSync(path.join(import.meta.dirname, '__fixtures__', name), 'utf8'));

describe('matching the app key to Admin API key hints', () => {
  // Hints are synthetic here: real ones would put a slice of each key in a public repo.
  const key = 'sk-ant-usr-1ABcdefghijklmnopqrstuvwxyzXY12';
  it('matches the hint by prefix and suffix', () => {
    expect(matchesHint(key, 'sk-ant-usr-1AB...XY12')).toBe(true);
    expect(matchesHint(key, 'sk-ant-usr-1AC...XY12')).toBe(false);
    expect(matchesHint(key, 'sk-ant-usr-1AB...XY13')).toBe(false);
    expect(matchesHint(key, null)).toBe(false);
    expect(matchesHint(key, 'no-separator')).toBe(false);
  });

  it('finds exactly one live key; ambiguity or only archived matches is no match', () => {
    const live = { id: 'k1', name: 'hotel-finder', partial_key_hint: 'sk-ant-usr-1AB...XY12', status: 'active', workspace_id: null };
    const other = { id: 'k2', name: 'other', partial_key_hint: 'sk-ant-usr-9ZZ...0000', status: 'active' };
    expect(findKey([other, live], key)).toEqual({ id: 'k1', name: 'hotel-finder', workspaceId: null });
    expect(findKey([{ ...live, status: 'archived' }], key)).toBeNull();
    expect(findKey([live, { ...live, id: 'k3' }], key)).toBeNull();
    expect(findKey([other], key)).toBeNull();
  });
});

describe('summing a usage report', () => {
  it('adds every bucket, both cache-write kinds, and ends at the last bucket', () => {
    const { tokens, byModel, through } = sumUsage([fixture('anthropic-usage-report-hourly.json')]);
    expect(tokens).toEqual({ input: 4584 + 3267, output: 1548 + 492, cacheRead: 12392 + 3915, cacheWrite: 8306 + 7830 });
    expect(Object.keys(byModel)).toEqual(['claude-haiku-5-5']);
    expect(through).toEqual(new Date('2026-11-12T11:00:00Z'));
  });

  it('reads day buckets the same way, across pages', () => {
    const day = fixture('anthropic-usage-report.json');
    const { tokens, through } = sumUsage([day, day]);
    expect(tokens).toEqual({ input: 2 * 27144, output: 2 * 7901, cacheRead: 2 * 77117, cacheWrite: 2 * 28874 });
    expect(through).toEqual(new Date('2026-11-12T00:00:00Z'));
  });

  it('is zero with nothing reported', () => {
    expect(sumUsage([{ data: [] }])).toEqual({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {}, through: null });
  });

  it('starts an hourly window on the hour', () => {
    expect(hourStart(new Date('2026-11-05T11:06:42Z'))).toEqual(new Date('2026-11-05T11:00:00Z'));
  });

  it('starts a daily window at the UTC day the report buckets start on', () => {
    expect(dayStart(new Date('2026-11-12T23:30:00+01:00'))).toEqual(new Date('2026-11-12T00:00:00Z'));
    expect(dayStart(new Date('2026-11-12T00:30:00+01:00'))).toEqual(new Date('2026-11-11T00:00:00Z'));
  });
});
