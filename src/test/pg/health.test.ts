import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it, vi } from 'vitest';

import { describeFailure, isSchemaDrift } from '@/lib/pgErrors';
import * as schema from '@/server/db/schema';

vi.mock('server-only', () => ({}));

/**
 * The 2026-11-13 outage, reproduced: production ran the code of migration
 * 0005 on a database migrated only to 0004, so every typed search wrote a
 * usage_events column that was not there and answered 500. The health check
 * must name it, and applying drizzle/ (what the production build now does,
 * scripts/migrate.mjs) must clear it.
 */
const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock('@/server/db/client', () => ({ db, schema }));

const REPO = path.resolve(process.cwd(), 'drizzle');
const journal = JSON.parse(readFileSync(path.join(REPO, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };

/** drizzle/ as it stood up to and including `tag`. */
function migrationsUpTo(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'hf-mig-'));
  cpSync(REPO, dir, { recursive: true });
  const upTo = journal.entries.findIndex((e) => e.tag === tag);
  expect(upTo).toBeGreaterThanOrEqual(0);
  writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, upTo + 1) }));
  return dir;
}

describe('the health check', () => {
  it('names the column production was missing, then is healthy once drizzle/ is applied', async () => {
    const { schemaDrift } = await import('@/server/repos/health');

    await migrate(db, { migrationsFolder: migrationsUpTo('0004_near_misses') });
    const before = await schemaDrift();
    expect(before.missingColumns).toContain('usage_events.anon_id');
    expect(before.missingTables).toEqual([]);
    expect(before.pendingMigrations).toBe(journal.entries.length - 5);

    // The query that failed in production fails here the same way.
    const { logUsage } = await import('@/server/repos/usage');
    const failure = await logUsage({ provider: 'anthropic', success: true, anonId: 'a' } as Parameters<typeof logUsage>[0]).catch((e: unknown) => e);
    expect(isSchemaDrift(failure)).toBe(true);
    expect(describeFailure(failure)).toMatch(/^SCHEMA DRIFT pg=42703 .*column "anon_id" of relation "usage_events" does not exist/);

    await migrate(db, { migrationsFolder: REPO });
    expect(await schemaDrift()).toEqual({ missingTables: [], missingColumns: [], pendingMigrations: 0 });
  }, 30_000);

  it('knows every table schema.ts declares', async () => {
    const { expectedColumns } = await import('@/server/repos/health');
    const tables = new Set(expectedColumns().map((c) => c.table));
    expect(tables.size).toBe(18);
    expect(expectedColumns()).toContainEqual({ table: 'usage_events', column: 'anon_id' });
  });
});
