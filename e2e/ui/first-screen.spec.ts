import { expect, test } from '../fixtures/test';
import { COPY } from '../support/copy';
import { addDays, canonicalDates, dayLabel, monthName, nightsBetween, shortDay, todayLocal, weekend } from '../support/dates';
import { exampleBody } from '../support/schemas';
import { json } from '../support/api';
import { expectNotCovered } from '../pages/app';

/**
 * The first screen (docs/entry-ux.md §2): one box for the whole trip, three
 * pills, optional priorities, the example answer. Every control on it.
 */
test.describe('first screen', { tag: '@ui' }, () => {
  test('says what the app does, and nothing is searched yet', { tag: ['@smoke', '@content'] }, async ({ page, app, api }) => {
    await app.goto();
    await expect(page).toHaveTitle(COPY.title);
    await expect(page.getByRole('heading', { level: 1, name: COPY.h1 })).toBeVisible();
    await expect(page.getByText(COPY.sub, { exact: true })).toBeVisible();
    await expect(app.chat.heading()).toHaveText('New search');
    await expect(app.sidebar.nav().getByText(COPY.brand, { exact: true })).toBeVisible();
    await expect(app.sidebar.nav().getByRole('heading', { name: 'Your trips' })).toBeVisible();
    await expect(app.sidebar.nav().getByText(COPY.noTrips)).toBeVisible();
    await expect(app.sidebar.toggle()).toHaveAttribute('aria-expanded', 'true');
    // No search yet: no hotels panel, no chat composer.
    await expect(app.results.region()).toHaveCount(0);
    await expect(app.chat.input()).toHaveCount(0);

    // The box: focused, a cycling example as placeholder, 1000 characters at most.
    await expect(app.trip.box()).toBeFocused();
    await expect(app.trip.box()).toHaveAttribute('maxlength', '1000');
    expect(COPY.placeholders).toContain(await app.trip.box().getAttribute('placeholder'));
    await expect(app.trip.where()).toHaveText('Where: Add a place');
    await expect(app.trip.when()).toHaveText('When: Tonight · 1 night');
    await expect(app.trip.who()).toHaveText('Who: 2 adults');
    await expect(app.trip.find()).toHaveText('Find my hotel');
    await expect(app.trip.find()).toBeEnabled();
    for (const pill of [app.trip.where(), app.trip.when(), app.trip.who()]) await expect(pill).toHaveAttribute('aria-expanded', 'false');

    await expect(page.getByText(COPY.whatMatters, { exact: true })).toBeVisible();
    for (const p of COPY.priorities) await expect(app.trip.priority(p)).toHaveAttribute('aria-pressed', 'false');
    for (const line of COPY.trust) await expect(page.getByText(line, { exact: true })).toBeVisible();

    // The example answer is the recorded search the API serves, rendered as given.
    const example = await json(await api.example(), exampleBody);
    const region = app.trip.example();
    await expect(region).toContainText(example.caption);
    await expect(region.getByRole('heading', { level: 3 })).toHaveText(`1${example.name}`);
    await expect(region).toContainText(`${example.total} · ${example.nightsText}`);
    await expect(region).toContainText(example.facts);
    await expect(region).toContainText(example.reason);
    await expect(page).toHaveLoadedImages();
    await expect(page).toHaveWorkingLinks(api.request);
  });

  test('the placeholder cycles every 4 s, and holds while the box has focus', async ({ page, app }) => {
    await page.clock.install();
    await app.goto();
    const box = app.trip.box();
    await expect(box).toHaveAttribute('placeholder', COPY.placeholders[0]);
    // Focused (it is, on load): the example a person is reading does not change under them.
    await page.clock.runFor(4_500);
    await expect(box).toHaveAttribute('placeholder', COPY.placeholders[0]);
    await box.blur();
    await page.clock.runFor(4_100);
    await expect(box).toHaveAttribute('placeholder', COPY.placeholders[1]);
    await page.clock.runFor(4_000);
    await expect(box).toHaveAttribute('placeholder', COPY.placeholders[2]);
    await page.clock.runFor(4_000);
    await expect(box).toHaveAttribute('placeholder', COPY.placeholders[0]);
  });

  test('the placeholder stays put under reduced motion', async ({ page, app }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install();
    await app.goto();
    await app.trip.box().blur();
    await page.clock.runFor(12_500);
    await expect(app.trip.box()).toHaveAttribute('placeholder', COPY.placeholders[0]);
  });

  test('Find my hotel with nothing typed opens the place search instead of searching', async ({ page, app }) => {
    await app.goto();
    let briefs = 0;
    page.on('request', (r) => r.url().includes('/api/session/brief') && briefs++);
    await app.trip.find().click();
    await expect(page.getByRole('listbox', { name: 'Choose a place' })).toBeVisible();
    await expect(app.trip.placeInput()).toBeFocused();
    await expect(app.trip.where()).toHaveAttribute('aria-expanded', 'true');
    // Never an error toast (docs/entry-ux.md §2.2).
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
    // Enter on an empty box does the same.
    await app.trip.where().click();
    await app.trip.box().press('Enter');
    await expect(app.trip.placeInput()).toBeVisible();
    expect(briefs).toBe(0);
  });

  test('the Where pill searches places in its own box, and a pick fills the pill', async ({ page, app }) => {
    await app.goto();
    await app.trip.where().click();
    await expect(app.trip.where()).toHaveAttribute('aria-expanded', 'true');
    await expect(app.trip.placeInput()).toHaveAttribute('placeholder', 'City, neighbourhood, airport…');
    await app.trip.placeInput().fill('porto');
    const porto = app.trip.suggestion('Porto', 'Portugal');
    await expect(porto).toBeVisible();
    // Every row says where and what it is; a hotel is never a destination (docs/entry-ux.md §2.2).
    const rows = page.getByRole('listbox', { name: 'Choose a place' }).getByRole('button');
    for (const name of await rows.allTextContents()) {
      // "Porto" + "Portugal · City"; a place the supplier gives no address for shows its kind alone.
      expect(name).toMatch(/(City|Neighbourhood|Airport|Station|Region|Place)$/);
      expect(name).not.toMatch(/Hotel$/i);
    }
    // The box's sentence is left alone by a pick made in the Where pill.
    await porto.click();
    await expect(app.trip.where()).toHaveText('Where: Porto, Portugal');
    await expect(app.trip.where()).toHaveAttribute('aria-expanded', 'false');
    await expect(app.trip.box()).toHaveAttribute('placeholder', COPY.placeholderWithPlace);
    // Opening and closing the pill again changes nothing.
    await app.trip.where().click();
    await app.trip.where().click();
    await expect(app.trip.placeInput()).toHaveCount(0);
    await expect(app.trip.where()).toHaveText('Where: Porto, Portugal');
  });

  test('a bare place in the box suggests places; a pick fills Where and clears the box', async ({ page, app }) => {
    await app.goto();
    await app.trip.box().fill('porto');
    const suggestions = page.getByRole('listbox', { name: 'Suggestions' });
    await expect(suggestions).toBeVisible();
    // A bare place is not a sentence: no "Search for" row, no hint.
    await expect(app.trip.fullRow()).toHaveCount(0);
    await expect(page.getByText(COPY.orJustThePlace)).toHaveCount(0);
    await app.trip.suggestion('Porto', 'Portugal').click();
    await expect(app.trip.where()).toHaveText('Where: Porto, Portugal');
    await expect(app.trip.box()).toHaveValue('');
    await expect(suggestions).toHaveCount(0);
  });

  test('a sentence is offered as typed, or just its place', async ({ page, app }) => {
    await app.goto();
    await app.trip.box().fill('Porto with my wife, 3 nights in March');
    await expect(app.trip.fullRow()).toHaveText('Search for: “Porto with my wife, 3 nights in March”Enter');
    await expect(page.getByText(COPY.orJustThePlace, { exact: true })).toBeVisible();
    await expect(app.trip.suggestion('Porto', 'Portugal')).toBeVisible();
    await expect(page.getByText(COPY.sentenceHint, { exact: true })).toBeVisible();
    // "Or just the place": the sentence is set aside for the place alone.
    await app.trip.suggestion('Porto', 'Portugal').click();
    await expect(app.trip.where()).toHaveText('Where: Porto, Portugal');
    await expect(app.trip.box()).toHaveValue('');
    await expect(page.getByText(COPY.sentenceHint)).toHaveCount(0);
  });

  test('with a sentence typed, the What matters chips and their hint stay in reach', async ({ page, app }) => {
    await app.goto();
    await app.trip.box().fill('Porto with my wife, 3 nights in March');
    await expect(app.trip.fullRow()).toBeVisible();
    // The hint and the chips it points at can be read and pressed while the sentence row is open.
    await expectNotCovered(page.getByText(COPY.sentenceHint, { exact: true }));
    for (const p of COPY.priorities) await expectNotCovered(app.trip.priority(p));
    // Picking a priority answers "what matters" by hand: the hint goes; unpicking brings it back.
    await app.trip.priority('Great reviews').click({ timeout: 5_000 });
    await expect(app.trip.priority('Great reviews')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(COPY.sentenceHint)).toHaveCount(0);
    await app.trip.priority('Great reviews').click({ timeout: 5_000 });
    await expect(page.getByText(COPY.sentenceHint, { exact: true })).toBeVisible();
  });

  test('the "Search for" row submits the sentence as typed', async ({ page, app }) => {
    await app.goto();
    await app.trip.box().fill('Porto with my wife, 3 nights in March');
    const brief = page.waitForRequest((r) => r.url().includes('/api/session/brief'));
    await app.trip.fullRow().click();
    const body = (await brief).postDataJSON();
    expect(body.brief).toMatchObject({ text: 'Porto with my wife, 3 nights in March', place: null, dates: null, guests: null, priorities: [] });
    // The user's words appear at once as their bubble.
    await expect(app.chat.region().getByText('Porto with my wife, 3 nights in March', { exact: true })).toBeVisible();
  });

  test('Shift+Enter is a new line; Enter submits', async ({ page, app }) => {
    await app.goto();
    await app.trip.box().fill('Porto');
    await app.trip.box().press('Shift+Enter');
    await app.trip.box().pressSequentially('for two');
    await expect(app.trip.box()).toHaveValue('Porto\nfor two');
    const brief = page.waitForRequest((r) => r.url().includes('/api/session/brief'));
    await app.trip.box().press('Enter');
    expect((await brief).postDataJSON().brief.text).toBe('Porto\nfor two');
  });

  test('the When pill: tonight by default, the weekend chips, the calendar and Done', async ({ page, app }) => {
    await app.goto();
    const today = todayLocal();
    await app.trip.when().click();
    const card = app.trip.nights();
    await expect(card).toBeVisible();
    await expect(app.trip.when()).toHaveAttribute('aria-expanded', 'true');
    await expect(card.getByRole('grid')).toHaveCount(2);
    await expect(card.getByRole('grid').first()).toHaveAccessibleName(monthName(today));
    await expect(card.getByRole('button', { name: 'Tonight', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(card).toContainText(`${shortDay(today)} – ${shortDay(addDays(today, 1))} · 1 night`);
    // The past cannot be picked, and the calendar does not go back before this month.
    if (today.slice(8) !== '01') await expect(card.getByRole('button', { name: dayLabel(addDays(today, -1)), exact: true })).toBeDisabled();
    await expect(card.getByRole('button', { name: dayLabel(today), exact: true })).toBeEnabled();
    await expect(app.trip.calendar().previous()).toBeDisabled();

    for (const [chip, next] of [['This weekend', false], ['Next weekend', true]] as const) {
      const w = weekend(today, next);
      await card.getByRole('button', { name: chip, exact: true }).click();
      await expect(card.getByRole('button', { name: chip, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(card.getByRole('button', { name: 'Tonight', exact: true })).toHaveAttribute('aria-pressed', 'false');
      await expect(card).toContainText(`${shortDay(w.checkIn)} – ${shortDay(w.checkOut)} · 2 nights`);
      await expect(card.getByRole('button', { name: dayLabel(w.checkIn), exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(card.getByRole('button', { name: dayLabel(w.checkOut), exact: true })).toHaveAttribute('aria-pressed', 'true');
    }

    // Next month and back.
    await app.trip.calendar().next().click();
    await expect(card.getByRole('grid').first()).toHaveAccessibleName(monthName(addDays(`${today.slice(0, 7)}-01`, 32)));
    await expect(app.trip.calendar().previous()).toBeEnabled();
    await app.trip.calendar().previous().click();
    await expect(card.getByRole('grid').first()).toHaveAccessibleName(monthName(today));

    // Two taps: check-in, then check-out.
    const { checkIn, checkOut } = { checkIn: addDays(today, 9), checkOut: addDays(today, 13) };
    await app.trip.calendar().pick(checkIn, checkOut);
    await expect(card).toContainText(`${shortDay(checkIn)} – ${shortDay(checkOut)} · 4 nights`);
    await expect(card.getByRole('button', { name: 'Next weekend', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await app.trip.done().click();
    await expect(card).toHaveCount(0);
    await expect(app.trip.when()).toHaveText(`When: ${shortDay(checkIn)} – ${shortDay(checkOut)} · 4 nights`);

    // Tonight undoes it.
    await app.trip.when().click();
    await card.getByRole('button', { name: 'Tonight', exact: true }).click();
    await app.trip.done().click();
    await expect(app.trip.when()).toHaveText('When: Tonight · 1 night');
    // The pill toggles its card.
    await app.trip.when().click();
    await app.trip.when().click();
    await expect(card).toHaveCount(0);
  });

  test('the calendar never makes a stay longer than 30 nights', async ({ app }) => {
    await app.goto();
    const today = todayLocal();
    await app.trip.when().click();
    const cal = app.trip.calendar();
    const checkIn = addDays(today, 2);
    await cal.press(checkIn);
    // A second tap 31 nights on starts again from that day instead.
    const tooFar = addDays(checkIn, 31);
    await cal.press(tooFar);
    await expect(app.trip.nights()).toContainText(`${shortDay(tooFar)} – ${shortDay(addDays(tooFar, 1))} · 1 night`);
    // 30 nights is allowed.
    const thirty = addDays(tooFar, 30);
    await cal.press(thirty);
    expect(nightsBetween(tooFar, thirty)).toBe(30);
    await expect(app.trip.nights()).toContainText(`${shortDay(tooFar)} – ${shortDay(thirty)} · 30 nights`);
  });

  test('the Who pill: adults, children and their ages, rooms never more than adults, the pet', async ({ page, app }) => {
    await app.goto();
    await app.trip.who().click();
    const party = app.trip.party();
    await expect(app.trip.who()).toHaveAttribute('aria-expanded', 'true');
    await expect(party.value('adults')).toHaveText('2');
    await expect(party.value('children')).toHaveText('0');
    // Rooms start at "Best price": we price the sensible splits (docs/finder.md, "Room splits").
    await expect(party.value('rooms')).toHaveText('Best price');
    await expect(party.fewer('children')).toBeDisabled();
    await expect(party.fewer('rooms')).toBeDisabled();
    await expect(party.pet()).not.toBeChecked();

    // Adults: 1 to 12.
    await party.fewer('adults').click();
    await expect(party.value('adults')).toHaveText('1');
    await expect(party.fewer('adults')).toBeDisabled();
    // One adult: one room at most; "−" from 1 goes back to "Best price".
    await party.more('rooms').click();
    await expect(party.value('rooms')).toHaveText('1');
    await expect(party.more('rooms')).toBeDisabled();
    await party.fewer('rooms').click();
    await expect(party.value('rooms')).toHaveText('Best price');
    for (let i = 1; i < 12; i++) await party.more('adults').click();
    await expect(party.value('adults')).toHaveText('12');
    await expect(party.more('adults')).toBeDisabled();
    // Rooms: up to 6, and never more than adults.
    for (let i = 0; i < 6; i++) await party.more('rooms').click();
    await expect(party.value('rooms')).toHaveText('6');
    await expect(party.more('rooms')).toBeDisabled();
    for (let i = 12; i > 3; i--) await party.fewer('adults').click();
    await expect(party.value('adults')).toHaveText('3');
    await expect(party.value('rooms')).toHaveText('3');

    // Children: each gets an age (8 until changed), 0 to 17, at most 8 children.
    await party.more('children').click();
    await expect(party.age(1)).toHaveValue('8');
    const options = await party.age(1).locator('option').allTextContents();
    expect(options).toEqual(Array.from({ length: 18 }, (_, n) => String(n)));
    await party.age(1).selectOption('4');
    await party.more('children').click();
    await expect(party.age(2)).toHaveValue('8');
    for (let i = 2; i < 8; i++) await party.more('children').click();
    await expect(party.value('children')).toHaveText('8');
    await expect(party.more('children')).toBeDisabled();
    for (let i = 8; i > 1; i--) await party.fewer('children').click();
    await expect(party.age(2)).toHaveCount(0);
    await expect(party.age(1)).toHaveValue('4');

    await party.pet().check();
    await expect(app.trip.who()).toHaveText('Who: 3 adults, 1 child (4), 3 rooms · pet');
    await app.trip.done().click();
    await expect(page.getByRole('dialog', { name: 'Who is going' })).toHaveCount(0);
    await expect(app.trip.who()).toHaveText('Who: 3 adults, 1 child (4), 3 rooms · pet');
    // The pill toggles its card.
    await app.trip.who().click();
    await app.trip.who().click();
    await expect(page.getByRole('dialog', { name: 'Who is going' })).toHaveCount(0);
  });

  test('what matters: each chip toggles, and the search carries what is pressed', async ({ page, app }) => {
    await app.goto();
    for (const p of COPY.priorities) {
      await app.trip.priority(p).click();
      await expect(app.trip.priority(p)).toHaveAttribute('aria-pressed', 'true');
    }
    await app.trip.priority('Great reviews').click();
    await expect(app.trip.priority('Great reviews')).toHaveAttribute('aria-pressed', 'false');
    await app.trip.pickPorto();
    const brief = page.waitForRequest((r) => r.url().includes('/api/session/brief'));
    await app.trip.find().click();
    const body = (await brief).postDataJSON();
    expect([...body.brief.priorities].sort()).toEqual(['cheapest', 'closest']);
    await app.results.waitForCards();
  });

  test('pills only: one bubble for the pills, then the shortlist and the trip', async ({ page, app }) => {
    const dates = canonicalDates();
    await app.goto();
    await app.trip.pickPorto();
    await app.trip.setNights(dates.checkIn, dates.checkOut);
    await app.trip.who().click();
    await app.trip.party().more('adults').click();
    await app.trip.party().fewer('adults').click();
    await app.trip.done().click();
    await app.trip.priority('Low price').click();
    const brief = page.waitForRequest((r) => r.url().includes('/api/session/brief'));
    await app.trip.find().click();
    // While it searches: the button says so and cannot be pressed twice.
    expect((await brief).postDataJSON().brief).toMatchObject({ text: '', dates, guests: { adults: 2, childrenAges: [], rooms: null, pets: false }, priorities: ['cheapest'] });
    await app.results.waitForCards();

    const convo = app.chat.region();
    await expect(convo.getByText(COPY.pennyHello)).toBeVisible();
    await expect(convo.getByText('Porto, Portugal · 2 adults', { exact: true })).toHaveCount(1);
    // Nothing echoed back: the pills already said it.
    await expect(convo.getByText(/From your message/)).toHaveCount(0);
    await expect(convo.getByText(/^\d+ of \d+ hotels fit\. The best \d are listed, each with the reason it is there\.$/)).toBeVisible();
    await expect(app.chat.heading()).toHaveText('Porto, Portugal');
    await expect(app.sidebar.trip(/Porto, Portugal/)).toHaveAttribute('aria-current', 'true');
    await expect(app.sidebar.nav().getByText(COPY.noTrips)).toHaveCount(0);
    await expect(app.chat.input()).toHaveAttribute('placeholder', COPY.composerActive);
  });
});
