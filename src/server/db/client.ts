import 'server-only';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

/**
 * The one database client. Lazy, so importing a repo never needs
 * DATABASE_URL; the first query does.
 */
let instance: PostgresJsDatabase<typeof schema> | null = null;

function connect(): PostgresJsDatabase<typeof schema> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return drizzle(postgres(url, { prepare: false }), { schema });
}

export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    instance ??= connect();
    return Reflect.get(instance, prop, receiver);
  },
});

export { schema };
