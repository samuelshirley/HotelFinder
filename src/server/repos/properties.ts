import 'server-only';
import { sql } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { properties } from '@/server/db/schema';

export type Property = typeof properties.$inferSelect;
export type PropertyInput = Omit<typeof properties.$inferInsert, 'id' | 'fetchedAt'>;

/** Insert, or refresh the static content of the same supplier hotel. */
export async function upsertProperty(input: PropertyInput): Promise<Property> {
  const [row] = await db
    .insert(properties)
    .values(input)
    .onConflictDoUpdate({
      target: [properties.supplier, properties.supplierHotelId],
      set: { ...input, fetchedAt: sql`now()` },
    })
    .returning();
  return row;
}
