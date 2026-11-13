/**
 * The one `test` every spec imports. What it adds to Playwright's:
 *
 *  - every test is its own visitor: its own cookies, and its own client IP
 *    (`x-forwarded-for`, which the app's per-IP limits key on), so parallel
 *    workers never share a rate-limit bucket;
 *  - `api`: the API client for that same visitor (cookies move between it and
 *    the browser with `visitor.toBrowser()` / `visitor.fromBrowser()`);
 *  - `diagnostics` (automatic): console errors, page errors, failed requests,
 *    4xx/5xx answers and refless 500s fail the test at teardown;
 *  - state fixtures: `searched` (a finished Porto search, opened in the page),
 *    `signedIn`, `admin`, `prebooked` (a checkout past the price re-check) and
 *    `booked` (a real sandbox booking, cancelled at teardown).
 */
import { request as playwrightRequest, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { test as base } from '@playwright/test';

import { Api, json } from '../support/api';
import { Diagnostics } from '../support/diagnostics';
import { ADMIN_EMAILS, BASE_URL, BYPASS_HEADERS, ORIGIN, uniqueEmail } from '../support/env';
import { expect } from '../support/matchers';
import * as S from '../support/schemas';
import { AppPage } from '../pages/app';

export { expect };

/** A client IP of its own for each test (and each retry). */
function ipFor(info: TestInfo): string {
  let h = 2166136261;
  for (const c of `${info.testId}#${info.retry}#${info.repeatEachIndex}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const n = h >>> 0;
  return `10.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${Math.max(1, n & 255)}`;
}

/** Another client's IP, for a request that must not share this test's identity or rate-limit bucket. */
export function otherIp(ip: string): string {
  const [a, b, c, d] = ip.split('.').map(Number);
  return `${a}.${b}.${(c + 101) % 256}.${d}`;
}

/** A stranger: no cookies, another IP. */
export const stranger = (ip: string) => newRequest(otherIp(ip));

export class Visitor {
  constructor(
    readonly ip: string,
    private req: APIRequestContext,
    readonly context: BrowserContext,
  ) {}
  api = () => new Api(() => this.req);
  get request() {
    return this.req;
  }
  /** The API's cookies (a session it started, a sign-in) into the browser. */
  async toBrowser(): Promise<void> {
    const { cookies } = await this.req.storageState();
    if (cookies.length) await this.context.addCookies(cookies);
  }
  /** The browser's cookies into the API client, for API checks after UI steps. */
  async fromBrowser(): Promise<void> {
    const state = await this.context.storageState();
    const next = await newRequest(this.ip, state);
    await this.req.dispose();
    this.req = next;
  }
  async dispose(): Promise<void> {
    await this.req.dispose();
  }
}

export async function newRequest(ip: string, storageState?: Awaited<ReturnType<BrowserContext['storageState']>>): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { ...BYPASS_HEADERS, 'x-forwarded-for': ip }, storageState });
}

/** Open a session the API made, in this page: the app reopens the search it last stored. */
export async function openSession(page: Page, sessionId: string, query = ''): Promise<void> {
  await page.addInitScript((id) => {
    // Once per tab: a later "New search" or reload must behave as it would for a person.
    if (!sessionStorage.getItem('e2e-seeded')) {
      localStorage.setItem('hf_session', id);
      sessionStorage.setItem('e2e-seeded', '1');
    }
  }, sessionId);
  await page.goto(`./${query}`);
}

let adminTurn = 0;

type Fixtures = {
  ip: string;
  visitor: Visitor;
  api: Api;
  diagnostics: Diagnostics;
  app: AppPage;
  searched: { sessionId: string; view: S.SessionViewBody };
  signedIn: { email: string };
  admin: { email: string };
  prebooked: { sessionId: string; bookingId: string; view: S.SessionViewBody; booking: S.BookingViewBody };
  booked: { sessionId: string; bookingId: string; email: string; booking: S.BookingViewBody };
};

export const test = base.extend<Fixtures>({
  ip: async ({}, use, info) => use(ipFor(info)),

  context: async ({ context, ip }, use) => {
    // Our own origin only: a header on a third party's request (map tiles, hotel photos) would trigger CORS preflights.
    await context.route(`${ORIGIN}/**`, (route) => route.fallback({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }));
    await use(context);
  },

  visitor: async ({ context, ip }, use) => {
    const v = new Visitor(ip, await newRequest(ip), context);
    await use(v);
    await v.dispose();
  },

  api: async ({ visitor }, use) => use(visitor.api()),

  diagnostics: [
    async ({ context }, use, info) => {
      const d = new Diagnostics();
      d.attach(context);
      await use(d);
      const problems = await d.settle();
      if (d.sandboxBusy.length) info.annotations.push({ type: 'sandbox-busy', description: d.sandboxBusy.join('\n') });
      if (problems.length) {
        await info.attach('diagnostics', { body: problems.join('\n'), contentType: 'text/plain' });
        // Only when the test passed otherwise: a failed assertion already says what went wrong.
        if (info.status === info.expectedStatus) expect(problems, 'unexpected console errors, page errors or failed requests').toEqual([]);
      }
    },
    { auto: true },
  ],

  app: async ({ page }, use) => use(new AppPage(page)),

  searched: async ({ visitor, page }, use) => {
    const { sessionId, view } = await visitor.api().search();
    expect(view.shortlist.length, `the canonical search found no hotels: ${view.messages.map((m) => m.content).join(' | ')}`).toBeGreaterThan(0);
    await visitor.toBrowser();
    void page;
    await use({ sessionId, view });
  },

  signedIn: async ({ visitor }, use) => {
    const email = uniqueEmail('user');
    await visitor.api().signIn(email);
    await visitor.toBrowser();
    await use({ email });
  },

  admin: async ({ visitor }, use, info) => {
    adminTurn += 1;
    const email = ADMIN_EMAILS[(info.workerIndex * 5 + adminTurn) % ADMIN_EMAILS.length];
    await visitor.api().signIn(email);
    await visitor.toBrowser();
    await use({ email });
  },

  prebooked: async ({ visitor, searched }, use) => {
    const api = visitor.api();
    const row = searched.view.shortlist.find((r) => r.offer);
    if (!row?.offer) throw new Error('no bookable card in the canonical search');
    // The re-check is a prebook: no booking, safe to ask again while the sandbox is busy.
    const { bookingId } = await json(await api.patient(() => api.checkout(searched.sessionId, { offerId: row.offer!.id })), S.bookingIdBody);
    const page = await json(await api.booking(bookingId), S.bookingPageBody);
    await visitor.toBrowser();
    await use({ sessionId: searched.sessionId, bookingId, view: searched.view, booking: page.booking });
  },

  booked: async ({ visitor, prebooked }, use) => {
    const api = visitor.api();
    const email = uniqueEmail('booker');
    const code = await api.sendCode(email);
    const res = await api.confirm(prebooked.bookingId, { email, code, firstName: 'Ana', lastName: 'Silva', wallet: 'google_pay', acceptedTotalMinor: prebooked.booking.totalMinor });
    const { booking } = await json(res, S.bookingBody);
    await visitor.toBrowser();
    await use({ sessionId: prebooked.sessionId, bookingId: prebooked.bookingId, email, booking });
    // Sandbox bookings never outlive the test.
    const now = await visitor.api().booking(prebooked.bookingId);
    if (now.ok() && (await now.json()).booking.status === 'confirmed') await visitor.api().cancel(prebooked.bookingId);
  },
});
