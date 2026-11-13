import 'server-only';
import { and, asc, count, eq, isNull, ne, or, sql } from 'drizzle-orm';

import { FULL_LIST_KIND, FULL_LIST_PAGE_SIZE } from '@/lib/fullList';
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
  return db
    .select({ entry: shortlistEntries, property: properties, offer: offers })
    .from(shortlistEntries)
    .innerJoin(properties, eq(properties.id, shortlistEntries.propertyId))
    .leftJoin(offers, eq(offers.id, shortlistEntries.offerId))
    // The full list's rows are not on the shortlist: the chat, the answers and
    // the agent see only what is shown without asking (lib/fullList.ts).
    .where(and(visibleRows(sessionId, stayId, audience), or(isNull(shortlistEntries.reason), ne(reasonKind, FULL_LIST_KIND))))
    .orderBy(asc(shortlistEntries.source), asc(shortlistEntries.rank), asc(shortlistEntries.id));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reasonKind = sql<string>`${shortlistEntries.reason}->>'kind'`;

/** This stay's rows, set-asides left out, and for an anonymous visitor no row whose offer is a member offer. */
function visibleRows(sessionId: string, stayId: string, audience: Audience) {
  return and(
    eq(shortlistEntries.sessionId, sessionId),
    eq(shortlistEntries.stayId, stayId),
    eq(shortlistEntries.excluded, false),
    audience === 'member' ? undefined : or(isNull(shortlistEntries.offerId), eq(offers.audience, 'public')),
  );
}

const fullListRows = (sessionId: string, stayId: string, audience: Audience) =>
  and(visibleRows(sessionId, stayId, audience), eq(shortlistEntries.source, 'finder'), eq(reasonKind, FULL_LIST_KIND));

/**
 * One page of "Show all N hotels": the finder's ranked order after the top
 * picks, in rank order, with the same visibility rules as the shortlist. The
 * rows are the finder's; nothing here ranks or prices anything.
 */
export async function listFullList(sessionId: string, stayId: string, audience: Audience, page: number, size = FULL_LIST_PAGE_SIZE) {
  return db
    .select({ entry: shortlistEntries, property: properties, offer: offers })
    .from(shortlistEntries)
    .innerJoin(properties, eq(properties.id, shortlistEntries.propertyId))
    .leftJoin(offers, eq(offers.id, shortlistEntries.offerId))
    .where(fullListRows(sessionId, stayId, audience))
    .orderBy(asc(shortlistEntries.rank), asc(shortlistEntries.id))
    .limit(size)
    .offset((Math.max(1, page) - 1) * size);
}

/** One row this session lists for the hotel (a top pick or a full-list row), or null: what the detail and rates routes open. */
export async function listedRow(sessionId: string, stayId: string, propertyId: string, audience: Audience) {
  if (!UUID.test(propertyId)) return null;
  const rows = await db
    .select({ entry: shortlistEntries, property: properties, offer: offers })
    .from(shortlistEntries)
    .innerJoin(properties, eq(properties.id, shortlistEntries.propertyId))
    .leftJoin(offers, eq(offers.id, shortlistEntries.offerId))
    .where(and(visibleRows(sessionId, stayId, audience), eq(shortlistEntries.propertyId, propertyId)))
    .orderBy(asc(shortlistEntries.source), asc(shortlistEntries.rank))
    .limit(1);
  return rows[0] ?? null;
}

/** How many rows the full list holds after the top picks. */
export async function countFullList(sessionId: string, stayId: string, audience: Audience): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(shortlistEntries)
    .leftJoin(offers, eq(offers.id, shortlistEntries.offerId))
    .where(fullListRows(sessionId, stayId, audience));
  return Number(row?.n ?? 0);
}

/**
 * May this hotel be opened (details, rooms and rates)? Any row this audience
 * may see: the shortlist, the full list, or a hotel the user named.
 */
export async function isListed(sessionId: string, stayId: string, propertyId: string, audience: Audience): Promise<boolean> {
  // The id comes from a URL: anything that is not a uuid is simply not listed (and never reaches the query).
  if (!UUID.test(propertyId)) return false;
  const rows = await db
    .select({ id: shortlistEntries.id })
    .from(shortlistEntries)
    .leftJoin(offers, eq(offers.id, shortlistEntries.offerId))
    .where(and(visibleRows(sessionId, stayId, audience), eq(shortlistEntries.propertyId, propertyId)))
    .limit(1);
  return rows.length === 1;
}
