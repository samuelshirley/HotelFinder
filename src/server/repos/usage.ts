import 'server-only';
import { and, eq, gte, like, or, sql } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { usageEvents } from '@/server/db/schema';

export type UsageEvent = typeof usageEvents.$inferSelect;
export type UsageInput = Omit<typeof usageEvents.$inferInsert, 'id' | 'createdAt'>;

export const JEV_PROVIDER = 'jev';

/** Every paid or metered external call writes one row. Never throws away a failure: log it with success=false. */
export async function logUsage(event: UsageInput): Promise<UsageEvent> {
  const [row] = await db.insert(usageEvents).values(event).returning();
  return row;
}

/**
 * AI spend since `since`, in microcents: Anthropic and Jev only. Supplier and
 * Google rows are in the ledger but gate nobody.
 */
export async function aiSpendMicrocentsSince(
  who: { userId: string } | { sessionId: string },
  since: Date,
): Promise<number> {
  const scope = 'userId' in who ? eq(usageEvents.userId, who.userId) : eq(usageEvents.sessionId, who.sessionId);
  const [{ total }] = await db
    .select({ total: sql<string>`coalesce(sum(${usageEvents.costMicrocents}), 0)` })
    .from(usageEvents)
    .where(
      and(
        scope,
        gte(usageEvents.createdAt, since),
        or(like(usageEvents.provider, 'anthropic%'), eq(usageEvents.provider, JEV_PROVIDER)),
      ),
    );
  return Number(total);
}

/** AI spend by everyone since `since`, in microcents: the global daily brake. */
export async function aiSpendMicrocentsAllSince(since: Date): Promise<number> {
  const [{ total }] = await db
    .select({ total: sql<string>`coalesce(sum(${usageEvents.costMicrocents}), 0)` })
    .from(usageEvents)
    .where(and(gte(usageEvents.createdAt, since), or(like(usageEvents.provider, 'anthropic%'), eq(usageEvents.provider, JEV_PROVIDER))));
  return Number(total);
}
