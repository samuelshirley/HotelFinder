import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@/server/db/schema';

/**
 * The DDL for the schema, produced by drizzle-kit's own `pushSchema` against
 * an empty PGlite. `require`, not `import`: `drizzle-kit/api.mjs` calls
 * `require('fs')` and dies under Vite's ESM loader; the CJS build does not.
 */
export async function schemaDdl(): Promise<string[]> {
  const { pushSchema } = createRequire(import.meta.url)('drizzle-kit/api') as typeof import('drizzle-kit/api');
  const client = new PGlite();
  try {
    const db = drizzle(client, { schema });
    const result = await pushSchema(schema as Record<string, unknown>, db as never);
    return result.statementsToExecute;
  } finally {
    await client.close();
  }
}
