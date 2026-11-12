import 'server-only';
import { and, asc, eq, isNull, sql, desc } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { searchSessions, stays, type Audience, PRIORITIES } from '@/server/db/schema';

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

export async function createSession(owner: Owner): Promise<SearchSession> {
  const values = 'userId' in owner ? { userId: owner.userId } : { anonId: owner.anonId };
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
      | 'adults'
      | 'childrenAges'
      | 'rooms'
      | 'priceCapMinor'
      | 'mustHaves'
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
