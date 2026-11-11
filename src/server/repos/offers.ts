import 'server-only';
import { and, eq, gt, type SQL } from 'drizzle-orm';

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
 * Live offers quoted for exactly this audience, each with its property. A
 * member is ranked on member prices only: public offers recorded before they
 * signed in are still visible to them but are not what the finder ranks.
 */
export async function listLiveOffersForRanking(sessionId: string, stayId: string, audience: Audience, now: Date) {
  return db
    .select({ offer: offers, property: properties })
    .from(offers)
    .innerJoin(properties, eq(properties.id, offers.propertyId))
    .where(
      and(
        eq(offers.sessionId, sessionId),
        eq(offers.stayId, stayId),
        eq(offers.audience, audience),
        gt(offers.expiresAt, now),
      ),
    );
}
