/**
 * The API as a test drives it: one method per route and method, relative to
 * the /hotels/ base URL, each returning the raw response so a test can check
 * status, headers and body. `json(res, schema)` parses strictly.
 */
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import type { z } from 'zod';

import { ERROR_COPY, type ErrorCode } from './copy';
import { canonicalDates, todayLocal } from './dates';
import * as S from './schemas';

export type Brief = {
  text?: string;
  place?: { placeId: string; label: string } | null;
  dates?: { checkIn: string; checkOut: string } | null;
  guests?: { adults: number; childrenAges: number[]; rooms: number; pets: boolean } | null;
  priorities?: Array<'cheapest' | 'nicest' | 'closest'>;
};

/** Porto, Portugal as the place search names it; looked up once per worker, never hard-coded. */
let porto: Promise<{ placeId: string; label: string }> | null = null;

export class Api {
  constructor(private readonly source: APIRequestContext | (() => APIRequestContext)) {}
  get request(): APIRequestContext {
    return typeof this.source === 'function' ? this.source() : this.source;
  }

  // ── Plain calls ────────────────────────────────────────────────────────────
  health = (query = '') => this.request.get(`api/health${query}`);
  example = () => this.request.get('api/example');
  me = () => this.request.get('api/me');
  bookings = () => this.request.get('api/bookings');
  places = (q: string) => this.request.get(`api/places?q=${encodeURIComponent(q)}`);
  trips = () => this.request.get('api/session');
  newSession = (body: unknown = {}) => this.request.post('api/session', { data: body });
  brief = (body: unknown) => this.request.post('api/session/brief', { data: body });
  session = (id: string) => this.request.get(`api/session/${id}`);
  turns = (id: string) => this.request.get(`api/session/${id}/turns`);
  form = (id: string, body: unknown) => this.request.post(`api/session/${id}/form`, { data: body });
  edit = (id: string, body: unknown) => this.request.post(`api/session/${id}/edit`, { data: body });
  turn = (id: string, body: unknown) => this.request.post(`api/session/${id}/turn`, { data: body });
  property = (id: string, propertyId: string) => this.request.get(`api/session/${id}/property/${propertyId}`);
  rates = (id: string, propertyId: string) => this.request.get(`api/session/${id}/property/${propertyId}/rates`);
  checkout = (id: string, body: unknown) => this.request.post(`api/session/${id}/checkout`, { data: body });
  booking = (id: string) => this.request.get(`api/booking/${id}`);
  confirm = (id: string, body: unknown) => this.request.post(`api/booking/${id}/confirm`, { data: body });
  cancel = (id: string, body: unknown = {}) => this.request.post(`api/booking/${id}/cancel`, { data: body });
  code = (body: unknown) => this.request.post('api/auth/code', { data: body });
  verify = (body: unknown) => this.request.post('api/auth/verify', { data: body });
  signOut = (body: unknown = {}) => this.request.post('api/auth/sign-out', { data: body });
  events = (body: unknown) => this.request.post('api/events', { data: body });
  hotels = (id: string, query = '?page=1') => this.request.get(`api/session/${id}/hotels${query}`);
  saved = () => this.request.get('api/saved');
  save = (body: unknown) => this.request.post('api/saved', { data: body });
  freeze = (id: string, body: unknown) => this.request.post(`api/booking/${id}/freeze`, { data: body });
  keep = (id: string, body: unknown) => this.request.post(`api/booking/${id}/keep`, { data: body });
  release = (id: string, body: unknown = {}) => this.request.post(`api/booking/${id}/release`, { data: body });
  sweep = (authorization?: string) => this.request.get('api/freeze/sweep', authorization ? { headers: { authorization } } : undefined);

  // ── Steps many tests share ──────────────────────────────────────────────────
  async porto(): Promise<{ placeId: string; label: string }> {
    porto ??= (async () => {
      const res = await this.patient(() => this.places('porto'));
      // Loose on purpose: the strict shape is the places API test's job (e2e/api/public.spec.ts).
      const body = (await res.json()) as { places?: Array<{ placeId: string; label: string }> };
      if (!body.places) throw new Error(`the place search answered ${res.status()}: ${JSON.stringify(body)}`);
      const city = body.places.find((p) => p.label === 'Porto, Portugal');
      if (!city) throw new Error(`the place search has no "Porto, Portugal": ${JSON.stringify(body)}`);
      return { placeId: city.placeId, label: city.label };
    })().catch((e) => {
      porto = null;
      throw e;
    });
    return porto;
  }

  /**
   * A finished search through the first screen's one submit: Porto, the canonical weekend, 2 adults.
   * For SETUP only: when the sandbox refuses the hotel search (its rate limit, shared by every
   * worker and shard), it waits and starts a new search, up to three times. A test of the search
   * itself drives it without this (docs/testing.md, "the sandbox's rate limit").
   */
  async search(brief: Brief = {}): Promise<{ sessionId: string; view: S.SessionViewBody }> {
    const place = brief.place === undefined && !brief.text ? await this.porto() : (brief.place ?? null);
    const dates = brief.dates === undefined ? canonicalDates() : brief.dates;
    for (let attempt = 1; ; attempt++) {
      const res = await this.brief({ brief: { ...brief, place, dates }, today: todayLocal() });
      const { sessionId } = await json(res, S.sessionIdBody);
      const view = await json(await this.session(sessionId), S.sessionView);
      const refused = view.messages.some((m) => m.content === 'The hotel search did not answer. Send that again.');
      if (!refused || attempt === 3) return { sessionId, view };
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }

  /** GET with up to three tries while the sandbox says it is busy (503 supplier_unavailable). Setup only. */
  async patient(call: () => Promise<APIResponse>): Promise<APIResponse> {
    for (let attempt = 1; ; attempt++) {
      const res = await call();
      if (res.status() !== 503 || attempt === 3) return res;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }

  /**
   * A checkout past the price re-check whose rate can be frozen (docs/deal-freeze.md): refundable, with a
   * free-cancellation deadline at least 72 h away. Searched five weeks out, where the sandbox still has such
   * rates (a week out it often has none); the top picks first, then the full list. Setup only.
   */
  async freezable(): Promise<{ sessionId: string; bookingId: string; booking: S.BookingViewBody }> {
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const { sessionId, view } = await this.search({ dates: { checkIn: day(35), checkOut: day(37) } });
    const full = view.fullList.more > 0 ? (await json(await this.hotels(sessionId), S.fullListBody)).rows : [];
    const soon = Date.now() + 80 * 3_600_000;
    const candidates = [...view.shortlist, ...full].filter((r) => r.offer?.refundable && r.offer.freeCancellationUntil && Date.parse(r.offer.freeCancellationUntil) > soon);
    for (const row of candidates) {
      const res = await this.patient(() => this.checkout(sessionId, { offerId: row.offer!.id }));
      if (!res.ok()) continue;
      const { bookingId } = S.bookingIdBody.parse(await res.json());
      const { booking } = await json(await this.booking(bookingId), S.bookingPageBody);
      if (booking.freezeOffer) return { sessionId, bookingId, booking };
    }
    throw new Error(`no freezable rate among ${candidates.length} refundable offers five weeks out: the sandbox answered without one`);
  }

  /** Sends a code and returns it: no email service in e2e, so the answer carries it (dev mailbox). */
  async sendCode(email: string): Promise<string> {
    const body = await json(await this.code({ email }), S.codeSentBody);
    if (!body.devCode) throw new Error('no devCode: is RESEND_API_KEY blank for this server?');
    return body.devCode;
  }

  async signIn(email: string): Promise<void> {
    const code = await this.sendCode(email);
    await json(await this.verify({ email, code }), S.signedInBody);
  }
}

/** Status 2xx and a body of exactly this shape. */
export async function json<T extends z.ZodTypeAny>(res: APIResponse, schema: T): Promise<z.infer<T>> {
  const text = await res.text();
  expect(res.status(), `${res.url()} answered ${res.status()}: ${text.slice(0, 400)}`).toBeLessThan(300);
  return parse(text, schema, res.url());
}

export function parse<T extends z.ZodTypeAny>(text: string, schema: T, where = 'body'): z.infer<T> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${where}: not JSON: ${text.slice(0, 200)}`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error(`${where}: unexpected shape: ${parsed.error.message}\n${text.slice(0, 600)}`);
  return parsed.data;
}

/** The documented error answer: this status, this code (which has copy), JSON, and a ref only on a 500. */
export async function expectError(res: APIResponse, status: number, code: ErrorCode): Promise<void> {
  const text = await res.text();
  expect(`${res.status()} ${text}`, res.url()).toBe(`${status} ${JSON.stringify(status >= 500 && code === 'server_error' ? { error: code, ref: JSON.parse(text).ref } : { error: code })}`);
  expect(res.headers()['content-type']).toContain('application/json');
  expect(ERROR_COPY[code]).toBeTruthy();
  const body = parse(text, S.errorBody, res.url());
  if (status === 500) expect(body.ref, 'a 500 carries the ref its log line has').toMatch(/^[0-9a-f]{8}$/);
}

/** A method the route does not export: 405, nothing done. */
export async function expectMethodNotAllowed(request: APIRequestContext, method: string, path: string): Promise<void> {
  const res = await request.fetch(path, { method, data: method === 'GET' || method === 'HEAD' ? undefined : {} });
  expect(res.status(), `${method} ${path}`).toBe(405);
}
