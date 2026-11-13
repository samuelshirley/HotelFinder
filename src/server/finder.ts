import 'server-only';

import { AMENITIES, isMustHave, type Amenity, type MustHave } from '@/lib/amenities';
import { readChain, readPropertyType, stayFilters } from '@/lib/filters';
import { rankStay, type Candidate, type RankResult } from '@/lib/finder/rank';
import { MIN_HOTELS, planSearch } from '@/lib/finder/searchPlan';
import { FULL_LIST_KIND } from '@/lib/fullList';
import { marginFor, OFFER_TTL_MS } from '@/lib/pricing';
import { replaceFinderShortlist, type FinderEntry } from '@/server/repos/finderShortlist';
import { insertOffers, listLiveOffersForRanking } from '@/server/repos/offers';
import { upsertProperty } from '@/server/repos/properties';
import { audienceFor, getSession, getStay } from '@/server/repos/sessions';
import type { SupplierAdapter, SupplierError } from '@/server/supplier';

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
      /** Left out by a filter only because the listing does not hold that field. */
      filterUnknown: number;
      distanceFrom: RankResult['distanceFrom'];
      distanceLabel: RankResult['distanceLabel'];
      /** Radius searches only: true when the first radius held too few hotels and one wider search was made. */
      widened: boolean;
      /** True when the supplier's amenity facts could not be fetched, so must-haves were unverifiable. */
      amenityFactsMissing: boolean;
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

    const rooms = Math.max(1, stay.rooms);
    const request = {
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      occupancies: splitParty(stay.adults, stay.childrenAges, rooms),
      currency: session.currency,
      guestNationality: session.guestNationality,
      marginPct,
      maxHotels: 30,
      maxRatesPerHotel: 1,
    };
    let search = await supplier.searchAvailability({ ...request, where: plan.where });
    // Too few hotels in the first radius: one wider search, never more.
    if (plan.kind === 'radius' && search.ok && search.value.properties.length < MIN_HOTELS) {
      const wider = await supplier.searchAvailability({ ...request, where: plan.wider });
      widened = true;
      if (wider.ok && wider.value.properties.length > search.value.properties.length) search = wider;
    }
    if (!search.ok) return { kind: 'supplier_error', error: search.error };
    if (search.value.offers.length === 0) return { kind: 'no_availability' };

    const facts = await supplier.getStaticFacts(search.value.properties.map((p) => p.supplierHotelId));
    amenityFactsMissing = !facts.ok;
    const known = new Map(facts.ok ? facts.value.map((f) => [f.supplierHotelId, f]) : []);

    const propertyIds = new Map<string, string>();
    for (const p of search.value.properties) {
      const fact = known.get(p.supplierHotelId);
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
        petsAllowed: fact ? fact.amenities.includes('pets_allowed') : null,
        // `amenities` absent = unknown. An empty array = known to have none.
        // `propertyType` and `chain` absent = the listing does not say (the filters read them).
        content: fact
          ? { amenities: fact.amenities, ...(fact.propertyType ? { propertyType: fact.propertyType } : {}), ...(fact.chain ? { chain: fact.chain } : {}) }
          : {},
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
            roomName: o.rooms[0]?.name ?? null,
            boardName: o.rooms[0]?.boardName ?? null,
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

  // One candidate per hotel: its cheapest live offer.
  const cheapest = new Map<string, (typeof held)[number]>();
  for (const row of held) {
    const current = cheapest.get(row.property.id);
    if (!current || row.offer.totalMinor < current.offer.totalMinor) cheapest.set(row.property.id, row);
  }
  const candidates: Candidate[] = [...cheapest.values()].map(({ offer, property }) => ({
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
    propertyType: readPropertyType(property.content),
    chain: readChain(property.content),
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
    filters: stayFilters(stay),
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
      // Every other hotel that fits, in the same order, for "Show all N hotels"
      // (lib/fullList.ts). Eligible only: no constraint missed, no member price
      // for an anonymous visitor. There are near-misses only when fewer than
      // five fit, so the two never share a rank.
      result.ordered.slice(result.shortlist.length).map((row): FinderEntry => ({
        propertyId: row.candidate.propertyId,
        offerId: row.candidate.offerId,
        rank: row.rank,
        reason: { kind: FULL_LIST_KIND, distance_km: row.km, per_night_minor: row.perNightMinor },
      })),
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
    filterUnknown: result.filterUnknown,
    distanceFrom: result.distanceFrom,
    distanceLabel: result.distanceLabel,
    widened,
    amenityFactsMissing,
  };
}

function readAmenities(content: Record<string, unknown> | null): Amenity[] | null {
  const raw = content?.amenities;
  if (!Array.isArray(raw)) return null;
  return raw.filter((a): a is Amenity => (AMENITIES as readonly string[]).includes(a as string));
}

/**
 * Spread a party over rooms: adults as evenly as possible, children with the
 * first rooms. Every room gets at least one adult.
 */
export function splitParty(adults: number, childrenAges: number[], rooms: number) {
  const n = Math.max(1, Math.min(rooms, adults));
  const out = Array.from({ length: n }, () => ({ adults: 0, childrenAges: [] as number[] }));
  for (let i = 0; i < adults; i++) out[i % n].adults += 1;
  childrenAges.forEach((age, i) => out[i % n].childrenAges.push(age));
  return out;
}
