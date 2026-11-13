/** Postgres unique_violation, whether the driver throws it bare or wrapped. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string; constraint_name?: string; cause?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  if (e.code === '23505') {
    const name = e.constraint ?? e.constraint_name;
    return constraint === undefined || name === undefined || name === constraint;
  }
  return e.cause !== undefined && e.cause !== err ? isUniqueViolation(e.cause, constraint) : false;
}

/** The Postgres SQLSTATE behind an error, bare or wrapped (drizzle may put it in `cause`). */
export function pgErrorCode(err: unknown, depth = 0): string | null {
  const e = err as { code?: unknown; cause?: unknown } | null;
  if (!e || typeof e !== 'object' || depth > 5) return null;
  if (typeof e.code === 'string' && /^(?=.*\d)[0-9A-Z]{5}$/.test(e.code)) return e.code;
  return e.cause !== undefined && e.cause !== err ? pgErrorCode(e.cause, depth + 1) : null;
}

/**
 * The database is behind the code: a column, table or type the query names
 * does not exist (undefined_column, undefined_table, undefined_object). In
 * production this means a migration in drizzle/ was not applied.
 */
export const SCHEMA_DRIFT_CODES = ['42703', '42P01', '42704'] as const;

export function isSchemaDrift(err: unknown): boolean {
  const code = pgErrorCode(err);
  return code !== null && (SCHEMA_DRIFT_CODES as readonly string[]).includes(code);
}

/** One log line for an unexpected error: what failed, the SQLSTATE and its message, and what to do when it is schema drift. */
export function describeFailure(err: unknown): string {
  const code = pgErrorCode(err);
  const text = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  let message = text(err);
  // A wrapped driver error: say the database's own words too.
  for (let e = (err as { cause?: unknown } | null)?.cause, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) message += ` ← ${text(e)}`;
  if (isSchemaDrift(err)) {
    return `SCHEMA DRIFT pg=${code} ${message} — the database is behind the code: apply drizzle/ migrations (npm run db:migrate); GET /hotels/api/health lists what is missing`;
  }
  return code ? `pg=${code} ${message}` : message;
}
