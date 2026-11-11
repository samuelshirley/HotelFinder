import 'server-only';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { appMeta } from '@/server/db/schema';

export async function getMeta(key: string): Promise<string | null> {
  const [row] = await db.select().from(appMeta).where(eq(appMeta.key, key));
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db
    .insert(appMeta)
    .values({ key, value })
    .onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt: sql`now()` } });
}
