import 'server-only';
import path from 'node:path';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from './schema';

/**
 * The one database client.
 *
 * - `DATABASE_URL` set: Postgres (Neon in production).
 * - unset, outside production: an embedded Postgres (PGlite) stored in
 *   `.data/pglite`, with the migrations in `drizzle/` applied on first use, so
 *   `npm run dev` needs no database setup at all.
 * - unset in production: an error. Production never runs on a local file.
 *
 * Both drivers expose the same drizzle query API; the repos cannot tell them
 * apart. Lazy: importing a repo opens nothing.
 */
type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __hotelFinderDb?: Promise<Db> };

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const [{ drizzle }, { default: postgres }] = await Promise.all([import('drizzle-orm/postgres-js'), import('postgres')]);
    return drizzle(postgres(url, { prepare: false }), { schema });
  }
  if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is not set');

  const [{ PGlite }, { drizzle }, { migrate }, { mkdirSync }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
    import('node:fs'),
  ]);
  const dir = path.resolve(process.env.HOTEL_FINDER_DATA_DIR ?? path.join(process.cwd(), '.data'), 'pglite');
  mkdirSync(dir, { recursive: true });
  const local = drizzle(new PGlite(dir), { schema });
  await migrate(local, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });
  return local as unknown as Db;
}

function ready(): Promise<Db> {
  globalForDb.__hotelFinderDb ??= connect();
  return globalForDb.__hotelFinderDb;
}

/**
 * `db.select()…`, `db.insert()…` and friends, resolved against the connection
 * on first use. Every drizzle builder is awaited by its caller, so the proxy
 * can hand back a thenable chain that waits for the connection first.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop: string) {
    if (prop === 'transaction') {
      return async (fn: Parameters<Db['transaction']>[0]) => (await ready()).transaction(fn);
    }
    return (...args: unknown[]) => deferred((real) => (real as unknown as Record<string, (...a: unknown[]) => unknown>)[prop](...args));
  },
});

/** A builder chain recorded now and replayed on the real client once connected. */
function deferred(start: (real: Db) => unknown): unknown {
  const steps: Array<{ method: string; args: unknown[] }> = [];
  const run = async () => {
    let current = start(await ready());
    for (const step of steps) current = (current as Record<string, (...a: unknown[]) => unknown>)[step.method](...step.args);
    return current;
  };
  const chain: unknown = new Proxy(function () {}, {
    get(_t, method: string) {
      if (method === 'then') return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => run().then(resolve, reject);
      if (method === 'catch') return (reject: (e: unknown) => unknown) => run().catch(reject);
      if (method === 'finally') return (fn: () => void) => run().finally(fn);
      return (...args: unknown[]) => {
        steps.push({ method, args });
        return chain;
      };
    },
  });
  return chain;
}

export { schema };
