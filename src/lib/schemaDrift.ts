/**
 * What the code expects of the database against what the database has: every
 * table and column in schema.ts, and every migration in drizzle/. Pure; the
 * live half is `server/repos/health.ts`. An empty drift is the only healthy
 * answer: a missing column is a 500 on the first query that names it
 * (2026-11-13: usage_events.anon_id, migration 0005 never applied, every
 * typed search failed). docs/deploy.md.
 */
export type Column = { table: string; column: string };

export type SchemaDrift = {
  missingTables: string[];
  /** "table.column", for tables that exist. */
  missingColumns: string[];
  /** Migrations in drizzle/ the database has not recorded; null when it keeps no record (a test database built from DDL). */
  pendingMigrations: number | null;
};

export function diffSchema(expected: Column[], live: Column[], migrations: { inRepo: number; applied: number | null }): SchemaDrift {
  const liveTables = new Set(live.map((c) => c.table));
  const liveColumns = new Set(live.map((c) => `${c.table}.${c.column}`));
  const missingTables = [...new Set(expected.map((c) => c.table))].filter((t) => !liveTables.has(t)).sort();
  const missingColumns = expected
    .filter((c) => liveTables.has(c.table) && !liveColumns.has(`${c.table}.${c.column}`))
    .map((c) => `${c.table}.${c.column}`)
    .sort();
  const pendingMigrations = migrations.applied === null ? null : Math.max(0, migrations.inRepo - migrations.applied);
  return { missingTables, missingColumns, pendingMigrations };
}

export const isHealthy = (d: SchemaDrift) => d.missingTables.length === 0 && d.missingColumns.length === 0 && !d.pendingMigrations;
