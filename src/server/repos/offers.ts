import 'server-only';
import { and, eq, gt, max, type SQL } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { offers, properties, type Audience } from '@/server/db/schema';

export type Offer = typeof offers.$inferSelect;
export type OfferInput = Omit<typeof offers.$inferInsert, 'id'>;

/**
 * The one visibility rule: an anonymous (`public`) session sees public offers
 * only. Every read in this file goes through it, so a member-priced offer
 * cannot be serialised to an anonymous session by forgetting a filter.
 */
function visibleTo(audience: Audience): SQL | undefined {
  return audience === 'member' ? undefined : eq(offers.audience, 'public');
}

export async function insertOffers(rows: OfferInput[]): Promise<Offer[]> {
  if (rows.length === 0) return [];
  return db.insert(offers).values(rows).returning();
}

/** One offer, only if this audience may see it. Expired offers are still returned: the caller re-checks the rate. */
export async function getOffer(id: string, sessionId: string, audience: Audience): Promise<Offer | null> {
  const [row] = await db
    .select()
    .from(offers)
    .where(and(eq(offers.id, id), eq(offers.sessionId, sessionId), visibleTo(audience)));
  return row ?? null;
}

/** Offers for a stay that have not expired at `now` and that this audience may see. */
export async function listLiveOffers(
  sessionId: string,
  stayId: string,
  audience: Audience,
  now: Date,
): Promise<Offer[]> {
  return db
    .select()
    .from(offers)
    .where(
      and(eq(offers.sessionId, sessionId), eq(offers.stayId, stayId), gt(offers.expiresAt, now), visibleTo(audience)),
    );
}

/**
 * Live offers quoted for exactly this audience, each with its property, from
 * the LATEST search only. A member is ranked on member prices only: public
 * offers recorded before they signed in are still visible to them but are
 * not what the finder ranks.
 *
 * Latest search only: every change of where, when, who or nationality is a
 * new search, and the previous search's offers stay live until they expire.
 * Ranking them too put the old dates' prices on the new search's shortlist
 * (reproduced in finder.test.ts, "a new search replaces the old one").
 */
export async function listLiveOffersForRanking(sessionId: string, stayId: string, audience: Audience, now: Date) {
  // A hotel's detail rates are never ranked: opening a hotel must not change the shortlist.
  const mine = and(eq(offers.sessionId, sessionId), eq(offers.stayId, stayId), eq(offers.audience, audience), eq(offers.detailOnly, false));
  // Two plain queries, not a subquery inside sql``: that form overflowed the
  // stack under Next's bundler (reproduced in the e2e run, 2026-11-11) though
  // it passed under vitest.
  const [{ at }] = await db.select({ at: max(offers.fetchedAt) }).from(offers).where(mine);
  if (!at) return [];
  return db
    .select({ offer: offers, property: properties })
    .from(offers)
    .innerJoin(properties, eq(properties.id, offers.propertyId))
    .where(and(mine, gt(offers.expiresAt, now), eq(offers.fetchedAt, at)));
}

/** A hotel's detail rates for this stay that are still live. */
export async function listDetailOffers(sessionId: string, stayId: string, propertyId: string, audience: Audience, now: Date): Promise<Offer[]> {
  return db
    .select()
    .from(offers)
    .where(
      and(
        eq(offers.sessionId, sessionId),
        eq(offers.stayId, stayId),
        eq(offers.propertyId, propertyId),
        eq(offers.detailOnly, true),
        eq(offers.audience, audience),
        gt(offers.expiresAt, now),
      ),
    );
}
