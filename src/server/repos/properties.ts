import 'server-only';
import { eq, sql } from 'drizzle-orm';

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

export async function getProperty(id: string): Promise<Property | null> {
  const [row] = await db.select().from(properties).where(eq(properties.id, id));
  return row ?? null;
}

/** The finder's pets check: the answer read from the hotel's own listing, and the content it ranks on. */
export async function setPropertyPets(id: string, petsAllowed: boolean | null, content: Record<string, unknown>): Promise<void> {
  await db.update(properties).set({ petsAllowed, content }).where(eq(properties.id, id));
}
