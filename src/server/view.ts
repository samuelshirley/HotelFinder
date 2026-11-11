import 'server-only';

import { nearLabel } from '@/lib/replies';
import { listMessages } from '@/server/repos/chat';
import { audienceFor, listStays, type SearchSession } from '@/server/repos/sessions';
import { listShortlist } from '@/server/repos/shortlist';

/**
 * Everything the client renders for one session, built from the database.
 * Prices, fees and cancellation terms come from offer rows and nowhere else.
 * Supplier ids and internal trace data are not included.
 */
export async function buildSessionView(session: SearchSession) {
  const audience = audienceFor(session);
  const stay = (await listStays(session.id))[0] ?? null;
  const [messages, shortlist] = await Promise.all([
    listMessages(session.id),
    stay ? listShortlist(session.id, stay.id, audience) : Promise.resolve([]),
  ]);

  return {
    session: {
      id: session.id,
      status: session.status,
      priorities: session.priorities,
      guestNationality: session.guestNationality,
      nationalitySource: session.nationalitySource,
      currency: session.currency,
      signedIn: session.userId !== null,
      audience,
    },
    stay: stay && {
      id: stay.id,
      destination: stay.destinationText,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      adults: stay.adults,
      childrenAges: stay.childrenAges,
      rooms: stay.rooms,
      priceCapMinor: stay.priceCapMinor,
      mustHaves: stay.mustHaves,
      excludedCount: stay.excludedPropertyIds.length,
      /** Where "close" is measured from, in words. */
      nearLabel: nearLabel({ destinationText: stay.destinationText, destKind: stay.destKind, near: stay.nearLabel ? { label: stay.nearLabel } : null }),
      nearIsNamed: stay.nearLabel !== null,
    },
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      kind: m.kind,
      content: m.content,
      meta: m.meta ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
    shortlist: shortlist.map(({ entry, property, offer }) => ({
      entryId: entry.id,
      rank: entry.rank,
      source: entry.source,
      reason: entry.reason,
      property: {
        id: property.id,
        name: property.name,
        photo: property.mainPhoto,
        address: property.address,
        stars: property.stars,
        rating: property.rating,
        reviewCount: property.reviewCount,
        latitude: property.latitude,
        longitude: property.longitude,
      },
      offer: offer && {
        id: offer.id,
        currency: offer.currency,
        totalMinor: offer.totalMinor,
        payAtPropertyMinor: offer.payAtPropertyMinor,
        suggestedSellingMinor: offer.suggestedSellingMinor,
        audience: offer.audience,
        roomName: offer.roomName,
        boardName: offer.boardName,
        refundable: offer.refundableTag === 'RFN',
        freeCancellationUntil: (offer.cancellation as { freeCancellationUntil?: string | null } | null)?.freeCancellationUntil ?? null,
        fetchedAt: offer.fetchedAt.toISOString(),
        expiresAt: offer.expiresAt.toISOString(),
      },
    })),
  };
}

export type SessionView = Awaited<ReturnType<typeof buildSessionView>>;
