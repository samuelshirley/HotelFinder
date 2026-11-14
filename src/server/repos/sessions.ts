import 'server-only';
import { and, asc, eq, isNotNull, isNull, sql, desc } from 'drizzle-orm';

import { SIGHTS_KEEP_DAYS, type SightKind } from '@/lib/sights';
import { db } from '@/server/db/client';
import { agentTurns, chatHistory, searchSessions, stays, type Audience, PRIORITIES } from '@/server/db/schema';

export type SearchSession = typeof searchSessions.$inferSelect;
export type Stay = typeof stays.$inferSelect;
export type Priority = (typeof PRIORITIES)[number];

/** Who is asking: a signed-in user or an anonymous cookie id. Never both. */
export type Owner = { userId: string } | { anonId: string };

export class SessionNotOwnedError extends Error {
  constructor() {
    super('session not found or not owned');
    this.name = 'SessionNotOwnedError';
  }
}

/**
 * A new search starts in the currency of the owner's most recent one: a
 * visitor who switched to dollars keeps dollars (Sam, 2026-11-13). The first
 * search ever is the column's default.
 */
export async function createSession(owner: Owner): Promise<SearchSession> {
  const mine = 'userId' in owner ? eq(searchSessions.userId, owner.userId) : eq(searchSessions.anonId, owner.anonId);
  const [last] = await db.select({ currency: searchSessions.currency }).from(searchSessions).where(mine).orderBy(desc(searchSessions.createdAt)).limit(1);
  const values = {
    ...('userId' in owner ? { userId: owner.userId } : { anonId: owner.anonId }),
    ...(last ? { currency: last.currency } : {}),
  };
  const [row] = await db.insert(searchSessions).values(values).returning();
  return row;
}

export async function getSession(id: string): Promise<SearchSession | null> {
  const [row] = await db.select().from(searchSessions).where(eq(searchSessions.id, id));
  return row ?? null;
}

/**
 * The session, or a throw. An adopted session belongs to its user only: the
 * anonymous cookie that created it no longer opens it.
 */
export async function assertSessionOwned(id: string, owner: Owner): Promise<SearchSession> {
  const row = await getSession(id);
  if (!row) throw new SessionNotOwnedError();
  const owned =
    'userId' in owner ? row.userId === owner.userId : row.userId === null && row.anonId === owner.anonId;
  if (!owned) throw new SessionNotOwnedError();
  return row;
}

/** At sign-in: hand the anonymous cookie's unowned sessions to the account. */
export async function adoptAnonymousSessions(anonId: string, userId: string): Promise<number> {
  const rows = await db
    .update(searchSessions)
    .set({ userId, updatedAt: sql`now()` })
    .where(and(eq(searchSessions.anonId, anonId), isNull(searchSessions.userId)))
    .returning({ id: searchSessions.id });
  return rows.length;
}

/**
 * "Not you?": the account's search goes back to this browser's anonymous
 * cookie, so whoever signs in next adopts it with everything in it. Only
 * from the account that owns it.
 */
export async function handOverSession(sessionId: string, fromUserId: string, toAnonId: string): Promise<boolean> {
  const rows = await db
    .update(searchSessions)
    .set({ userId: null, anonId: toAnonId, updatedAt: sql`now()` })
    .where(and(eq(searchSessions.id, sessionId), eq(searchSessions.userId, fromUserId)))
    .returning({ id: searchSessions.id });
  return rows.length === 1;
}

/** Derived from sign-in state on the server. The client cannot ask for it. */
export function audienceFor(session: Pick<SearchSession, 'userId'>): Audience {
  return session.userId ? 'member' : 'public';
}

export async function updateSession(
  id: string,
  // The retired single `priority` is deliberately not patchable: nothing writes it.
  patch: Partial<Pick<SearchSession, 'status' | 'priorities' | 'currency' | 'guestNationality' | 'nationalitySource' | 'draft'>>,
): Promise<SearchSession | null> {
  const [row] = await db
    .update(searchSessions)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(searchSessions.id, id))
    .returning();
  return row ?? null;
}

export type StayInput = Pick<Stay, 'destinationText' | 'checkIn' | 'checkOut'> &
  Partial<
    Pick<
      Stay,
      | 'placeId'
      | 'destLatitude'
      | 'destLongitude'
      | 'destKind'
      | 'destCountry'
      | 'latitude'
      | 'longitude'
      | 'nearPlaceId'
      | 'nearLabel'
      | 'sights'
      | 'adults'
      | 'childrenAges'
      | 'rooms'
      | 'priceCapMinor'
      | 'mustHaves'
      | 'minStars'
      | 'minRating'
      | 'propertyTypes'
      | 'chains'
      | 'excludedPropertyIds'
    >
  >;

/** Appends a stay at the next position. */
export async function addStay(sessionId: string, input: StayInput): Promise<Stay> {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${stays.position}), -1) + 1` })
    .from(stays)
    .where(eq(stays.sessionId, sessionId));
  const [row] = await db
    .insert(stays)
    .values({ ...input, sessionId, position: Number(next) })
    .returning();
  return row;
}

export async function updateStay(
  stayId: string,
  sessionId: string,
  patch: Partial<StayInput>,
): Promise<Stay | null> {
  const [row] = await db
    .update(stays)
    .set(patch)
    .where(and(eq(stays.id, stayId), eq(stays.sessionId, sessionId)))
    .returning();
  return row ?? null;
}

export async function listStays(sessionId: string): Promise<Stay[]> {
  return db.select().from(stays).where(eq(stays.sessionId, sessionId)).orderBy(asc(stays.position));
}

export async function getStay(stayId: string, sessionId: string): Promise<Stay | null> {
  const [row] = await db
    .select()
    .from(stays)
    .where(and(eq(stays.id, stayId), eq(stays.sessionId, sessionId)));
  return row ?? null;
}

/**
 * The visitor's searches that have a place and dates, newest first: the trips
 * list. A search still on its first question is not a trip yet.
 */
export async function listTrips(owner: Owner, limit = 30) {
  const mine = 'userId' in owner ? eq(searchSessions.userId, owner.userId) : eq(searchSessions.anonId, owner.anonId);
  return db
    .select({
      id: searchSessions.id,
      status: searchSessions.status,
      createdAt: searchSessions.createdAt,
      destination: stays.destinationText,
      checkIn: stays.checkIn,
      checkOut: stays.checkOut,
    })
    .from(searchSessions)
    .innerJoin(stays, and(eq(stays.sessionId, searchSessions.id), eq(stays.position, 0)))
    .where(mine)
    .orderBy(desc(searchSessions.createdAt))
    .limit(limit);
}

/**
 * Google's terms keep a place's name, point and rating for 30 days at most
 * (docs/sights.md). Every stay whose sights are older than that loses them:
 * the places, and the "close to the museums" point that was the middle of
 * them. Each assistant line or agent reply in that search that named one of
 * them is replaced by `expiredLine`. The kind asked for is not Google's and
 * the shortlist is not touched; a new lookup happens only when the user asks
 * again. Run by GET /api/sights/purge (daily Vercel Cron) and at every new
 * search. Returns what it changed.
 */
export async function purgeExpiredSights(now: Date, expiredLine: (kind: SightKind, oldLine: string) => string): Promise<{ stays: number; lines: number }> {
  const cutoff = new Date(now.getTime() - SIGHTS_KEEP_DAYS * 86_400_000).toISOString();
  return db.transaction(async (tx) => {
    // fetchedAt is always toISOString() (UTC, same width), so text order is time order; none at all is expired.
    const expired = await tx
      .select({ id: stays.id, sessionId: stays.sessionId, sights: stays.sights, nearPlaceId: stays.nearPlaceId })
      .from(stays)
      .where(and(isNotNull(stays.sights), sql`coalesce(${stays.sights}->>'fetchedAt', '') < ${cutoff}`));
    let lines = 0;
    for (const stay of expired) {
      const nearWasSights = stay.nearPlaceId?.startsWith('sights:') ?? false;
      await tx
        .update(stays)
        .set({ sights: null, ...(nearWasSights ? { nearPlaceId: null, nearLabel: null, latitude: null, longitude: null } : {}) })
        .where(eq(stays.id, stay.id));
      const kind = stay.sights?.kind as SightKind | undefined;
      const names = (stay.sights?.places ?? []).map((p) => p.name).filter((n) => n.length > 0);
      if (!kind || names.length === 0) continue;
      const named = (text: string | null) => !!text && names.some((n) => text.includes(n));
      const said = await tx.select({ id: chatHistory.id, content: chatHistory.content }).from(chatHistory).where(and(eq(chatHistory.sessionId, stay.sessionId), eq(chatHistory.role, 'assistant')));
      for (const m of said.filter((x) => named(x.content))) {
        await tx
          .update(chatHistory)
          .set({ content: expiredLine(kind, m.content), meta: sql`coalesce(${chatHistory.meta}, '{}'::jsonb) || '{"sightsExpired": true}'::jsonb` })
          .where(eq(chatHistory.id, m.id));
        lines += 1;
      }
      const replies = await tx.select({ id: agentTurns.id, finalText: agentTurns.finalText }).from(agentTurns).where(eq(agentTurns.sessionId, stay.sessionId));
      for (const r of replies.filter((x) => named(x.finalText))) {
        await tx.update(agentTurns).set({ finalText: expiredLine(kind, r.finalText!) }).where(eq(agentTurns.id, r.id));
      }
    }
    return { stays: expired.length, lines };
  });
}
