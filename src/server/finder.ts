import 'server-only';

import { AMENITIES, isMustHave, type Amenity, type MustHave } from '@/lib/amenities';
import { readChain, readPropertyType, stayFilters } from '@/lib/filters';
import { rankStay, type Candidate, type RankResult } from '@/lib/finder/rank';
import { cheapestPerHotel, occupanciesFor, roomsLabel, roomsOf } from '@/lib/finder/rooms';
import { MIN_HOTELS, planSearch, type SearchWhere } from '@/lib/finder/searchPlan';
import { FULL_LIST_KIND } from '@/lib/fullList';
import { marginFor, OFFER_TTL_MS } from '@/lib/pricing';
import { replaceFinderShortlist, type FinderEntry } from '@/server/repos/finderShortlist';
import { insertOffers, listLiveOffersForRanking } from '@/server/repos/offers';
import { setPropertyPets, upsertProperty, type Property } from '@/server/repos/properties';
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
      /** Left out by a filter only because the listing does not hold that field. */
      filterUnknown: number;
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

/**
 * How many hotels one search asks the supplier for. Measured on the sandbox
 * 2026-11-13 (Porto, 2 adults): 30 → 29 hotels in 3.5 s (97 KB); 200 → 166 in
 * 4.6 s (546 KB); 500 → 326 in 4.4 s. Raising it to 200 left a signed-out
 * search with 3 of 170 hotels fitting (11 of 29 at 30): most of the extra
 * hotels only have rates under the hotel's public price, which an anonymous
 * session never sees (docs/architecture.md decision 6). It stays at 30 until
 * that is settled.
 */
export const MAX_HOTELS = 30;

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
      maxHotels: MAX_HOTELS,
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
        // The facility list can say yes; its silence is not a no (docs/supplier.md, "Pets").
        petsAllowed: fact?.amenities.includes('pets_allowed') ? true : null,
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
  const mustHaves = stay.mustHaves.filter(isMustHave) as MustHave[];
  // Pets are the one must-have the bulk facility list gets wrong both ways:
  // confirm them from each hotel's own listing before ranking on them.
  const petsChecked = mustHaves.includes('pets_allowed')
    ? await confirmPets(supplier, cheapest.map((r) => r.property))
    : new Map<string, Amenity[] | null>();
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
    amenities: petsChecked.has(property.id) ? petsChecked.get(property.id)! : readAmenities(property.content),
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
    mustHaves,
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
    splits,
  };
}

const PET_CHECK_CONCURRENCY = 6;

/**
 * For each hotel whose pets answer has not yet come from its own listing,
 * read the listing (free: src/lib/supplierPrices.ts) and store the answer.
 * Returns the amenities to rank on, by property id. A hotel whose listing
 * could not be read keeps what the facility list said.
 */
async function confirmPets(supplier: SupplierAdapter, props: Property[]): Promise<Map<string, Amenity[] | null>> {
  const out = new Map<string, Amenity[] | null>();
  const todo = props.filter((p) => p.content?.petsSource !== 'details');
  for (const p of props) if (p.content?.petsSource === 'details') out.set(p.id, readAmenities(p.content));
  for (let i = 0; i < todo.length; i += PET_CHECK_CONCURRENCY) {
    await Promise.all(
      todo.slice(i, i + PET_CHECK_CONCURRENCY).map(async (p) => {
        const details = await supplier.getStaticContent(p.supplierHotelId);
        if (!details.ok) return;
        const pets = details.value.petsAllowed;
        const known = readAmenities(p.content);
        // Unknown amenities stay unknown: one confirmed fact does not make the rest known.
        const amenities = known === null ? null : [...known.filter((a) => a !== 'pets_allowed'), ...(pets === true ? (['pets_allowed'] as const) : [])];
        await setPropertyPets(p.id, pets, { ...(p.content ?? {}), ...(amenities ? { amenities } : {}), petsSource: 'details' });
        out.set(p.id, amenities);
      }),
    );
  }
  return out;
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
