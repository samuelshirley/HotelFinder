import { expect, openSession, test } from '../fixtures/test';
import { Calendar, type AppPage } from '../pages/app';
import { json } from '../support/api';
import { addDays, canonicalDates, todayLocal } from '../support/dates';
import * as S from '../support/schemas';

/** The nights card in the chat: the bubble holding both the calendar and "Use these nights". */
const nightsCard = (app: AppPage) =>
  app.chat.region().locator('div').filter({ has: app.page.getByRole('button', { name: 'Use these nights' }) }).filter({ has: app.page.getByRole('grid') }).last();

/**
 * The questions in the chat (docs/onboarding.md, docs/entry-ux.md §3.4): asked
 * only when the first screen left something open. With no model in this run,
 * words are read as a place only; anything else is asked.
 */
test.describe('questions in the chat', { tag: '@ui' }, () => {
  test('a place with several matches is asked as "Which …?", one chip each', async ({ page, app }) => {
    await app.goto();
    await app.trip.box().fill('Lisbon');
    await app.trip.box().press('Enter');
    const question = app.chat.region().getByText('Which Lisbon?', { exact: true });
    await expect(question).toBeVisible({ timeout: 60_000 });
    // Each choice says where it is.
    const chips = app.chat.region().getByRole('button', { name: /^Lisbon · / });
    expect(await chips.count()).toBeGreaterThan(1);
    await expect(app.chat.input()).toHaveAttribute('placeholder', 'Type a city or neighbourhood');
    await app.chat.region().getByRole('button', { name: 'Lisbon · Portugal', exact: true }).click();
    // Nothing about when in the words: tonight, and the first search runs.
    await app.results.waitForCards();
    await expect(app.results.heading()).toHaveText('Lisbon, Portugal');
    // The pick is echoed as the user's answer.
    await expect(app.chat.region().locator('p', { hasText: /^Lisbon, Portugal$/ })).toBeVisible();
  });

  test('words that name no place are asked "Where are you going?", with a place search', async ({ page, app }) => {
    await app.goto();
    await app.trip.box().fill('somewhere nice and quiet');
    await app.trip.box().press('Enter');
    await expect(app.chat.region().getByText('Where are you going?', { exact: true })).toBeVisible({ timeout: 60_000 });
    const input = app.chat.region().getByLabel('Destination', { exact: true });
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('placeholder', 'Porto, Shibuya, Trastevere…');
    await input.fill('qqzxqqzxqq');
    await expect(app.chat.region().getByText('No place by that name.', { exact: true })).toBeVisible();
    await input.fill('porto');
    await app.chat.region().getByRole('button', { name: 'Porto, Portugal', exact: true }).click();
    await app.results.waitForCards();
  });

  test('words about when, with no two dates, ask for the nights; "Use these nights" runs the search', async ({ page, app }) => {
    await app.goto();
    await app.trip.pickPorto();
    await app.trip.box().fill('3 nights in March');
    await app.trip.box().press('Enter');
    await expect(app.chat.region().getByText(/^Which (3 )?nights/)).toBeVisible({ timeout: 60_000 });
    await expect(app.chat.input()).toHaveAttribute('placeholder', 'Or type it: the second weekend');
    // One month in the chat card.
    const card = nightsCard(app);
    await expect(card.getByRole('grid')).toHaveCount(1);
    const checkIn = addDays(todayLocal(), 20);
    await new Calendar(card).pick(checkIn, addDays(checkIn, 3));
    await card.getByRole('button', { name: 'Use these nights' }).click();
    await app.results.waitForCards();
    await expect(app.results.card(0).perNightLine()).toHaveText(/^total for 3 nights · /);
  });

  test('a read-back of the first message says only what the words said', async ({ app }) => {
    await app.goto();
    await app.trip.pickPorto();
    // No party in these words: "2 adults" is the default, not something read from the message.
    await app.trip.box().fill('3 nights in March');
    await app.trip.box().press('Enter');
    await expect(app.chat.region().getByText(/^Which (3 )?nights/)).toBeVisible({ timeout: 60_000 });
    await expect(app.chat.region().getByText('Searching Porto, Portugal.', { exact: true })).toBeVisible();
    await expect(app.chat.region().getByText(/^From your message: .*2 adults/)).toHaveCount(0);
  });

  test('a search started before the first screen asks each question in turn: place, nights, party, priorities', async ({ page, app, visitor }) => {
    // POST /api/session starts a search with the destination question asked: a search a visitor may still have open.
    const { sessionId } = await json(await visitor.api().newSession(), S.sessionIdBody);
    await visitor.toBrowser();
    await openSession(page, sessionId);
    const chat = app.chat.region();
    await expect(chat.getByText('Where are you going?', { exact: true })).toBeVisible();
    await expect(app.chat.heading()).toHaveText('New search');
    await chat.getByLabel('Destination', { exact: true }).fill('porto');
    await chat.getByRole('button', { name: 'Porto, Portugal', exact: true }).click();
    // The answer is echoed as the user's own bubble.
    await expect(chat.getByText('Porto, Portugal', { exact: true }).first()).toBeVisible();

    await expect(chat.getByText('Which nights?', { exact: true })).toBeVisible();
    const dates = nightsCard(app);
    const { checkIn, checkOut } = canonicalDates();
    await new Calendar(dates).pick(checkIn, checkOut);
    await dates.getByRole('button', { name: 'Use these nights' }).click();

    await expect(chat.getByText('Who is travelling?', { exact: true })).toBeVisible();
    await expect(app.chat.input()).toBeDisabled();
    await expect(app.chat.input()).toHaveAttribute('placeholder', 'Answer above to continue');
    await expect(chat.getByRole('button', { name: 'Fewer adults' })).toBeEnabled();
    await chat.getByRole('button', { name: 'More adults' }).click();
    await chat.getByRole('button', { name: 'Fewer adults' }).click();
    await chat.getByRole('button', { name: 'More children' }).click();
    await expect(chat.getByLabel('Age of child 1')).toHaveValue('8');
    await chat.getByLabel('Age of child 1').selectOption('6');
    await chat.getByRole('button', { name: 'Fewer children' }).click();
    await chat.getByRole('button', { name: 'More rooms' }).click();
    await chat.getByRole('button', { name: 'Fewer rooms' }).click();
    await chat.getByLabel('Bringing a pet').check();
    await chat.getByLabel('Bringing a pet').uncheck();
    await chat.getByRole('button', { name: 'That is everyone' }).click();
    await expect(chat.getByText('2 adults', { exact: true })).toBeVisible();

    await expect(chat.getByText('What matters most? Pick any, or say it in your own words.', { exact: true })).toBeVisible();
    await expect(app.chat.input()).toHaveAttribute('placeholder', 'Or say it: near the old town, not too pricey');
    const group = chat.getByRole('group', { name: 'What matters most' });
    await expect(chat.getByRole('button', { name: 'Show hotels' })).toBeDisabled();
    await expect(group.getByRole('button', { name: 'Close to central Porto' })).toBeVisible();
    await group.getByRole('button', { name: 'Great reviews' }).click();
    await expect(group.getByRole('button', { name: 'Great reviews' })).toHaveAttribute('aria-pressed', 'true');
    await group.getByRole('button', { name: 'Great reviews' }).click();
    await group.getByRole('button', { name: 'Low price' }).click();
    await chat.getByRole('button', { name: 'Show hotels' }).click();
    await app.results.waitForCards();
    await expect(app.results.priorities()).toHaveText('Low price ✎');
  });

  test('"No preference" answers the priorities question in one tap', async ({ page, app, visitor }) => {
    const api = visitor.api();
    const { sessionId } = await json(await api.newSession(), S.sessionIdBody);
    const today = todayLocal();
    const porto = await api.porto();
    await json(await api.form(sessionId, { answer: { field: 'destination', ...porto }, today }), S.sessionView);
    await json(await api.form(sessionId, { answer: { field: 'dates', ...canonicalDates() }, today }), S.sessionView);
    await json(await api.form(sessionId, { answer: { field: 'guests', adults: 2, childrenAges: [], rooms: 1, pets: false }, today }), S.sessionView);
    await visitor.toBrowser();
    await openSession(page, sessionId);
    await app.chat.region().getByRole('button', { name: 'No preference' }).click();
    await app.results.waitForCards();
    await expect(app.results.priorities()).toHaveText('Balanced ✎');
    await expect(app.chat.region().getByText('No preference', { exact: true })).toBeVisible();
  });
});
