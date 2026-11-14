import 'server-only';
import { and, desc, eq, gt, type SQL } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { offers, properties, type Audience } from '@/server/db/schema';

export type Offer = typeof offers.$inferSelect;
export type OfferInput = Omit<typeof offers.$inferInsert, 'id'>;

/**
 * The one visibility rule: an anonymous (`public`) session sees public rows
 * only, which hold the hotel's public price (server/offerRows.ts). Every read
 * in this file goes through it, so a member row (after "Not you?", the last
 * account's) cannot be serialised to an anonymous session by forgetting a filter.
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
 * the stay's LATEST search only, and only when that search was made for this
 * audience. A member is ranked on member prices only: public offers recorded
 * before they signed in are not what the finder ranks; and after "Not you?"
 * a signed-out visitor is not ranked on an older public search when a newer
 * one was made for the account. Nothing returned means: fetch again.
 *
 * Latest search only: every change of where, when, who or nationality is a
 * new search, and the previous search's offers stay live until they expire.
 * Ranking them too put the old dates' prices on the new search's shortlist
 * (reproduced in finder.test.ts, "a new search replaces the old one").
 */
export async function listLiveOffersForRanking(sessionId: string, stayId: string, audience: Audience, now: Date) {
  // A hotel's detail rates are never ranked: opening a hotel must not change the shortlist.
  const searched = and(eq(offers.sessionId, sessionId), eq(offers.stayId, stayId), eq(offers.detailOnly, false));
  // Two plain queries, not a subquery inside sql``: that form overflowed the
  // stack under Next's bundler (reproduced in the e2e run, 2026-11-11) though
  // it passed under vitest.
  const latest = await latestSearch(sessionId, stayId);
  if (!latest || latest.audience !== audience) return [];
  return db
    .select({ offer: offers, property: properties })
    .from(offers)
    .innerJoin(properties, eq(properties.id, offers.propertyId))
    .where(and(searched, eq(offers.audience, audience), gt(offers.expiresAt, now), eq(offers.fetchedAt, latest.at)));
}

/** When the stay was last searched, and for whom; null before the first search. */
export async function latestSearch(sessionId: string, stayId: string): Promise<{ at: Date; audience: Audience } | null> {
  const [row] = await db
    .select({ at: offers.fetchedAt, audience: offers.audience })
    .from(offers)
    .where(and(eq(offers.sessionId, sessionId), eq(offers.stayId, stayId), eq(offers.detailOnly, false)))
    .orderBy(desc(offers.fetchedAt))
    .limit(1);
  return row ?? null;
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
