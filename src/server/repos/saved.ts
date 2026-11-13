import 'server-only';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { offers, properties, savedHotels, searchSessions, stays } from '@/server/db/schema';
import type { Owner } from '@/server/repos/sessions';

export type SavedHotel = typeof savedHotels.$inferSelect;

/** At most this many saved hotels are listed. */
export const SAVED_LIMIT = 50;

/**
 * The owner's rows, the same rule a search's ownership follows: an account
 * sees its own; an anonymous cookie sees only what was saved under it and not
 * yet handed to an account.
 */
const ownedBy = (owner: Owner) =>
  'userId' in owner ? eq(savedHotels.userId, owner.userId) : and(eq(savedHotels.anonId, owner.anonId), isNull(savedHotels.userId));

/** The searches whose offers this owner has seen. */
const sessionsOf = (owner: Owner) =>
  'userId' in owner ? eq(searchSessions.userId, owner.userId) : and(eq(searchSessions.anonId, owner.anonId), isNull(searchSessions.userId));

/** Save once; saving again keeps the first row. */
export async function saveHotel(owner: Owner, input: { propertyId: string; sessionId: string | null }): Promise<void> {
  const values = 'userId' in owner ? { userId: owner.userId } : { anonId: owner.anonId };
  await db
    .insert(savedHotels)
    .values({ ...values, propertyId: input.propertyId, sessionId: input.sessionId })
    .onConflictDoNothing();
}

export async function unsaveHotel(owner: Owner, propertyId: string): Promise<boolean> {
  const rows = await db
    .delete(savedHotels)
    .where(and(ownedBy(owner), eq(savedHotels.propertyId, propertyId)))
    .returning({ id: savedHotels.id });
  return rows.length > 0;
}

/**
 * The owner's saved hotels, newest first, each with the LAST PRICE FOUND for
 * it: the most recent search offer for that hotel in a search this owner
 * owns, with the date it was fetched and the nights it was for. Read from the
 * offer rows, never stored here, and never a current price.
 *
 * Audience: an anonymous owner is shown public offers only, so a member price
 * never reaches a visitor who is not signed in, whatever the rows hold.
 */
export async function listSaved(owner: Owner, limit = SAVED_LIMIT) {
  const saved = await db
    .select({ saved: savedHotels, property: properties })
    .from(savedHotels)
    .innerJoin(properties, eq(properties.id, savedHotels.propertyId))
    .where(ownedBy(owner))
    .orderBy(desc(savedHotels.createdAt), desc(savedHotels.id))
    .limit(limit);
  if (saved.length === 0) return [];

  const found = await db
    .select({
      propertyId: offers.propertyId,
      currency: offers.currency,
      totalMinor: offers.totalMinor,
      fetchedAt: offers.fetchedAt,
      checkIn: stays.checkIn,
      checkOut: stays.checkOut,
    })
    .from(offers)
    .innerJoin(searchSessions, eq(searchSessions.id, offers.sessionId))
    .innerJoin(stays, eq(stays.id, offers.stayId))
    .where(
      and(
        inArray(
          offers.propertyId,
          saved.map((s) => s.property.id),
        ),
        sessionsOf(owner),
        // The price on a card, not one of a hotel's other rooms.
        eq(offers.detailOnly, false),
        'userId' in owner ? undefined : eq(offers.audience, 'public'),
      ),
    )
    .orderBy(desc(offers.fetchedAt), sql`${offers.totalMinor} asc`);
  const latest = new Map<string, (typeof found)[number]>();
  for (const row of found) if (!latest.has(row.propertyId)) latest.set(row.propertyId, row);

  return saved.map(({ saved, property }) => ({ saved, property, lastFound: latest.get(property.id) ?? null }));
}

export async function listSavedPropertyIds(owner: Owner): Promise<string[]> {
  const rows = await db.select({ propertyId: savedHotels.propertyId }).from(savedHotels).where(ownedBy(owner));
  return rows.map((r) => r.propertyId);
}

/**
 * At sign-in: the anonymous cookie's saved hotels become the account's. A
 * hotel the account had already saved keeps the account's row; the cookie's
 * copy is dropped rather than doubled.
 */
export async function adoptAnonymousSaved(anonId: string, userId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const already = tx.select({ propertyId: savedHotels.propertyId }).from(savedHotels).where(eq(savedHotels.userId, userId));
    await tx
      .delete(savedHotels)
      .where(and(eq(savedHotels.anonId, anonId), isNull(savedHotels.userId), inArray(savedHotels.propertyId, already)));
    const moved = await tx
      .update(savedHotels)
      .set({ userId })
      .where(and(eq(savedHotels.anonId, anonId), isNull(savedHotels.userId)))
      .returning({ id: savedHotels.id });
    return moved.length;
  });
}
