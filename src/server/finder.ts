import 'server-only';

import { AMENITIES, isMustHave, type Amenity, type MustHave } from '@/lib/amenities';
import { rankStay, type Candidate, type RankResult } from '@/lib/finder/rank';
import { cheapestPerHotel, occupanciesFor, roomsLabel, roomsOf } from '@/lib/finder/rooms';
import { MIN_HOTELS, planSearch, type SearchWhere } from '@/lib/finder/searchPlan';
import { marginFor, OFFER_TTL_MS } from '@/lib/pricing';
import { replaceFinderShortlist, type FinderEntry } from '@/server/repos/finderShortlist';
import { insertOffers, listLiveOffersForRanking } from '@/server/repos/offers';
import { upsertProperty } from '@/server/repos/properties';
import { audienceFor, getSession, getStay } from '@/server/repos/sessions';
import type { SearchResult, SupplierAdapter, SupplierError, SupplierResult } from '@/server/supplier';

export { splitParty } from '@/lib/finder/rooms';

/**
 * The stay finder: fetch (only when needed) → hard constraints → rank →
 * shortlist with a reason per row. Deterministic. The agent and the router
 * call this; neither ever finds a hotel from its own knowledge, and this file
 * is the only caller of `replaceFinderShortlist`.
 *
 * Fetch and rank are separate on purpose. A refinement that does not change
 * where, when or who (cheaper, needs parking, not that one) re-ranks the
 * offers already held and makes no supplier call.
 */

export type FinderOutcome =
  | {
      kind: 'ok';
      fetched: boolean;
      shortlisted: number;
      /** Hotels shown under the shortlist that miss a constraint (rank.ts MIN_SHOWN). */
      nearMisses: number;
      eligible: number;
      rejected: RankResult['rejected'];
      uncheckable: number;
      distanceFrom: RankResult['distanceFrom'];
      distanceLabel: RankResult['distanceLabel'];
      /** Radius searches only: true when the first radius held too few hotels and one wider search was made. */
      widened: boolean;
      /** True when the supplier's amenity facts could not be fetched, so must-haves were unverifiable. */
      amenityFactsMissing: boolean;
      /** Room splits priced for this fetch (1 when the user fixed the rooms); 0 when nothing was fetched. */
      splits: number;
    }
  | { kind: 'needs_place' | 'needs_nationality' | 'not_found' }
  /** The supplier had nothing for these dates. Retryable; nothing is stored. */
  | { kind: 'no_availability' }
  | { kind: 'supplier_error'; error: SupplierError };

export async function runFinder(args: {
  sessionId: string;
  stayId: string;
  supplier: SupplierAdapter;
  now: Date;
  /** Fetch even if live offers are held (the user changed dates, guests or place). */
  refresh?: boolean;
  env?: Record<string, string | undefined>;
}): Promise<FinderOutcome> {
  const { sessionId, stayId, supplier, now } = args;
  const session = await getSession(sessionId);
  const stay = session ? await getStay(stayId, sessionId) : null;
  if (!session || !stay) return { kind: 'not_found' };

  const audience = audienceFor(session);
  let held = args.refresh ? [] : await listLiveOffersForRanking(sessionId, stayId, audience, now);
  let fetched = false;
  let widened = false;
  let amenityFactsMissing = false;
  let splits = 0;
  const plan = planSearch({
    destinationText: stay.destinationText,
    placeId: stay.placeId,
    destPoint: stay.destLatitude !== null && stay.destLongitude !== null ? { latitude: stay.destLatitude, longitude: stay.destLongitude } : null,
    destKind: stay.destKind,
    near:
      stay.latitude !== null && stay.longitude !== null && stay.nearLabel !== null
        ? { label: stay.nearLabel, latitude: stay.latitude, longitude: stay.longitude }
        : null,
  });

  if (held.length === 0) {
    if (!plan) return { kind: 'needs_place' };
    if (!session.guestNationality) return { kind: 'needs_nationality' };
    const marginPct = marginFor(audience, args.env);

    const request = {
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      currency: session.currency,
      guestNationality: session.guestNationality,
      marginPct,
      maxHotels: 30,
      maxRatesPerHotel: 1,
    };
    // One search per room split: the user's rooms when they said, else each
    // sensible split of the party (lib/finder/rooms.ts), side by side.
    const parties = occupanciesFor(stay);
    splits = parties.length;
    const searchAll = async (where: SearchWhere) =>
      mergeSearches(await Promise.all(parties.map((occupancies) => supplier.searchAvailability({ ...request, occupancies, where }))));
    let search = await searchAll(plan.where);
    // Too few hotels in the first radius: one wider search per split, never more.
    if (plan.kind === 'radius' && search.ok && search.value.properties.length < MIN_HOTELS) {
      const wider = await searchAll(plan.wider);
      widened = true;
      if (wider.ok && wider.value.properties.length > search.value.properties.length) search = wider;
    }
    if (!search.ok) return { kind: 'supplier_error', error: search.error };
    if (search.value.offers.length === 0) return { kind: 'no_availability' };

    const facts = await supplier.getStaticFacts(search.value.properties.map((p) => p.supplierHotelId));
    amenityFactsMissing = !facts.ok;
    const amenities = new Map<string, Amenity[]>(facts.ok ? facts.value.map((f) => [f.supplierHotelId, f.amenities]) : []);

    const propertyIds = new Map<string, string>();
    for (const p of search.value.properties) {
      const known = amenities.get(p.supplierHotelId);
      const row = await upsertProperty({
        supplier: p.supplier,
        supplierHotelId: p.supplierHotelId,
        name: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
        stars: p.stars,
        rating: p.rating,
        reviewCount: p.reviewCount,
        mainPhoto: p.mainPhoto,
        address: p.address,
        petsAllowed: known ? known.includes('pets_allowed') : null,
        // `amenities` absent = unknown. An empty array = known to have none.
        content: known ? { amenities: known } : {},
      });
      propertyIds.set(p.supplierHotelId, row.id);
    }

    const expiresAt = new Date(now.getTime() + OFFER_TTL_MS);
    await insertOffers(
      search.value.offers.flatMap((o) => {
        const propertyId = propertyIds.get(o.supplierHotelId);
        if (!propertyId) return []; // an offer with no property cannot be shown
        return [
          {
            sessionId,
            stayId,
            propertyId,
            supplier: o.supplier,
            supplierOfferId: o.supplierOfferId,
            audience,
            marginPct: o.marginPct.toFixed(2),
            currency: o.total.currency,
            totalMinor: o.total.amountMinor,
            suggestedSellingMinor: o.suggestedSelling?.currency === o.total.currency ? o.suggestedSelling.amountMinor : null,
            payAtPropertyMinor: o.payAtProperty.amountMinor,
            taxesAndFees: o.fees,
            roomName: roomsLabel(o.rooms),
            boardName: o.rooms[0]?.boardName ?? null,
            rooms: o.rooms,
            refundableTag: o.cancellation.tag,
            cancellation: o.cancellation,
            fetchedAt: now,
            expiresAt,
          },
        ];
      }),
    );
    fetched = true;
    held = await listLiveOffersForRanking(sessionId, stayId, audience, now);
  }

  // One candidate per hotel: its cheapest live offer, across every room split priced.
  const byId = new Map(held.map((row) => [row.offer.id, row]));
  const cheapest = cheapestPerHotel(
    held.map(({ offer }) => ({
      id: offer.id,
      propertyId: offer.propertyId,
      totalMinor: offer.totalMinor,
      payAtPropertyMinor: offer.payAtPropertyMinor,
      suggestedSellingMinor: offer.suggestedSellingMinor,
      rooms: roomsOf(offer.rooms)?.length ?? 1,
    })),
    audience,
  ).map((o) => byId.get(o.id)!);
  const candidates: Candidate[] = cheapest.map(({ offer, property }) => ({
    offerId: offer.id,
    propertyId: property.id,
    name: property.name,
    totalMinor: offer.totalMinor,
    suggestedSellingMinor: offer.suggestedSellingMinor,
    location:
      property.latitude !== null && property.longitude !== null
        ? { latitude: property.latitude, longitude: property.longitude }
        : null,
    rating: property.rating,
    reviewCount: property.reviewCount,
    stars: property.stars,
    amenities: readAmenities(property.content),
    refundable: offer.refundableTag === 'RFN',
    boardName: offer.boardName,
  }));

  const result = rankStay({
    candidates,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    priorities: session.priorities ?? [],
    mustHaves: stay.mustHaves.filter(isMustHave) as MustHave[],
    priceCapMinor: stay.priceCapMinor,
    near: plan?.target ?? null,
    audience,
    excludedPropertyIds: stay.excludedPropertyIds,
  });

  await replaceFinderShortlist(
    sessionId,
    stayId,
    result.shortlist.map((row): FinderEntry => ({
      propertyId: row.candidate.propertyId,
      offerId: row.candidate.offerId,
      rank: row.rank,
      // The reason, plus the two facts every card shows.
      reason: { ...row.reason, distance_km: row.km, per_night_minor: row.perNightMinor },
    })).concat(
      result.nearMisses.map((row): FinderEntry => {
        // A member price never reaches an anonymous visitor: the row holds no
        // offer and no number derived from one (the schema allows this case only).
        const memberOnly = row.misses.some((m) => m.kind === 'member_price');
        return {
          propertyId: row.candidate.propertyId,
          offerId: memberOnly ? null : row.candidate.offerId,
          rank: row.rank,
          reason: memberOnly
            ? { kind: 'near_miss', misses: row.misses, distance_km: row.km }
            : { kind: 'near_miss', misses: row.misses, distance_km: row.km, per_night_minor: row.perNightMinor },
        };
      }),
    ),
  );

  return {
    kind: 'ok',
    fetched,
    shortlisted: result.shortlist.length,
    nearMisses: result.nearMisses.length,
    eligible: result.eligible,
    rejected: result.rejected,
    uncheckable: result.uncheckable,
    distanceFrom: result.distanceFrom,
    distanceLabel: result.distanceLabel,
    widened,
    amenityFactsMissing,
    splits,
  };
}

/**
 * The searches for each room split as one result: every hotel any split
 * found, every offer. A split that failed is left out; only when all fail is
 * it a supplier error.
 */
function mergeSearches(results: SupplierResult<SearchResult>[]): SupplierResult<SearchResult> {
  const ok = results.flatMap((r) => (r.ok ? [r.value] : []));
  if (ok.length === 0) return results[0] as SupplierResult<SearchResult>;
  const properties = new Map<string, SearchResult['properties'][number]>();
  for (const v of ok) for (const p of v.properties) if (!properties.has(p.supplierHotelId)) properties.set(p.supplierHotelId, p);
  return { ok: true, value: { properties: [...properties.values()], offers: ok.flatMap((v) => v.offers) } };
}

function readAmenities(content: Record<string, unknown> | null): Amenity[] | null {
  const raw = content?.amenities;
  if (!Array.isArray(raw)) return null;
  return raw.filter((a): a is Amenity => (AMENITIES as readonly string[]).includes(a as string));
}
