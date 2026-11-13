/**
 * A UUID in its canonical 8-4-4-4-12 form. Ids from a URL are checked with this
 * before they reach Postgres: `[0-9a-f-]{36}` let 36 a's through, and the uuid
 * column then threw 22P02, a 500 for what is a 404 (found by e2e, 2026-11-13).
 */
export function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
