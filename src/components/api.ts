import { withBase } from '@/lib/basePath';
import type { Action } from '@/lib/store/actions';
import type { Brief } from '@/server/brief';
import type { FormAnswer } from '@/server/onboarding';
import type { SessionView } from '@/server/view';

/** The browser's calls to the API. Every failure becomes an error code the UI has copy for. */

export class ApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(withBase(url), { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError('network');
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new ApiError(body?.error ?? 'server_error');
  return body;
}

export const createSession = () => request<{ sessionId: string }>('/api/session', { method: 'POST', body: '{}' });
export type Trip = { id: string; status: string; destination: string; checkIn: string; checkOut: string };
export const loadTrips = () => request<{ trips: Trip[] }>('/api/session');
export const loadSession = (id: string) => request<SessionView>(`/api/session/${id}`);
export const answerForm = (id: string, answer: FormAnswer) =>
  request<SessionView>(`/api/session/${id}/form`, { method: 'POST', body: JSON.stringify({ answer, today: todayLocal() }) });
/** The results header's chips: nationality, what "best" means, where "close" is from. */
export type EditAction = Extract<Action, { type: 'set_destination' | 'set_dates' | 'set_guests' | 'add_must_have' | 'remove_must_have' | 'set_nationality' | 'set_currency' | 'set_priorities' | 'set_near' | 'set_near_point' | 'clear_near' | 'set_min_stars' | 'set_min_rating' | 'set_property_types' | 'set_chains' }>;
export const editSearch = (id: string, actions: EditAction | EditAction[]) =>
  request<SessionView>(`/api/session/${id}/edit`, { method: 'POST', body: JSON.stringify({ actions: Array.isArray(actions) ? actions : [actions], today: todayLocal() }) });
/** The heart. A saved hotel carries the last price found for it, never a current price (docs/saved.md). */
export type SavedHotel = import('@/server/saved').SavedHotelView;
export const loadSaved = () => request<{ saved: SavedHotel[] }>('/api/saved');
export const setSaved = (body: { saved: true; propertyId: string; sessionId: string } | { saved: false; propertyId: string }) =>
  request<{ saved: SavedHotel[] }>('/api/saved', { method: 'POST', body: JSON.stringify(body) });
export type PlaceSuggestion = { placeId: string; label: string; name: string; where: string | null; kind: string };
export const searchPlaces = (q: string) => request<{ places: PlaceSuggestion[] }>(`/api/places?q=${encodeURIComponent(q)}`);
export type { Example } from '@/server/example';
export const loadExample = () => request<import('@/server/example').Example>('/api/example');
export const startBrief = (brief: Brief) => request<{ sessionId: string }>('/api/session/brief', { method: 'POST', body: JSON.stringify({ brief, today: todayLocal() }) });

/** One page of "Show all N hotels": the finder's rows after the top picks (lib/fullList.ts). */
export type FullListPage = { more: number; page: number; pageSize: number; rows: SessionView['shortlist'] };
export const loadFullList = (id: string, page: number) => request<FullListPage>(`/api/session/${id}/hotels?page=${page}`);

export type PropertyDetails = import('@/server/propertyDetails').PropertyDetailsView;
export const loadProperty = (sessionId: string, propertyId: string) => request<PropertyDetails>(`/api/session/${sessionId}/property/${propertyId}`);

/**
 * Send one chat message and wait for the stream to end. The idempotency key
 * is made by the caller once per message, so a retry cannot run it twice.
 */
export async function sendTurn(id: string, message: string, idempotencyKey: string, onEvent: (type: string) => void): Promise<void> {
  let res: Response;
  try {
    res = await fetch(withBase(`/api/session/${id}/turn`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, idempotencyKey, today: todayLocal() }),
    });
  } catch {
    throw new ApiError('network');
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? 'server_error');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const line = buffer.slice(0, cut).replace(/^data: /, '');
      buffer = buffer.slice(cut + 2);
      try {
        onEvent((JSON.parse(line) as { type: string }).type);
      } catch {
        // a partial frame; the session view is the source of truth anyway
      }
    }
  }
}

// ── Sign-in and booking ─────────────────────────────────────────────────────
export type BookingView = import('@/server/checkout').BookingView;
export type Wallet = import('@/server/payments').Wallet;
export type Me = { user: { email: string } | null; lastHolder: { firstName: string; lastName: string } | null };
export type BookingPage = Me & { booking: BookingView; me: { email: string } | null; payment: 'test' | 'none'; mail?: boolean };

export const loadMe = () => request<Me>('/api/me');
export const sendSignInCode = (email: string) => request<{ sent: true; devCode?: string }>('/api/auth/code', { method: 'POST', body: JSON.stringify({ email }) });
export const verifySignInCode = (email: string, code: string) =>
  request<{ signedIn: true }>('/api/auth/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
export const signOut = () => request<{ signedIn: false }>('/api/auth/sign-out', { method: 'POST', body: '{}' });
export const startCheckout = (sessionId: string, offerId: string) =>
  request<{ bookingId: string }>(`/api/session/${sessionId}/checkout`, { method: 'POST', body: JSON.stringify({ offerId }) });
export const loadBooking = (id: string) => request<BookingPage>(`/api/booking/${id}`);
export const confirmBooking = (
  id: string,
  body: { email: string; code: string; firstName: string; lastName: string; wallet: Wallet; acceptedTotalMinor: number; specialRequest?: string },
) => request<{ booking: BookingView }>(`/api/booking/${id}/confirm`, { method: 'POST', body: JSON.stringify(body) });
export const cancelBookingApi = (id: string) => request<{ booking: BookingView }>(`/api/booking/${id}/cancel`, { method: 'POST', body: '{}' });
export const freezeBookingApi = (id: string, body: { email: string; code: string; firstName: string; lastName: string; acceptedTotalMinor: number }) =>
  request<{ booking: BookingView }>(`/api/booking/${id}/freeze`, { method: 'POST', body: JSON.stringify(body) });
export const keepFrozenApi = (id: string, body: { wallet: Wallet; acceptedTotalMinor: number }) =>
  request<{ booking: BookingView }>(`/api/booking/${id}/keep`, { method: 'POST', body: JSON.stringify(body) });
export const releaseFrozenApi = (id: string) => request<{ booking: BookingView }>(`/api/booking/${id}/release`, { method: 'POST', body: '{}' });
export type BookingSummary = { id: string; status: string; hotelName: string | null; checkIn: string | null; checkOut: string | null };
export const loadBookings = () => request<{ bookings: BookingSummary[] }>('/api/bookings');

export type HotelRate = {
  offerId: string;
  roomName: string | null;
  boardName: string | null;
  refundable: boolean;
  freeCancellationUntil: string | null;
  penalties: Array<{ from: string | null; amountMinor: number; currency: string }>;
  fees: Array<{ description: string; amountMinor: number; currency: string; included: boolean }>;
  currency: string;
  totalMinor: number;
  payAtPropertyMinor: number;
};
export const loadRates = (sessionId: string, propertyId: string) => request<{ rates: HotelRate[] }>(`/api/session/${sessionId}/property/${propertyId}/rates`);
export const logEvent = (name: 'detail_open' | 'detail_book', props: { variant: string; sessionId: string }) =>
  fetch(withBase('/api/events'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, ...props }), keepalive: true }).catch(() => undefined);
