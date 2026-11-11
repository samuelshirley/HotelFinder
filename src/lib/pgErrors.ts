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
