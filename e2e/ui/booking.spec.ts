import type { Page } from '@playwright/test';

import { expect, openSession, test } from '../fixtures/test';
import { CheckoutPage } from '../pages/checkout';
import { json } from '../support/api';
import { COPY, ERROR_COPY } from '../support/copy';
import { uniqueEmail } from '../support/env';
import { MONEY, minor } from '../support/money';
import * as S from '../support/schemas';

/**
 * Booking against the LiteAPI SANDBOX (docs/architecture.md §10, step 12 of
 * docs/build-log.md): Book re-checks the price, the checkout signs in with an
 * email code (shown on the page: no email service in e2e), the Apple Pay and
 * Google Pay sheets are TEST stand-ins, the sandbox makes a real test booking,
 * and every booking is cancelled before the test ends. States the sandbox
 * cannot be made to produce on demand (a stale or changed price, a failed or
 * pending booking) are shown by answering the page's own GET with that state.
 */
const fmtDay = (iso: string, month: boolean) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', ...(month ? { month: 'short' } : {}), timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/** The page's GET of this booking, answered with the real answer changed by `patch`. */
async function patchBooking(page: Page, patch: (b: S.BookingViewBody) => Partial<S.BookingViewBody>, top: Record<string, unknown> = {}) {
  await page.route(/\/api\/booking\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    try {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, ...top, booking: { ...body.booking, ...patch(body.booking) } } });
    } catch {
      // The page moved on (a re-check navigates away) while this answer was in flight: nothing left to answer.
    }
  });
}

test.describe('checkout', { tag: ['@ui', '@booking'] }, () => {
  test('Book re-checks the price and opens the checkout for that hotel', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId, '?detail=slideout');
    await app.results.waitForCards();
    const card = app.results.card(0);
    const hotel = await card.name();
    const cardTotal = (await card.total().textContent())!.trim();
    await card.book().click();
    // While the hotel re-checks: the button says so, and no other Book can be pressed.
    await expect(card.root.getByRole('button', { name: 'Checking the price…' }).or(page.getByRole('region', { name: 'Your stay' }))).toBeVisible();
    await expect(page).toHaveURL(/\/hotels\/book\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    const co = new CheckoutPage(page);
    await expect(co.stay().getByRole('heading', { name: hotel })).toBeVisible();
    await expect(co.total()).toHaveText(MONEY);
    // Re-checked: the same price, or both prices shown (architecture §14.8).
    const changed = co.stay().getByRole('status').filter({ hasText: /^The price changed: it was / });
    if ((await changed.count()) === 0) {
      await expect(co.total()).toHaveText(cardTotal);
      await expect(co.stay()).toContainText(COPY.checkout.recheck);
    } else await expect(changed).toContainText(`it was ${cardTotal} on the shortlist`);
  });

  test('the checkout says what is booked, for how much, and how it is paid', { tag: '@content' }, async ({ page, prebooked, api }) => {
    const co = new CheckoutPage(page);
    await co.goto(prebooked.bookingId);
    const b = prebooked.booking;
    await expect(page).toHaveTitle(COPY.title);
    await expect(co.back()).toHaveAttribute('href', '/hotels');
    await expect(page.getByText(COPY.brand, { exact: true })).toBeVisible();
    await expect(co.stay().getByRole('heading', { level: 2 })).toHaveText(b.hotelName!);
    const sameMonth = b.checkIn!.slice(0, 7) === b.checkOut!.slice(0, 7);
    await expect(co.stay()).toContainText(`${fmtDay(b.checkIn!, !sameMonth)} – ${fmtDay(b.checkOut!, true)} · 2 nights · 2 adults`);
    await expect(co.stay()).toContainText([b.roomName, b.boardName ?? 'Room only'].filter(Boolean).join(' · '));
    expect(minor((await co.total().textContent())!)).toBe(b.totalMinor);
    // Paid now, before paying; what the hotel charges on top, each charge as the supplier names it.
    await expect(co.dd('Pay now, taxes in')).toHaveText(MONEY);
    const charges = b.payAtPropertyFees ?? [];
    if (charges.length === 0) await expect(co.dd('Pay at the hotel')).toHaveText(b.payAtPropertyMinor > 0 && b.payAtPropertyFees === null ? MONEY : 'Nothing listed');
    else {
      const group = co.stay().getByRole('group', { name: 'Pay at the hotel' });
      await expect(group.locator('dt')).toHaveText('Pay at the hotel, not in the total');
      await expect(group.getByRole('listitem')).toHaveCount(charges.length);
      for (const [i, c] of charges.entries()) {
        await expect(group.getByRole('listitem').nth(i)).toContainText(c.description);
        expect(minor((await group.getByRole('listitem').nth(i).locator('span').last().textContent())!)).toBe(c.amountMinor);
      }
      // The named charges add up to what the card said is paid at the hotel.
      if (charges.every((c) => c.currency === b.currency)) expect(charges.reduce((n, c) => n + c.amountMinor, 0)).toBe(b.payAtPropertyMinor);
    }
    await expect(co.dd('Cancellation')).toHaveText(/^(Non-refundable|Not given by the hotel|Refundable; the hotel did not give the deadline|Free until \d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2} UTC)$/);
    await expect(co.form().getByRole('heading', { level: 1 })).toHaveText('Book it');
    await expect(co.email()).toHaveAttribute('type', 'email');
    await expect(page.getByText(COPY.checkout.emailLabel)).toBeVisible();
    await expect(co.sendCode()).toHaveText('Send code');
    await expect(co.sendCode()).toBeDisabled();
    await expect(co.code()).toHaveAttribute('maxlength', '6');
    await expect(page.getByText(COPY.checkout.testBadge)).toBeVisible();
    const total = (await co.total().textContent())!.trim();
    await expect(co.pay('Apple Pay')).toHaveText(`Pay · ${total}`);
    await expect(co.pay('Google Pay')).toHaveText(`Pay · ${total}`);
    await expect(page.getByText(COPY.checkout.onePressSignedOut)).toBeVisible();
    await expect(page).toHaveLoadedImages();
    await expect(page).toHaveWorkingLinks(api.request);
  });

  test('the wallet does not open until email, code and names are there; each gap is named', async ({ page, prebooked }) => {
    const co = new CheckoutPage(page);
    await co.goto(prebooked.bookingId);
    await co.pay('Apple Pay').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(ERROR_COPY.email_invalid)).toBeVisible();
    await expect(co.email()).toHaveAttribute('aria-invalid', 'true');
    await co.email().fill('ana@example');
    await co.pay('Google Pay').click();
    await expect(page.getByText(ERROR_COPY.email_invalid)).toBeVisible();
    await co.email().fill(uniqueEmail('gaps'));
    await co.pay('Apple Pay').click();
    await expect(page.getByText(COPY.checkout.sendFirst)).toBeVisible();
    await expect(co.code()).toHaveAttribute('aria-invalid', 'true');
    await co.sendCode().click();
    await co.readCode();
    await expect(co.sendCode()).toHaveText('Send a new code');
    await co.code().fill('12a3');
    await expect(co.code()).toHaveValue('123');
    await co.pay('Apple Pay').click();
    await expect(page.getByText(ERROR_COPY.code_wrong)).toBeVisible();
    await co.code().fill('123456');
    await co.pay('Apple Pay').click();
    await expect(page.getByText(ERROR_COPY.name_missing)).toBeVisible();
    await co.first().fill('Ana');
    await co.pay('Apple Pay').click();
    await expect(page.getByText(ERROR_COPY.name_missing)).toBeVisible();
    await co.last().fill('Silva');
    await co.pay('Apple Pay').click();
    await expect(co.sheet('Apple Pay')).toBeVisible();
    // Esc and Cancel close the sheet; nothing is paid.
    await page.keyboard.press('Escape');
    await expect(co.sheet('Apple Pay')).toHaveCount(0);
    await co.pay('Google Pay').click();
    await expect(co.sheet('Google Pay')).toBeVisible();
    await co.cancelIn('Google Pay').click();
    await expect(co.sheet('Google Pay')).toHaveCount(0);
    const now = await page.request.get(`./api/booking/${prebooked.bookingId}`);
    expect((await now.json()).booking.status).toBe('prebooked');
  });

  test('a wrong code: the sheet opens, nothing is paid, and the code field says why', async ({ page, prebooked, diagnostics }) => {
    diagnostics.allow(/\/api\/booking\/[^/]+\/confirm$/, 400, 'a wrong code is refused');
    const co = new CheckoutPage(page);
    await co.goto(prebooked.bookingId);
    await co.email().fill(uniqueEmail('wrong'));
    await co.sendCode().click();
    const code = await co.readCode();
    await co.first().fill('Ana');
    await co.last().fill('Silva');
    await co.code().fill(code === '000000' ? '111111' : '000000');
    await co.pay('Apple Pay').click();
    const total = (await co.total().textContent())!.trim();
    await expect(co.sheet('Apple Pay')).toContainText(COPY.checkout.sheetTest);
    await expect(co.sheet('Apple Pay')).toContainText(COPY.checkout.testCard);
    await expect(co.sheet('Apple Pay')).toContainText(`Hotel finder · ${prebooked.booking.hotelName}`);
    await expect(co.sheet('Apple Pay')).toContainText(total);
    await expect(co.confirmIn('Apple Pay')).toBeFocused();
    await co.confirmIn('Apple Pay').click();
    await expect(co.sheet('Apple Pay')).toBeHidden();
    await expect(page.getByText(ERROR_COPY.code_wrong)).toBeVisible();
    await expect(co.heading()).toHaveText('Book it');
  });

  test('sign in first: email, code, Sign in, and the checkout is signed in with the names kept', async ({ page, prebooked }) => {
    // Sam, 2026-11-13: sign in on the payment screen with an email and a 6-digit code; the page refreshes signed in.
    const co = new CheckoutPage(page);
    await co.goto(prebooked.bookingId);
    const signIn = co.form().getByRole('button', { name: 'Sign in', exact: true });
    await expect(signIn).toBeDisabled();
    const email = uniqueEmail('first');
    await co.email().fill(email);
    await co.first().fill('Ana');
    await co.sendCode().click();
    const code = await co.readCode();
    await co.code().fill(code);
    await signIn.click();
    await expect(co.form().getByText(`Signed in as ${email.toLowerCase()}`)).toBeVisible();
    await expect(co.email()).toHaveCount(0);
    await expect(co.code()).toHaveCount(0);
    await expect(co.first()).toHaveValue('Ana');
    await expect(co.pay('Apple Pay')).toBeEnabled();
  });

  test('book with Apple Pay (test), keep it once, then cancel it', async ({ page, app, prebooked }) => {
    test.setTimeout(240_000);
    // As a person gets here: the search open in this browser, then its checkout.
    await openSession(page, prebooked.sessionId);
    await app.results.waitForCards();
    const co = new CheckoutPage(page);
    await co.goto(prebooked.bookingId);
    const email = uniqueEmail('apple');
    await co.email().fill(email);
    await co.sendCode().click();
    const code = await co.readCode();
    await co.code().fill(code);
    await co.first().fill('Ana');
    await co.last().fill('Silva');
    const total = (await co.total().textContent())!.trim();
    await co.pay('Apple Pay').click();
    await co.confirmIn('Apple Pay').click();
    await expect(co.heading()).toHaveText('Booked', { timeout: 90_000 });
    const receipt = co.receipt();
    const reference = (await co.dd('Booking reference').textContent())!.trim();
    expect(reference.length).toBeGreaterThan(3);
    await expect(co.dd('Guest')).toHaveText(`Ana Silva · ${email}`);
    await expect(co.dd('Paid')).toHaveText(`${total} with Apple Pay (test payment: no money moved)`);

    // Back to the shortlist: the chat says it, and the account and the booking are in the sidebar.
    await co.backLink().click();
    await expect(app.chat.region().getByText(new RegExp(`^Booked: ${prebooked.booking.hotelName!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, .+\\. Reference ${reference}\\.$`))).toBeVisible({ timeout: 30_000 });
    await expect(app.sidebar.nav().getByText(`Signed in as ${email}`)).toBeVisible();
    await expect(app.sidebar.nav().getByRole('heading', { name: 'Your bookings' })).toBeVisible();
    const link = app.sidebar.bookings().filter({ hasText: prebooked.booking.hotelName! });
    await expect(link).toHaveAttribute('href', `/hotels/book/${prebooked.bookingId}`);
    // Signed in, the public-prices note is gone.
    await expect(app.results.publicNote()).toHaveCount(0);
    await link.click();
    await expect(co.heading()).toHaveText('Booked');

    await co.cancelBooking().click();
    await expect(page.getByRole('group', { name: 'Cancel this booking?' })).toContainText(/^Cancel this booking\? (It is non-refundable: the hotel keeps the full .+\.|It is free until .+ UTC\.|The hotel decides any fee; the refund is shown after\.)/);
    await co.keepIt().click();
    await expect(co.heading()).toHaveText('Booked');
    await expect(co.cancelBooking()).toBeVisible();
    await co.cancelBooking().click();
    await co.yesCancel().click();
    await expect(co.heading()).toHaveText('Cancelled', { timeout: 60_000 });
    await expect(co.dd('Booking reference')).toHaveText(reference);
    await expect(co.dd('Refund')).toHaveText(/(As the hotel decides|[€£$]).* · test payment, nothing to refund$/);
    await expect(receipt.getByRole('button', { name: 'Cancel this booking' })).toHaveCount(0);
    // The sidebar keeps it, marked cancelled.
    await co.backLink().click();
    await expect(app.sidebar.bookings().filter({ hasText: prebooked.booking.hotelName! })).toContainText('· cancelled');
  });

  test('signed in: no email and no code, the names remembered, Google Pay', async ({ page, visitor, signedIn }) => {
    test.setTimeout(240_000);
    // Sign in first, then book: the account is this browser's.
    const api = visitor.api();
    const { sessionId, view } = await api.search();
    const row = view.shortlist.find((r) => r.offer)!;
    const first = await json(await api.patient(() => api.checkout(sessionId, { offerId: row.offer!.id })), S.bookingIdBody);
    const b1 = (await json(await api.booking(first.bookingId), S.bookingPageBody)).booking;
    await json(await api.confirm(first.bookingId, { email: signedIn.email, code: '', firstName: 'Ana', lastName: 'Silva', wallet: 'apple_pay', acceptedTotalMinor: b1.totalMinor }), S.bookingBody);
    await json(await api.cancel(first.bookingId), S.bookingBody);
    const second = await json(await api.patient(() => api.checkout(sessionId, { offerId: view.shortlist.filter((r) => r.offer)[1]?.offer!.id ?? row.offer!.id })), S.bookingIdBody);
    await visitor.toBrowser();

    const co = new CheckoutPage(page);
    await co.goto(second.bookingId);
    await expect(co.form()).toContainText(`Signed in as ${signedIn.email} · Not you?`);
    await expect(co.code()).toHaveCount(0);
    await expect(co.email()).toHaveCount(0);
    await expect(co.first()).toHaveValue('Ana');
    await expect(co.last()).toHaveValue('Silva');
    await expect(page.getByText(COPY.checkout.onePressSignedIn)).toBeVisible();
    const total = (await co.total().textContent())!.trim();
    await co.pay('Google Pay').click();
    await co.confirmIn('Google Pay').click();
    await expect(co.heading()).toHaveText('Booked', { timeout: 90_000 });
    await expect(co.dd('Paid')).toHaveText(`${total} with Google Pay (test payment: no money moved)`);
    await co.cancelBooking().click();
    await co.yesCancel().click();
    await expect(co.heading()).toHaveText('Cancelled', { timeout: 60_000 });
  });

  test('Not you? signs out, and the checkout asks for an email instead', async ({ page, visitor, signedIn }) => {
    const api = visitor.api();
    const { sessionId, view } = await api.search();
    const { bookingId } = await json(await api.patient(() => api.checkout(sessionId, { offerId: view.shortlist.find((r) => r.offer)!.offer!.id })), S.bookingIdBody);
    await visitor.toBrowser();
    const co = new CheckoutPage(page);
    await co.goto(bookingId);
    await expect(co.form()).toContainText(`Signed in as ${signedIn.email}`);
    await co.notYou().click();
    // Someone else at this browser books it with their own email: the same stay, the sign-in form.
    await expect(co.email()).toBeVisible();
    await expect(co.form()).not.toContainText('Signed in as');
    await expect(co.stay().getByRole('heading', { level: 2 })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
  });

  test('sign out from the sidebar: the account line and the bookings go', async ({ page, app, signedIn, searched }) => {
    await openSession(page, searched.sessionId);
    await expect(app.sidebar.nav().getByText(`Signed in as ${signedIn.email}`)).toBeVisible();
    await app.sidebar.signOut().click();
    await expect(app.trip.box()).toBeVisible();
    await expect(app.sidebar.nav().getByText(/Signed in as/)).toHaveCount(0);
    await expect(app.sidebar.nav().getByText('Your bookings')).toHaveCount(0);
  });

  test('a price check older than 20 minutes: the wallets wait, and "Check the price again" re-checks', async ({ page, prebooked }) => {
    await patchBooking(page, () => ({ priceCheckStale: true }));
    const co = new CheckoutPage(page);
    await co.goto(prebooked.bookingId);
    await expect(page.getByText(COPY.checkout.stale)).toBeVisible();
    await expect(co.pay('Apple Pay')).toBeDisabled();
    await expect(co.pay('Google Pay')).toBeDisabled();
    const recheck = page.waitForRequest((r) => r.url().endsWith(`/api/session/${prebooked.sessionId}/checkout`));
    await page.getByRole('button', { name: 'Check the price again' }).click();
    expect((await recheck).postDataJSON()).toEqual({ offerId: prebooked.booking.offerId });
    await expect(page).not.toHaveURL(new RegExp(prebooked.bookingId), { timeout: 60_000 });
    await expect(page).toHaveURL(/\/hotels\/book\/[0-9a-f-]{36}$/);
  });

  test('a changed price is shown with both numbers before paying', async ({ page, prebooked }) => {
    const before = prebooked.booking.totalMinor - 1234;
    await patchBooking(page, () => ({ priceChanged: true, quotedTotalMinor: before }));
    const co = new CheckoutPage(page);
    await co.goto(prebooked.bookingId);
    const total = (await co.total().textContent())!.trim();
    const status = co.stay().getByRole('status');
    await expect(status).toHaveText(new RegExp(`^The price changed: it was \\S+ on the shortlist, it is ${total.replace(/[.$]/g, '\\$&')} now\\. Paying below means paying ${total.replace(/[.$]/g, '\\$&')}\\.$`));
    expect(minor((await status.textContent())!.match(/it was (\S+) on/)![1])).toBe(before);
    await expect(page.getByText(COPY.checkout.recheck)).toHaveCount(0);
  });

  test('no payment method set up: the page says so instead of wallets', async ({ page, prebooked }) => {
    await patchBooking(page, () => ({}), { payment: 'none' });
    const co = new CheckoutPage(page);
    await co.goto(prebooked.bookingId);
    await expect(page.getByText(ERROR_COPY.payment_unavailable)).toBeVisible();
    await expect(co.pay('Apple Pay')).toHaveCount(0);
    await expect(co.pay('Google Pay')).toHaveCount(0);
  });

  test('a booking the hotel refused, and one it has not answered yet, each say what to do', async ({ page, prebooked }) => {
    await patchBooking(page, () => ({ status: 'failed', failureCode: 'booking_failed' }));
    const co = new CheckoutPage(page);
    await co.goto(prebooked.bookingId);
    await expect(co.heading()).toHaveText('Not booked');
    await expect(co.receipt()).toContainText(ERROR_COPY.booking_failed);
    await page.unrouteAll({ behavior: 'wait' });

    await patchBooking(page, () => ({ status: 'booking' }));
    await co.goto(prebooked.bookingId);
    await expect(co.heading()).toHaveText('Waiting for the hotel');
    await expect(co.receipt()).toContainText(ERROR_COPY.booking_unknown);
    const again = page.waitForRequest((r) => r.url().endsWith(`/api/booking/${prebooked.bookingId}`) && r.method() === 'GET');
    await page.getByRole('button', { name: 'Check again' }).click();
    await again;
    await expect(page.getByRole('button', { name: 'Check again' })).toBeEnabled();
  });

  test('a cancellation the hotel does not confirm says to wait and reload', async ({ page, booked, diagnostics }) => {
    diagnostics.allow(/\/api\/booking\/[^/]+\/cancel$/, 502, 'the cancel call is made to fail on purpose');
    await page.route(/\/cancel$/, (r) => r.fulfill({ status: 502, json: { error: 'cancel_failed' } }));
    const co = new CheckoutPage(page);
    await co.goto(booked.bookingId);
    await co.cancelBooking().click();
    await co.yesCancel().click();
    await expect(co.receipt().getByRole('alert')).toHaveText(ERROR_COPY.cancel_failed);
    await expect(co.heading()).toHaveText('Booked');
  });

  test('a booking that is not this visitor\'s is not shown', async ({ page, browser, booked, diagnostics }) => {
    diagnostics.allow(/\/api\/booking\/[^/]+$/, 404, 'another visitor asks for it');
    const stranger = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const p = await stranger.newPage();
    await p.goto(`./book/${booked.bookingId}`);
    await expect(p.getByRole('alert').filter({ hasText: /\S/ })).toHaveText(ERROR_COPY.booking_not_found);
    await expect(p.getByText(booked.booking.hotelName!)).toHaveCount(0);
    await stranger.close();
    void page;
  });
});
