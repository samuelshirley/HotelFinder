import 'server-only';
import { sql } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { ipRequestCounters } from '@/server/db/schema';

/**
 * Count one request from `key` (an IP, optionally prefixed by a route) in the
 * current fixed window and say whether it is within `max`. One atomic upsert,
 * so concurrent requests cannot both read a stale count.
 */
export async function countRequest(key: string, now: Date, windowMs: number, max: number): Promise<{ allowed: boolean; count: number }> {
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await db
    .insert(ipRequestCounters)
    .values({ ip: key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [ipRequestCounters.ip, ipRequestCounters.windowStart],
      set: { count: sql`${ipRequestCounters.count} + 1` },
    })
    .returning({ count: ipRequestCounters.count });
  return { allowed: row.count <= max, count: row.count };
}
