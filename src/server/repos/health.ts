import 'server-only';
import { is, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';

import { pgErrorCode } from '@/lib/pgErrors';
import { diffSchema, type Column, type SchemaDrift } from '@/lib/schemaDrift';
import { db } from '@/server/db/client';
import * as schema from '@/server/db/schema';
import journal from '../../../drizzle/meta/_journal.json';

/** Every table and column schema.ts declares: what the code will name in a query. */
export function expectedColumns(): Column[] {
  return (Object.values(schema) as unknown[])
    .filter((v): v is PgTable => is(v, PgTable))
    .flatMap((t) => {
      const { name, columns } = getTableConfig(t);
      return columns.map((c) => ({ table: name, column: c.name }));
    });
}

/** postgres-js hands back the rows; PGlite hands back `{ rows }`. */
const rowsOf = <T>(result: unknown): T[] => (Array.isArray(result) ? result : ((result as { rows: T[] }).rows ?? [])) as T[];

/** The live database against schema.ts and drizzle/. Read-only. */
export async function schemaDrift(): Promise<SchemaDrift> {
  const live = rowsOf<{ table: string; column: string }>(
    await db.execute(sql`select table_name as "table", column_name as "column" from information_schema.columns where table_schema = current_schema()`),
  );
  let applied: number | null;
  try {
    applied = Number(rowsOf<{ n: string | number }>(await db.execute(sql`select count(*) as n from drizzle.__drizzle_migrations`))[0]?.n ?? 0);
  } catch (err) {
    // No record kept (a database built from DDL, as in the pg tests): judge by columns alone.
    if (pgErrorCode(err) !== '42P01' && pgErrorCode(err) !== '3F000') throw err;
    applied = null;
  }
  return diffSchema(expectedColumns(), live, { inRepo: journal.entries.length, applied });
}
