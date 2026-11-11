import 'server-only';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { offers, properties, shortlistEntries, type Audience } from '@/server/db/schema';

export type ShortlistEntry = typeof shortlistEntries.$inferSelect;

/**
 * The agent's only way to put a property on the shortlist. The source is not
 * a parameter: it is always `user_named`, with no offer and no reason. Priced,
 * ranked rows come only from the finder (finderShortlist.ts). Rank counts
 * within the user-named rows only.
 */
export async function addUserNamedProperty(input: {
  sessionId: string;
  stayId: string;
  propertyId: string;
}): Promise<ShortlistEntry> {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${shortlistEntries.rank}), 0) + 1` })
    .from(shortlistEntries)
    .where(
      and(
        eq(shortlistEntries.sessionId, input.sessionId),
        eq(shortlistEntries.stayId, input.stayId),
        eq(shortlistEntries.source, 'user_named'),
      ),
    );
  const [row] = await db
    .insert(shortlistEntries)
    .values({ ...input, rank: Number(next), source: 'user_named' })
    .returning();
  return row;
}

export async function setExcluded(entryId: string, sessionId: string, excluded: boolean): Promise<boolean> {
  const rows = await db
    .update(shortlistEntries)
    .set({ excluded })
    .where(and(eq(shortlistEntries.id, entryId), eq(shortlistEntries.sessionId, sessionId)))
    .returning({ id: shortlistEntries.id });
  return rows.length === 1;
}

/**
 * What the results panel shows: the finder's ranked rows first, then the
 * properties the user asked about by name, in the order they asked. The two
 * groups keep separate rank sequences, so the order never depends on a tie.
 * Each row carries its property and, where it has one, its offer. An entry whose offer this
 * audience may not see is left out entirely, not shown without a price.
 */
export async function listShortlist(sessionId: string, stayId: string, audience: Audience) {
  const offerVisible =
    audience === 'member' ? undefined : or(isNull(shortlistEntries.offerId), eq(offers.audience, 'public'));
  return db
    .select({ entry: shortlistEntries, property: properties, offer: offers })
    .from(shortlistEntries)
    .innerJoin(properties, eq(properties.id, shortlistEntries.propertyId))
    .leftJoin(offers, eq(offers.id, shortlistEntries.offerId))
    .where(
      and(
        eq(shortlistEntries.sessionId, sessionId),
        eq(shortlistEntries.stayId, stayId),
        eq(shortlistEntries.excluded, false),
        offerVisible,
      ),
    )
    .orderBy(asc(shortlistEntries.source), asc(shortlistEntries.rank), asc(shortlistEntries.id));
}
