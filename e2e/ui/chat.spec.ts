import { expect, openSession, test } from '../fixtures/test';
import { json } from '../support/api';
import { COPY } from '../support/copy';
import * as S from '../support/schemas';

/**
 * The chat (docs/architecture.md §5): a typed message is one durable turn.
 * This run has no model and no Jev (playwright.config.ts), so what is checked
 * by default is the path the app takes without them: the message is kept, the
 * reply says plainly that nothing changed, and the turn is recorded. The
 * model's own answers are @ai and run only with E2E_AI=1.
 */
const NO_MODEL = 'That needs the assistant, and ANTHROPIC_API_KEY is not set on this server, so nothing was changed.';

test.describe('chat', { tag: '@ui' }, () => {
  test('Send is pressable only with words in the box', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    await expect(app.chat.input()).toHaveAttribute('placeholder', COPY.composerActive);
    await expect(app.chat.input()).toHaveAttribute('maxlength', '1000');
    await expect(app.chat.send()).toBeDisabled();
    await app.chat.input().fill('   ');
    await expect(app.chat.send()).toBeDisabled();
    await app.chat.input().fill('quiet room please');
    await expect(app.chat.send()).toBeEnabled();
  });

  test('a typed message shows at once, is answered, and is recorded as a turn', async ({ page, app, searched, visitor }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    const turn = page.waitForRequest((r) => r.url().endsWith('/turn'));
    await app.chat.say('quiet room please');
    const body = (await turn).postDataJSON();
    expect(body).toMatchObject({ message: 'quiet room please', today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    // The bubble is there before any answer, and the box is cleared for the next message.
    await expect(app.chat.region().getByText('quiet room please', { exact: true })).toBeVisible();
    await expect(app.chat.input()).toHaveValue('');
    await expect(app.chat.region().getByText(NO_MODEL)).toBeVisible({ timeout: 60_000 });
    // Nothing changed: the same shortlist.
    await expect(app.results.cards()).toHaveCount(searched.view.shortlist.length);
    await expect(app.chat.send()).toBeDisabled();
    await visitor.fromBrowser();
    const { turns } = await json(await visitor.api().turns(searched.sessionId), S.turnsBody);
    expect(turns).toEqual([expect.objectContaining({ idempotencyKey: body.idempotencyKey, status: 'done', errorCode: null })]);
  });

  test('Enter sends the message', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    await app.chat.input().fill('near the river');
    const turn = page.waitForRequest((r) => r.url().endsWith('/turn'));
    await app.chat.input().press('Enter');
    expect((await turn).postDataJSON().message).toBe('near the river');
  });

  test('while a message is being read, the chat says so and nothing else can be sent', async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route(/\/turn$/, async (route) => {
      await held;
      await route.fallback();
    });
    await app.chat.say('quiet room please');
    await expect(app.chat.region().getByRole('status').filter({ hasText: 'Reading…' })).toBeVisible();
    await app.chat.input().fill('another');
    await expect(app.chat.send()).toBeDisabled();
    release();
    await expect(app.chat.region().getByText(NO_MODEL)).toBeVisible({ timeout: 60_000 });
    await expect(app.chat.send()).toBeEnabled();
  });

  test('a capped price, asked in words, is applied by the assistant', { tag: '@ai' }, async ({ page, app, searched }) => {
    await openSession(page, searched.sessionId);
    await app.results.waitForCards();
    await app.chat.say('under 120 a night');
    await expect(app.chat.region().getByText(/Capped at €120 a night\. (\d+ of \d+ hotels fit\.|No hotel)/)).toBeVisible({ timeout: 90_000 });
    await expect(app.results.region().getByText('Up to €120 a night', { exact: true })).toBeVisible();
  });
});
