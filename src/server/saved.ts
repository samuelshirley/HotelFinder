import 'server-only';

import { listSaved, saveHotel } from '@/server/repos/saved';
import { audienceFor, listStays, type Owner, type SearchSession } from '@/server/repos/sessions';
import { getProperty } from '@/server/repos/properties';
import { isListed } from '@/server/repos/shortlist';

/**
 * Saved hotels (the heart): docs/saved.md. One path for the heart on a card
 * and for "save this one" in the chat.
 */

/** Who a search belongs to, which is who its saved hotels belong to. */
export function ownerOf(session: Pick<SearchSession, 'userId' | 'anonId'>): Owner {
  if (session.userId) return { userId: session.userId };
  if (session.anonId) return { anonId: session.anonId };
  throw new Error('a session with no owner'); // the schema's check makes this unreachable
}

/**
 * Save a hotel the visitor can see in this search. Only a hotel on the
 * search's list can be saved, so an id from anywhere else saves nothing.
 */
export async function saveFromSearch(session: SearchSession, propertyId: string): Promise<{ ok: true; name: string } | { ok: false; error: 'property_not_found' }> {
  // Any row this visitor may see, as the detail and rates routes ask: the top picks, "Show all", or a
  // hotel they named. Checked against the top picks alone, a heart in "Show all" saved nothing (e2e, 2026-11-13).
  const stay = (await listStays(session.id))[0];
  if (!stay || !(await isListed(session.id, stay.id, propertyId, audienceFor(session)))) return { ok: false, error: 'property_not_found' };
  const property = await getProperty(propertyId);
  if (!property) return { ok: false, error: 'property_not_found' };
  await saveHotel(ownerOf(session), { propertyId, sessionId: session.id });
  return { ok: true, name: property.name };
}

/**
 * What the saved list shows. `lastFound` is the last price found for the
 * hotel in one of this visitor's searches, with its dates and the day it was
 * fetched: labelled as that, never as a current price. No supplier id.
 */
export async function savedView(owner: Owner) {
  const rows = await listSaved(owner);
  return rows.map(({ saved, property, lastFound }) => ({
    propertyId: property.id,
    name: property.name,
    photo: property.mainPhoto,
    address: property.address,
    stars: property.stars,
    rating: property.rating,
    savedAt: saved.createdAt.toISOString(),
    /** The search it was saved from, to open again. null once that search is gone. */
    sessionId: saved.sessionId,
    lastFound: lastFound && {
      totalMinor: lastFound.totalMinor,
      currency: lastFound.currency,
      checkIn: lastFound.checkIn,
      checkOut: lastFound.checkOut,
      fetchedAt: lastFound.fetchedAt.toISOString(),
    },
  }));
}

export type SavedHotelView = Awaited<ReturnType<typeof savedView>>[number];
