import 'server-only';

import type { Locale } from '@/lib/i18n/locale';
import { nearLabel } from '@/lib/replies';
import { listMessages } from '@/server/repos/chat';
import { audienceFor, listStays, type SearchSession } from '@/server/repos/sessions';
import { listShortlist } from '@/server/repos/shortlist';

/**
 * Everything the client renders for one session, built from the database.
 * Prices, fees and cancellation terms come from offer rows and nowhere else.
 * Supplier ids and internal trace data are not included.
 */
export async function buildSessionView(session: SearchSession, locale: Locale = 'en') {
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
    /** What is known before there is a stay: the place picked and the party and priorities read from the first message. */
    pending: stay
      ? null
      : {
          destination: session.draft.destination?.label ?? null,
          guests: session.draft.scanned?.guests ?? null,
          pets: session.draft.scanned?.mustHaves?.includes('pets_allowed') ?? false,
          priorities: session.priorities ?? session.draft.scanned?.priorities ?? null,
          nearLabel: session.draft.destination
            ? nearLabel({ destinationText: session.draft.destination.label, destKind: session.draft.destination.point?.kind ?? 'area', near: null }, locale)
            : 'the centre',
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
      nearLabel: nearLabel({ destinationText: stay.destinationText, destKind: stay.destKind, near: stay.nearLabel ? { label: stay.nearLabel } : null }, locale),
      nearIsNamed: stay.nearLabel !== null,
      /**
       * The point distances are measured from, for the map: the place the user
       * named, else a point destination. null for an area with nothing named:
       * the finder then measures from the middle of the results, which is no place.
       */
      anchor:
        stay.nearLabel !== null && stay.latitude !== null && stay.longitude !== null
          ? { latitude: stay.latitude, longitude: stay.longitude, label: stay.nearLabel }
          : stay.destKind === 'point' && stay.destLatitude !== null && stay.destLongitude !== null
            ? { latitude: stay.destLatitude, longitude: stay.destLongitude, label: nearLabel({ destinationText: stay.destinationText, destKind: stay.destKind, near: null }, locale) }
            : null,
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
        penalties: offerPenalties(offer.cancellation),
        fees: offerFees(offer.taxesAndFees),
        fetchedAt: offer.fetchedAt.toISOString(),
        expiresAt: offer.expiresAt.toISOString(),
      },
    })),
  };
}

export type SessionView = Awaited<ReturnType<typeof buildSessionView>>;

/** Cancellation charges after the free period, as the supplier lists them. */
export function offerPenalties(cancellation: unknown): Array<{ from: string | null; amountMinor: number; currency: string }> {
  const list = (cancellation as { penalties?: Array<{ from?: string | null; amount?: { amountMinor?: number; currency?: string } }> } | null)?.penalties ?? [];
  return list.flatMap((p) =>
    typeof p.amount?.amountMinor === 'number' && p.amount.currency ? [{ from: p.from ?? null, amountMinor: p.amount.amountMinor, currency: p.amount.currency }] : [],
  );
}

/** Taxes and fees, included in the total or paid at the hotel, as the supplier names them. */
export function offerFees(fees: unknown): Array<{ description: string; amountMinor: number; currency: string; included: boolean }> {
  const list = (fees as Array<{ description?: string; amount?: { amountMinor?: number; currency?: string }; included?: boolean }> | null) ?? [];
  return list.flatMap((f) =>
    typeof f.amount?.amountMinor === 'number' && f.amount.currency
      ? [{ description: f.description || (f.included ? 'Taxes and fees' : 'Paid at the hotel'), amountMinor: f.amount.amountMinor, currency: f.amount.currency, included: Boolean(f.included) }]
      : [],
  );
}
