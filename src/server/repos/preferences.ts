import 'server-only';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { userPreferences } from '@/server/db/schema';

export type UserPreferences = typeof userPreferences.$inferSelect;
export type ConfirmedPreferences = Pick<
  typeof userPreferences.$inferInsert,
  'priority' | 'adults' | 'childrenAges' | 'mustHaves' | 'guestNationality'
>;

export async function getPreferences(userId: string): Promise<UserPreferences | null> {
  const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  return row ?? null;
}

/**
 * Store what the user just confirmed. Call this only on an explicit yes:
 * nothing inferred from a search is ever written here.
 */
export async function confirmPreferences(
  userId: string,
  values: ConfirmedPreferences,
  now: Date,
): Promise<UserPreferences> {
  const [row] = await db
    .insert(userPreferences)
    .values({ ...values, userId, confirmedAt: now })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { ...values, confirmedAt: now, updatedAt: sql`now()` },
    })
    .returning();
  return row;
}
