import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { shortlistEntries } from '@/server/db/schema';

export type FinderEntry = {
  propertyId: string;
  /** null only for a near-miss whose price is member-only (schema check `shortlist_finder_rows_sourced`). */
  offerId: string | null;
  rank: number;
  reason: { kind: string } & Record<string, unknown>;
};

/**
 * FINDER ONLY. The single way a `finder` shortlist row comes to exist. Nothing
 * but the stay finder may import this file (guard test, once the finder
 * exists); the agent's path is `addUserNamedProperty` in shortlist.ts.
 *
 * Replaces the stay's finder rows in one transaction. User-named rows stay.
 */
export async function replaceFinderShortlist(
  sessionId: string,
  stayId: string,
  entries: FinderEntry[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(shortlistEntries)
      .where(
        and(
          eq(shortlistEntries.sessionId, sessionId),
          eq(shortlistEntries.stayId, stayId),
          eq(shortlistEntries.source, 'finder'),
        ),
      );
    if (entries.length === 0) return;
    await tx.insert(shortlistEntries).values(entries.map((e) => ({ ...e, sessionId, stayId, source: 'finder' as const })));
  });
}
