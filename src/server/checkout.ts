import 'server-only';

import type { CancellationPolicy, SupplierAdapter, SupplierOffer } from '@/server/supplier';
import { isCountryCode } from '@/lib/countries';
import { cleanSpecialRequest, payAtHotelCharges, type HotelCharge } from '@/lib/checkout';
import { freezeTerms } from '@/lib/freeze';
import { copy } from '@/lib/i18n';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/locale';
import { formatDates } from '@/lib/replies';
import { normalizeEmail, verifyCode } from '@/server/auth/otp';
import { userForVerifiedEmail } from '@/server/auth/user';
import { paymentMode, takePayment, type Wallet } from '@/server/payments';
import { createPrebooked, getBooking, transitionBooking, type Booking } from '@/server/repos/bookings';
import { appendMessage } from '@/server/repos/chat';
import { getOffer, insertOffers, type Offer } from '@/server/repos/offers';
import { getPreferences } from '@/server/repos/preferences';
import { dispatchActions } from '@/server/dispatch';
import { MAX_RATES } from '@/server/hotelRates';
import { offerRow } from '@/server/offerRows';
import { getProperty } from '@/server/repos/properties';
import { roomsLabel, roomsOf, sameOccupancies } from '@/lib/finder/rooms';
import { isMemberOnlyPrice, OFFER_TTL_MS, searchMarginPct } from '@/lib/pricing';
import { audienceFor, getSession, getStay, listStays, type SearchSession, type Stay } from '@/server/repos/sessions';
import { offerFees } from '@/server/view';

/**
 * Booking, in the order money demands:
 *
 *   1. start   – the supplier re-checks the rate (prebook) and the booking row
 *                is written BEFORE any payment sheet opens.
 *   2. confirm – one press: the email code signs the guest in, the payment is
 *                taken for exactly the price the guest was shown, the row is
 *                claimed paid → booking, and only the claimant calls book.
 *   3. cancel  – through the supplier; the refund is what the supplier says.
 */

/** A price check older than this is checked again before anyone pays it. */
export const PRICE_CHECK_TTL_MS = 20 * 60_000;

export type StartError = 'property_not_found' | 'rate_gone' | 'supplier_unavailable';

/**
 * "Book": the supplier re-checks the rate (prebook) and the booking row is
 * written before any payment sheet. Priced for whoever is looking now:
 *
 *   - signed in, the member rate;
 *   - signed out, the hotel's public price. A public row whose rate is lower
 *     for members holds a member-priced supplier offer, so it is never
 *     prebooked as it is: the same room is fetched again at the margin that
 *     reaches the hotel's public price (`publicRoom`), and that is prebooked.
 *
 * `quotedTotalMinor` is the price the person last saw (the card, or the
 * checkout before they signed in or said "Not you?"). The checkout shows
 * both numbers when the check differs from it.
 */
export async function startCheckout(args: {
  session: SearchSession;
  offerId: string;
  supplier: SupplierAdapter;
  quotedTotalMinor?: number;
  /** Fetch the room again even if the offer could be prebooked as it is (the nationality changed). */
  refetch?: boolean;
  now?: Date;
  /** The visitor's language: kept on the booking (bookingLocale). English when left out. */
  locale?: Locale;
}): Promise<{ ok: true; booking: Booking } | { ok: false; error: StartError }> {
  const { session, supplier } = args;
  const now = args.now ?? new Date();
  const audience = audienceFor(session);
  const picked = await getOffer(args.offerId, session.id, audience);
  // A member price is never sold to an anonymous visitor, even by its id.
  if (!picked || isMemberOnlyPrice(picked, audience)) return { ok: false, error: 'property_not_found' };
  const [stay, property] = await Promise.all([getStay(picked.stayId, session.id), getProperty(picked.propertyId)]);
  if (!stay || !property) return { ok: false, error: 'property_not_found' };

  let offer = picked;
  let refetched = false;
  if (args.refetch || !prebookableAsIs(picked, audience)) {
    const again = await roomFor({ session, stay, property, offer: picked, supplier, now });
    if (!again.ok) return again;
    offer = again.offer;
    refetched = true;
  }
  let check = await supplier.recheckRate(offer.supplierOfferId);
  // The rate fell under the hotel's public price since it was fetched: a
  // signed-out visitor is never held at it. Fetched again at the public price, once.
  if (check.ok && audience === 'public' && underPublicPrice(check.value) && !refetched) {
    const again = await roomFor({ session, stay, property, offer: picked, supplier, now, forcePublicMargin: true });
    if (!again.ok) return again;
    offer = again.offer;
    check = await supplier.recheckRate(offer.supplierOfferId);
  }
  if (!check.ok) return { ok: false, error: check.error.retryable ? 'supplier_unavailable' : 'rate_gone' };
  if (audience === 'public' && underPublicPrice(check.value)) return { ok: false, error: 'rate_gone' };
  // Exactly the rooms on the card, for the same people: a prebook holding any
  // other split is not the offer the guest chose, whatever it costs.
  const shown = roomsOf(offer.rooms);
  const held = check.value.rooms;
  if (shown && held.length > 0 && !sameOccupancies(shown, held)) return { ok: false, error: 'rate_gone' };
  const rooms = held.length > 0 ? held : shown;
  const quoted = args.quotedTotalMinor ?? picked.totalMinor;

  const booking = await createPrebooked({
    userId: session.userId,
    sessionId: session.id,
    offerId: offer.id,
    supplier: offer.supplier,
    prebookId: check.value.prebookId,
    transactionId: check.value.transactionId,
    currency: check.value.total.currency,
    totalMinor: check.value.total.amountMinor,
    // A quote in another currency cannot be compared: it is shown as a change.
    quotedTotalMinor: check.value.total.currency === picked.currency ? quoted : -1,
    propertyId: property.id,
    hotelName: property.name,
    // The rooms as the supplier holds them now: what the guest pays for and what book books.
    roomName: (rooms && roomsLabel(rooms)) ?? offer.roomName,
    boardName: offer.boardName,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    adults: stay.adults,
    childrenAges: stay.childrenAges,
    // One guest per room at book: the offer's rooms, which are not the stay's when we chose them.
    rooms: rooms?.length ?? stay.rooms ?? 1,
    payAtPropertyMinor: offer.payAtPropertyMinor,
    // Named and in their own currency: the page says what the hotel will ask for, not only a sum.
    payAtPropertyFees: payAtHotelCharges(offerFees(offer.taxesAndFees, args.locale)),
    locale: args.locale ?? DEFAULT_LOCALE,
    cancellation: (check.value.cancellation ?? offer.cancellation) as Record<string, unknown> | null,
  });
  return { ok: true, booking };
}

/**
 * An offer row this viewer can prebook as it stands: fetched at today's
 * search margin, and for a signed-out visitor, not lower for members (its
 * supplier offer would hold the member rate).
 */
function prebookableAsIs(offer: Offer, audience: 'public' | 'member'): boolean {
  if (Number(offer.marginPct) !== searchMarginPct()) return audience === 'public' && !offer.lowerForMembers;
  return audience === 'member' || !offer.lowerForMembers;
}

const underPublicPrice = (c: { total: { amountMinor: number; currency: string }; suggestedSelling: { amountMinor: number; currency: string } | null }) =>
  c.suggestedSelling !== null && c.suggestedSelling.currency === c.total.currency && c.total.amountMinor < c.suggestedSelling.amountMinor;

/** Same hotel, same rooms for the same people, same board, same cancellation terms. */
export function sameRoom(
  a: { roomName: string | null; boardName: string | null; refundableTag: string | null; rooms: unknown },
  b: { roomName: string | null; boardName: string | null; refundableTag: string | null; rooms: unknown },
): boolean {
  const ra = roomsOf(a.rooms);
  const rb = roomsOf(b.rooms);
  return a.roomName === b.roomName && a.boardName === b.boardName && a.refundableTag === b.refundableTag && (!ra || !rb || sameOccupancies(ra, rb));
}

/** The most margin added to reach a hotel's public price. Beyond it the room is not offered signed out. */
const MAX_PUBLIC_MARGIN_PCT = 50;

/**
 * The room the person picked, fetched again for whoever is looking now: at
 * the session's nationality and the search margin, and stored as a detail
 * row for this audience. Signed out, when the rate is under the hotel's
 * public price, it is fetched once more at the margin that lifts it to that
 * price, and only that second offer is stored: the member rate stays in this
 * function (sandbox-verified: docs/supplier.md "Public and member prices").
 *
 * The margin here is per hotel, but it never ranks anything: it only makes
 * the price already shown, the hotel's own, bookable.
 */
async function roomFor(args: {
  session: SearchSession;
  stay: Stay;
  property: { id: string; supplierHotelId: string };
  offer: Offer;
  supplier: SupplierAdapter;
  now: Date;
  forcePublicMargin?: boolean;
}): Promise<{ ok: true; offer: Offer } | { ok: false; error: StartError }> {
  const { session, stay, property, offer, supplier, now } = args;
  const audience = audienceFor(session);
  if (!session.guestNationality) return { ok: false, error: 'rate_gone' };
  const occupancies = (roomsOf(offer.rooms) ?? []).map((r) => ({ adults: r.adults, childrenAges: r.childrenAges }));
  const search = (marginPct: number) =>
    supplier.searchAvailability({
      where: { hotelIds: [property.supplierHotelId] },
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      occupancies: occupancies.length > 0 ? occupancies : [{ adults: stay.adults, childrenAges: stay.childrenAges }],
      currency: offer.currency,
      guestNationality: session.guestNationality!,
      marginPct,
      maxHotels: 1,
      maxRatesPerHotel: MAX_RATES,
    });
  const find = (offers: SupplierOffer[]) =>
    offers
      .filter((o) => o.supplierHotelId === property.supplierHotelId && o.total.currency === offer.currency)
      .filter((o) => sameRoom(offer, { roomName: roomsLabel(o.rooms), boardName: o.rooms[0]?.boardName ?? null, refundableTag: o.cancellation.tag, rooms: o.rooms }))
      .sort((x, y) => x.total.amountMinor - y.total.amountMinor)[0];
  const store = async (o: SupplierOffer) => {
    const [row] = await insertOffers([offerRow(o, { sessionId: session.id, stayId: stay.id, propertyId: property.id, audience, now, expiresAt: new Date(now.getTime() + OFFER_TTL_MS), detailOnly: true })]);
    return { ok: true as const, offer: row };
  };

  const base = searchMarginPct();
  const first = await search(base);
  if (!first.ok) return { ok: false, error: first.error.retryable ? 'supplier_unavailable' : 'rate_gone' };
  const rate = find(first.value.offers);
  if (!rate) return { ok: false, error: 'rate_gone' };
  const ssp = rate.suggestedSelling?.currency === rate.total.currency ? rate.suggestedSelling.amountMinor : null;
  if (audience === 'member' || ssp === null || (rate.total.amountMinor >= ssp && !args.forcePublicMargin)) return store(rate);

  // Signed out and under the hotel's public price: the margin that reaches it,
  // from the supplier's own net (total less our commission), rounded up.
  const net = rate.commission ? rate.total.amountMinor - rate.commission.amountMinor : rate.total.amountMinor / (1 + base / 100);
  // Always above the search margin: that one priced the room under the hotel's price.
  let margin = Math.max(base + 0.01, Math.ceil(((ssp / net - 1) * 100 + 0.01) * 100) / 100);
  for (let attempt = 0; attempt < 2 && margin <= MAX_PUBLIC_MARGIN_PCT; attempt++) {
    const lifted = await search(margin);
    if (!lifted.ok) return { ok: false, error: lifted.error.retryable ? 'supplier_unavailable' : 'rate_gone' };
    const at = find(lifted.value.offers);
    if (!at) return { ok: false, error: 'rate_gone' };
    if (at.total.amountMinor >= ssp) return store(at);
    margin = Math.ceil((margin + ((ssp - at.total.amountMinor) / net) * 100 + 0.01) * 100) / 100;
  }
  return { ok: false, error: 'rate_gone' };
}

export type RepriceError = StartError | 'booking_not_payable';

/**
 * "Re-price for whoever is looking now", for a checkout. After a sign-in in
 * the checkout's modal (signed out, or after "Not you?"): the account's own
 * nationality, if it has one, becomes the search's (a new search, through the
 * one dispatch path), then the same room is prebooked for this account. The
 * new booking's quoted price is the one the person last saw, so the page
 * shows both when they differ.
 */
export async function repriceCheckout(args: {
  session: SearchSession;
  booking: Booking;
  supplier: SupplierAdapter;
  now: Date;
  locale?: Locale;
}): Promise<{ ok: true; booking: Booking } | { ok: false; error: RepriceError }> {
  const { booking, supplier, now } = args;
  if (booking.status !== 'prebooked' || !booking.offerId) return { ok: false, error: 'booking_not_payable' };
  const viewer = await viewerNationality(args.session, supplier, now);
  return startCheckout({ session: viewer.session, offerId: booking.offerId, supplier, quotedTotalMinor: booking.totalMinor, refetch: viewer.changed, now, locale: args.locale ?? bookingLocale(booking) });
}

/**
 * The signed-in account's saved nationality, applied to the search when it
 * differs: rates depend on it. Through dispatch, so the whole search is
 * fetched again for it, as any change of nationality is.
 */
export async function viewerNationality(session: SearchSession, supplier: SupplierAdapter, now: Date): Promise<{ session: SearchSession; changed: boolean }> {
  if (!session.userId) return { session, changed: false };
  const saved = (await getPreferences(session.userId))?.guestNationality ?? null;
  if (!saved || saved === session.guestNationality || !isCountryCode(saved)) return { session, changed: false };
  // Through the one dispatch path, which also fetches the search again for it.
  const [stay] = await listStays(session.id);
  if (!stay) return { session, changed: false };
  await dispatchActions({ session, stay, actions: [{ type: 'set_nationality', code: saved }], supplier, now, today: now.toISOString().slice(0, 10) });
  return { session: (await getSession(session.id)) ?? session, changed: true };
}

export type ConfirmInput = {
  bookingId: string;
  /** Null when the browser is not signed in: then email and code are required. */
  signedInUserId: string | null;
  email: string;
  code: string;
  firstName: string;
  lastName: string;
  wallet: Wallet;
  /** The guest's words for the hotel, as typed; cleaned here. Forwarded, never read. */
  specialRequest?: string | null;
  /** The total the page showed when the wallet was pressed. Must equal the checked price. */
  acceptedTotalMinor: number;
  supplier: SupplierAdapter;
  now: Date;
  /** The language of the request: the chat line is written in it. The booking's own when left out. */
  locale?: Locale;
};

/** The language a booking was checked out (or frozen) in; English for rows from before it was kept. */
export function bookingLocale(b: Pick<Booking, 'locale'>): Locale {
  return isLocale(b.locale) ? b.locale : DEFAULT_LOCALE;
}

export type ConfirmError =
  | 'booking_not_found'
  | 'booking_not_payable'
  | 'price_changed'
  | 'price_stale'
  | 'name_missing'
  | 'request_too_long'
  | 'email_invalid'
  | 'code_wrong'
  | 'code_expired'
  | 'payment_unavailable'
  | 'booking_failed'
  | 'booking_unknown';

export type ConfirmResult = { ok: true; booking: Booking; signedInAs: string | null } | { ok: false; error: ConfirmError; signedInAs: string | null };

const NAME = /^[\p{L}][\p{L}\p{M}' .-]{0,59}$/u;
const cleanName = (s: string) => s.trim().replace(/\s+/g, ' ');

/** The guest's names as typed, or null when either is missing or not a name. */
export function guestNames(input: { firstName: string; lastName: string }): { firstName: string; lastName: string } | null {
  const firstName = cleanName(input.firstName);
  const lastName = cleanName(input.lastName);
  return NAME.test(firstName) && NAME.test(lastName) ? { firstName, lastName } : null;
}

/**
 * The account a booking step acts for: the signed-in one, or the one the
 * email code proves. `signedInAs` is set when the code was spent here, so the
 * route signs the browser in even when the step then fails.
 */
export async function signInGuest(
  input: { signedInUserId: string | null; email: string; code: string },
  now: Date,
): Promise<{ ok: true; userId: string; email: string; signedInAs: string | null } | { ok: false; error: 'email_invalid' | 'code_wrong' | 'code_expired'; signedInAs: string | null }> {
  if (input.signedInUserId) {
    const email = normalizeEmail(input.email);
    return email ? { ok: true, userId: input.signedInUserId, email, signedInAs: null } : { ok: false, error: 'email_invalid', signedInAs: null };
  }
  const normalized = normalizeEmail(input.email);
  if (!normalized) return { ok: false, error: 'email_invalid', signedInAs: null };
  const verified = await verifyCode(normalized, input.code.trim(), now);
  if (!verified.ok) return { ok: false, error: verified.error, signedInAs: null };
  const user = await userForVerifiedEmail(normalized, now);
  return { ok: true, userId: user.id, email: normalized, signedInAs: user.id };
}

export async function confirmCheckout(input: ConfirmInput): Promise<ConfirmResult> {
  const { now } = input;
  const booking = await getBooking(input.bookingId);
  if (!booking) return { ok: false, error: 'booking_not_found', signedInAs: null };
  if (booking.status !== 'prebooked') return { ok: false, error: 'booking_not_payable', signedInAs: null };
  // Only the price the guest saw can be paid: a changed price needs a fresh press.
  if (input.acceptedTotalMinor !== booking.totalMinor) return { ok: false, error: 'price_changed', signedInAs: null };
  if (now.getTime() - booking.createdAt.getTime() > PRICE_CHECK_TTL_MS) return { ok: false, error: 'price_stale', signedInAs: null };
  const names = guestNames(input);
  if (!names) return { ok: false, error: 'name_missing', signedInAs: null };
  const { firstName, lastName } = names;
  const request = cleanSpecialRequest(input.specialRequest);
  if (!request.ok) return { ok: false, error: 'request_too_long', signedInAs: null };
  if (paymentMode() === 'none') return { ok: false, error: 'payment_unavailable', signedInAs: null };

  // Sign in first: a wrong code stops here, before any payment.
  const guest = await signInGuest(input, now);
  if (!guest.ok) return { ok: false, error: guest.error, signedInAs: guest.signedInAs };
  const { userId, email, signedInAs } = guest;

  const pending = await transitionBooking(booking.id, 'payment_pending', { userId, holderFirstName: firstName, holderLastName: lastName, holderEmail: email, paidWith: input.wallet, specialRequest: request.value });
  if (!pending) return { ok: false, error: 'booking_not_payable', signedInAs };
  const paid = await takePayment({ wallet: input.wallet, amountMinor: booking.totalMinor, currency: booking.currency });
  if (!paid.ok) {
    await transitionBooking(booking.id, 'failed', { failureCode: paid.error });
    return { ok: false, error: paid.error, signedInAs };
  }
  if (!(await transitionBooking(booking.id, 'paid', { testPayment: paid.test }))) return { ok: false, error: 'booking_not_payable', signedInAs };

  // The row as it now stands: it carries the request that bookPaid sends.
  const booked = await bookPaid({ booking: pending, guest: { firstName, lastName, email }, test: paid.test, supplier: input.supplier });
  if (!booked.ok) return { ok: false, error: booked.error, signedInAs };
  const confirmed = booked.booking;
  if (booking.sessionId && booking.checkIn && booking.checkOut) {
    const locale = input.locale ?? bookingLocale(booking);
    await appendMessage({
      sessionId: booking.sessionId,
      role: 'assistant',
      kind: 'line',
      content: copy(locale).booking.bookedLine(booking.hotelName ?? '', formatDates(booking.checkIn, booking.checkOut, locale), confirmed.supplierBookingId ?? ''),
      meta: { booking: booking.id },
    });
  }
  return { ok: true, booking: confirmed, signedInAs };
}

/**
 * A paid booking to the supplier. THE CLAIM: book is not idempotent at the
 * supplier (a second call books a second room), so only whoever moves the row
 * paid → booking calls it, once. Also the entry point for a payment confirmed
 * out of band (the real wallet path), which is why it re-reads nothing.
 */
export async function bookPaid(args: {
  booking: Booking;
  guest: { firstName: string; lastName: string; email: string };
  test: boolean;
  supplier: SupplierAdapter;
}): Promise<{ ok: true; booking: Booking } | { ok: false; error: 'booking_not_payable' | 'booking_failed' | 'booking_unknown' }> {
  const { booking, guest } = args;
  const claimed = await transitionBooking(booking.id, 'booking');
  if (!claimed) return { ok: false, error: 'booking_not_payable' };
  const result = await args.supplier.book({
    prebookId: booking.prebookId,
    transactionId: booking.transactionId,
    holder: guest,
    guests: Array.from({ length: Math.max(1, booking.rooms ?? 1) }, () => guest),
    payment: args.test ? 'sandbox_test' : 'transaction_id',
    specialRequest: booking.specialRequest,
  });
  if (!result.ok) {
    // A timeout or a dropped connection leaves the outcome unknown: the row stays
    // in `booking` and is never booked again. A refusal is final.
    if (result.error.retryable) return { ok: false, error: 'booking_unknown' };
    await transitionBooking(booking.id, 'failed', { failureCode: 'booking_failed' });
    return { ok: false, error: 'booking_failed' };
  }
  if (result.value.status !== 'confirmed') return { ok: false, error: 'booking_unknown' };
  const confirmed = await transitionBooking(booking.id, 'confirmed', {
    supplierBookingId: result.value.supplierBookingId,
    hotelConfirmationCode: result.value.hotelConfirmationCode ?? undefined,
  });
  return confirmed ? { ok: true, booking: confirmed } : { ok: false, error: 'booking_unknown' };
}

export type CancelError = 'booking_not_found' | 'not_cancellable' | 'cancel_failed';

export async function cancelBooking(args: { bookingId: string; supplier: SupplierAdapter; locale?: Locale }): Promise<{ ok: true; booking: Booking } | { ok: false; error: CancelError }> {
  const booking = await getBooking(args.bookingId);
  if (!booking) return { ok: false, error: 'booking_not_found' };
  if (booking.status !== 'confirmed' || !booking.supplierBookingId) return { ok: false, error: 'not_cancellable' };
  const result = await args.supplier.cancel(booking.supplierBookingId);
  if (!result.ok || result.value.status !== 'cancelled') return { ok: false, error: 'cancel_failed' };
  const cancelled = await transitionBooking(booking.id, 'cancelled', { refundMinor: result.value.refund.amountMinor, cancelFeeMinor: result.value.fee.amountMinor });
  if (booking.sessionId) {
    await appendMessage({ sessionId: booking.sessionId, role: 'assistant', kind: 'line', content: copy(args.locale ?? bookingLocale(booking)).booking.cancelledLine(booking.hotelName ?? '', booking.supplierBookingId), meta: { booking: booking.id } });
  }
  return { ok: true, booking: cancelled ?? booking };
}

/** What the checkout and receipt page shows. Supplier ids stay on the server except the booking reference. */
export function bookingView(b: Booking, now: Date) {
  const cancellation = b.cancellation as Partial<CancellationPolicy> | null;
  return {
    id: b.id,
    sessionId: b.sessionId,
    status: b.status,
    hotelName: b.hotelName,
    roomName: b.roomName,
    boardName: b.boardName,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    adults: b.adults,
    childrenAges: b.childrenAges ?? [],
    rooms: b.rooms,
    currency: b.currency,
    totalMinor: b.totalMinor,
    /** null when the card's price was in another currency and cannot be compared. */
    quotedTotalMinor: b.quotedTotalMinor >= 0 ? b.quotedTotalMinor : null,
    priceChanged: b.quotedTotalMinor !== b.totalMinor,
    payAtPropertyMinor: b.payAtPropertyMinor ?? 0,
    /** Each charge the hotel collects, as the supplier names it. null on bookings made before they were kept. */
    payAtPropertyFees: (b.payAtPropertyFees ?? null) as HotelCharge[] | null,
    /** What the guest asked the hotel for. Not guaranteed. */
    specialRequest: b.specialRequest,
    refundable: cancellation?.refundable ?? null,
    freeCancellationUntil: cancellation?.freeCancellationUntil ?? null,
    checkedAt: b.createdAt.toISOString(),
    priceCheckStale: b.status === 'prebooked' && now.getTime() - b.createdAt.getTime() > PRICE_CHECK_TTL_MS,
    reference: b.supplierBookingId,
    hotelConfirmationCode: b.hotelConfirmationCode,
    holder: b.holderFirstName ? { firstName: b.holderFirstName, lastName: b.holderLastName, email: b.holderEmail } : null,
    paidWith: b.paidWith,
    testPayment: b.testPayment,
    failureCode: b.failureCode,
    refundMinor: b.refundMinor,
    cancelFeeMinor: b.cancelFeeMinor,
    offerId: b.offerId,
    /** Deal Freeze, before anything is booked: until when this rate could be held, or null when it cannot. */
    freezeOffer: b.status === 'prebooked' ? freezeOfferOf(b, now) : null,
    frozenUntil: b.frozenUntil?.toISOString() ?? null,
    freezeReminderDueAt: b.freezeReminderDueAt?.toISOString() ?? null,
    freezeReminderSentAt: b.freezeReminderSentAt?.toISOString() ?? null,
    releasedBy: b.releasedBy,
  };
}

function freezeOfferOf(b: Booking, now: Date): { until: string; reminderAt: string } | null {
  const terms = freezeTerms(b.cancellation, now);
  return terms.ok ? { until: terms.frozenUntil.toISOString(), reminderAt: terms.reminderDueAt.toISOString() } : null;
}
export type BookingView = ReturnType<typeof bookingView>;
