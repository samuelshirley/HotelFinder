import { describe, expect, it } from 'vitest';
import { diffSchema, isHealthy } from './schemaDrift';

const expected = [
  { table: 'usage_events', column: 'id' },
  { table: 'usage_events', column: 'anon_id' },
  { table: 'ideas', column: 'id' },
];

describe('diffSchema', () => {
  it('the 2026-11-13 outage: a column the code writes is not in the database', () => {
    const d = diffSchema(expected, [{ table: 'usage_events', column: 'id' }, { table: 'ideas', column: 'id' }], { inRepo: 6, applied: 5 });
    expect(d).toEqual({ missingTables: [], missingColumns: ['usage_events.anon_id'], pendingMigrations: 1 });
    expect(isHealthy(d)).toBe(false);
  });

  it('a missing table is named once, not once per column', () => {
    const d = diffSchema(expected, [{ table: 'ideas', column: 'id' }], { inRepo: 6, applied: 6 });
    expect(d).toEqual({ missingTables: ['usage_events'], missingColumns: [], pendingMigrations: 0 });
    expect(isHealthy(d)).toBe(false);
  });

  it('extra live tables and columns are fine; a database ahead of the repo is not "pending"', () => {
    const live = [...expected, { table: 'usage_events', column: 'legacy' }, { table: 'other_app', column: 'id' }];
    const d = diffSchema(expected, live, { inRepo: 6, applied: 7 });
    expect(d).toEqual({ missingTables: [], missingColumns: [], pendingMigrations: 0 });
    expect(isHealthy(d)).toBe(true);
  });

  it('a database with no migration record is judged by its columns alone', () => {
    const d = diffSchema(expected, expected, { inRepo: 6, applied: null });
    expect(d.pendingMigrations).toBeNull();
    expect(isHealthy(d)).toBe(true);
    expect(isHealthy({ ...d, pendingMigrations: 2 })).toBe(false);
  });
});
