import { expect, openSession, test } from '../fixtures/test';
import { SignInModal } from '../pages/app';
import { CheckoutPage } from '../pages/checkout';
import { uniqueEmail } from '../support/env';
import { COPY, ERROR_COPY, withRef, type ErrorCode } from '../support/copy';

/**
 * What the page says when the server says no (src/lib/errors.ts: "every
 * error code the server can send, with the sentence the user sees"). The
 * server's answer is replaced at the network so each code can be shown on
 * demand: the copy, a 500's reference, a platform error page with no JSON,
 * and no connection at all.
 */
const BRIEF = /\/api\/session\/brief$/;
const SHOWN_BY_THE_FIRST_SCREEN: ErrorCode[] = ['empty_brief', 'dates_in_past', 'checkout_not_after_checkin', 'stay_too_long', 'more_rooms_than_adults', 'bad_date', 'rate_limited', 'invalid_request'];

test.describe('error copy', { tag: '@ui' }, () => {
  for (const code of SHOWN_BY_THE_FIRST_SCREEN) {
    test(`the first screen shows "${code}" as its sentence`, async ({ page, app, diagnostics }) => {
      diagnostics.allow(BRIEF, [400, 429], 'the answer is replaced on purpose');
      await page.route(BRIEF, (r) => r.fulfill({ status: code === 'rate_limited' ? 429 : 400, json: { error: code } }));
      await app.goto();
      await app.trip.pickPorto();
      await app.trip.find().click();
      await expect(app.chat.alert()).toHaveText(ERROR_COPY[code]);
      await expect(page).toHaveOnlyErrorCopy();
      // Nothing was started: the first screen is back, ready to try again.
      await expect(app.trip.find()).toBeEnabled();
    });
  }

  test('a 500 shows its reference, so a report can be matched to its log line', async ({ page, app, diagnostics }) => {
    diagnostics.allow(BRIEF, 500, 'the answer is replaced on purpose');
    await page.route(BRIEF, (r) => r.fulfill({ status: 500, json: { error: 'server_error', ref: '1a2b3c4d' } }));
    await app.goto();
    await app.trip.pickPorto();
    await app.trip.find().click();
    await expect(app.chat.alert()).toHaveText(withRef(ERROR_COPY.server_error, '1a2b3c4d'));
  });

  test('a platform error page with no JSON names its status as the reference', async ({ page, app, diagnostics }) => {
    diagnostics.allow(BRIEF, 504, 'the answer is replaced on purpose');
    await page.route(BRIEF, (r) => r.fulfill({ status: 504, contentType: 'text/html', body: '<html>An error occurred</html>' }));
    await app.goto();
    await app.trip.pickPorto();
    await app.trip.find().click();
    await expect(app.chat.alert()).toHaveText(withRef(ERROR_COPY.server_error, 'http-504'));
  });

  test('no connection: the network sentence', async ({ page, app, diagnostics }) => {
    diagnostics.allow(BRIEF, undefined, 'the request is dropped on purpose');
    await page.route(BRIEF, (r) => r.abort('internetdisconnected'));
    await app.goto();
    await app.trip.pickPorto();
    await app.trip.find().click();
    await expect(app.chat.alert()).toHaveText(ERROR_COPY.network);
  });

  test('an unknown code falls back to the server_error sentence', async ({ page, app, diagnostics }) => {
    diagnostics.allow(BRIEF, 400, 'the answer is replaced on purpose');
    await page.route(BRIEF, (r) => r.fulfill({ status: 400, json: { error: 'something_new' } }));
    await app.goto();
    await app.trip.pickPorto();
    await app.trip.find().click();
    await expect(app.chat.alert()).toHaveText(ERROR_COPY.server_error);
  });

  test('the place search not answering says so under the box, and typing on retries', async ({ page, app, diagnostics }) => {
    diagnostics.allow(/\/api\/places\?/, 503, 'the place search is made to fail');
    let fail = true;
    await page.route(/\/api\/places\?/, (r) => (fail ? r.fulfill({ status: 503, json: { error: 'supplier_unavailable' } }) : r.fallback()));
    await app.goto();
    await app.trip.box().fill('porto');
    await expect(page.getByText(COPY.placeLookupFailed)).toBeVisible();
    fail = false;
    await app.trip.box().fill('porto ');
    await expect(app.trip.suggestion('Porto', 'Portugal')).toBeVisible();
    await expect(page.getByText(COPY.placeLookupFailed)).toHaveCount(0);
  });

  test('a header edit refused by the server says why in the chat column', async ({ page, app, searched, diagnostics }) => {
    diagnostics.allow(/\/edit$/, [400, 409, 503], 'the answer is replaced on purpose');
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    for (const [code, status] of [['place_unavailable', 503], ['near_too_far', 400], ['not_active', 409], ['unknown_country', 400]] as const) {
      await page.route(/\/edit$/, (r) => r.fulfill({ status, json: { error: code } }), { times: 1 });
      await app.results.priorities().click();
      await app.results.prioritiesGroup().getByRole('button', { name: 'Low price' }).click();
      await app.results.prioritiesGroup().getByRole('button', { name: 'Apply' }).click();
      await expect(app.chat.alert()).toHaveText(ERROR_COPY[code]);
      // The search is as it was.
      await expect(app.results.priorities()).toHaveText('Balanced ✎');
    }
  });

  test('Book refused (the room is gone): the copy, and Book can be pressed again', async ({ page, app, searched, diagnostics }) => {
    diagnostics.allow(/\/checkout$/, [404, 409, 503], 'the answer is replaced on purpose');
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    let signedIn = false;
    for (const [code, status] of [['rate_gone', 409], ['supplier_unavailable', 503], ['property_not_found', 404]] as const) {
      await page.route(/\/checkout$/, (r) => r.fulfill({ status, json: { error: code } }), { times: 1 });
      await app.results.card(0).book().click();
      // Signed out, Book asks who is booking first; the check (refused here) follows the sign-in.
      if (!signedIn) await new SignInModal(page, COPY.signIn.titleBook).signIn(uniqueEmail('refused'));
      signedIn = true;
      await expect(app.chat.alert()).toHaveText(ERROR_COPY[code]);
      await expect(app.results.card(0).book()).toBeEnabled();
      await expect(page).toHaveURL(/\/hotels\/?(\?.*)?$/);
    }
  });

  test('the chat paused by its breaker says so, and the filters still work', async ({ page, app, searched, diagnostics }) => {
    diagnostics.allow(/\/turn$/, 503, 'the answer is replaced on purpose');
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    await page.route(/\/turn$/, (r) => r.fulfill({ status: 503, json: { error: 'circuit_open' } }));
    await app.chat.say('quiet please');
    await expect(app.chat.alert()).toHaveText(ERROR_COPY.circuit_open);
    await expect(app.chat.send()).toBeDisabled();
    await expect(app.results.priorities()).toBeEnabled();
  });

  test('an error row in the chat is said with its copy', async ({ page, app, searched }) => {
    await page.route(new RegExp(`/api/session/${searched.sessionId}$`), async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      const at = new Date().toISOString();
      body.messages.push({ id: '00000000-0000-4000-8000-000000000001', role: 'assistant', kind: 'error', content: '', meta: { code: 'turn_timeout' }, createdAt: at });
      await route.fulfill({ response: res, json: body });
    });
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    await expect(app.chat.region().getByText(ERROR_COPY.turn_timeout, { exact: true })).toBeVisible();
  });

  test('a stored search that is gone opens the first screen, not an error', async ({ page, app, diagnostics }) => {
    diagnostics.allow(/\/api\/session\/[0-9a-f-]{36}$/, 404, 'the stored search no longer exists');
    await openSession(page, '00000000-0000-4000-8000-000000000000');
    await expect(app.trip.box()).toBeVisible();
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({ hasText: /\S/ })).toHaveCount(0);
  });

  test('a checkout link that is not this visitor\'s says so', async ({ page, diagnostics }) => {
    diagnostics.allow(/\/api\/booking\/[0-9a-f-]{36}$/, 404, 'no such booking');
    const co = new CheckoutPage(page);
    await co.goto('00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveText(ERROR_COPY.booking_not_found);
    await expect(co.back()).toBeVisible();
  });
});
