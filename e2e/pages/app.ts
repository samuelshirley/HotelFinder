/**
 * Page objects for /hotels: the app. Locators follow what a person (or a
 * screen reader) perceives: roles and accessible names, never CSS classes,
 * so a designer restyling src/ does not break them.
 */
import { expect, type Locator, type Page } from '@playwright/test';

import { dayLabel, monthName } from '../support/dates';
import { minor } from '../support/money';

export class Calendar {
  constructor(readonly root: Locator) {}
  grids = () => this.root.getByRole('grid');
  day = (iso: string) => this.root.getByRole('button', { name: dayLabel(iso), exact: true });
  next = () => this.root.getByRole('button', { name: 'Next month' });
  previous = () => this.root.getByRole('button', { name: 'Previous month' });
  /** Bring the month of `iso` on screen, then press it. */
  async press(iso: string): Promise<void> {
    for (let i = 0; i < 24 && (await this.root.getByRole('grid', { name: monthName(iso) }).count()) === 0; i++) await this.next().click();
    await this.day(iso).click();
  }
  async pick(checkIn: string, checkOut: string): Promise<void> {
    await this.press(checkIn);
    await this.press(checkOut);
  }
}

/** Adults / Children / Rooms steppers, child ages, the pet: in the Who pill, the guests card and the Who chip. */
export class Party {
  constructor(readonly root: Locator) {}
  more = (what: 'adults' | 'children' | 'rooms') => this.root.getByRole('button', { name: `More ${what}`, exact: true });
  fewer = (what: 'adults' | 'children' | 'rooms') => this.root.getByRole('button', { name: `Fewer ${what}`, exact: true });
  value = (what: 'adults' | 'children' | 'rooms') => this.more(what).locator('xpath=..').locator('output');
  age = (n: number) => this.root.getByLabel(`Age of child ${n}`);
  pet = () => this.root.getByLabel('Bringing a pet');
}

export class TripBox {
  constructor(readonly page: Page) {}
  box = () => this.page.getByLabel('Your trip', { exact: true });
  where = () => this.page.getByRole('button', { name: /^Where: / });
  when = () => this.page.getByRole('button', { name: /^When: / });
  who = () => this.page.getByRole('button', { name: /^Who: / });
  find = () => this.page.getByRole('button', { name: /^(Find my hotel|Finding…)$/ });
  priority = (name: 'Low price' | 'Great reviews' | 'Close to the centre') => this.page.getByRole('group', { name: 'What matters' }).getByRole('button', { name, exact: true });
  pop = () => this.page.getByRole('dialog', { name: /Choose your nights|Who is going/ }).or(this.page.getByRole('listbox'));
  nights = () => this.page.getByRole('dialog', { name: 'Choose your nights' });
  party = () => new Party(this.page.getByRole('dialog', { name: 'Who is going' }));
  calendar = () => new Calendar(this.nights());
  done = () => this.page.getByRole('button', { name: 'Done', exact: true });
  placeInput = () => this.page.getByRole('textbox', { name: 'Place', exact: true });
  /** A place suggestion row: its name, then "where · kind". */
  suggestion = (name: string, where: string, kind = 'City') => this.page.getByRole('button', { name: new RegExp(`^${esc(name)}\\s*${esc(where)} · ${esc(kind)}$`) });
  fullRow = () => this.page.getByRole('button', { name: /^Search for: “.*” Enter$/ });
  example = () => this.page.getByRole('region', { name: 'Example answer' });

  async pickPorto(): Promise<void> {
    await this.box().fill('porto');
    await this.suggestion('Porto', 'Portugal').click();
    await expect(this.where()).toHaveText('Where: Porto, Portugal');
  }
  async setNights(checkIn: string, checkOut: string): Promise<void> {
    await this.when().click();
    await this.calendar().pick(checkIn, checkOut);
    await this.done().click();
  }
}

export class Card {
  constructor(readonly root: Locator) {}
  heading = () => this.root.getByRole('heading', { level: 3 }).first();
  async name(): Promise<string> {
    return (await this.heading().textContent())!.replace(/^\s*(\d+|•)\s*/, '').trim();
  }
  async rank(): Promise<string> {
    return (await this.heading().textContent())!.trim().match(/^(\d+|•)/)![1];
  }
  /** The total for the stay, the card's primary number. */
  total = () => this.root.locator('p').filter({ hasText: /^(?:[€£$¥]|[A-Z]{2,3}\$?)[\d,]+(?:\.\d{2})?$/ }).first();
  async totalMinor(): Promise<number> {
    return minor((await this.total().textContent())!);
  }
  perNightLine = () => this.root.getByText(/^total for \d+ nights? · /);
  book = () => this.root.getByRole('button', { name: /^(Book|Checking the price…)$/ });
  /** Signed out, on a hotel where members pay less. */
  signInLower = () => this.root.getByRole('button', { name: 'Sign in for a lower price' });
  /** Signed in, on a hotel where the member price is under the hotel's public price. */
  memberPrice = () => this.root.getByText('Member price', { exact: true });
  details = () => this.root.getByRole('button', { name: /^(Details|Collapse ▲)$/ }).first();
}

export class Results {
  constructor(readonly page: Page) {}
  region = () => this.page.getByRole('region', { name: 'Hotels' });
  /** The hotel cards, in rank order (not the divider before near-misses, not skeletons). */
  cards = () => this.region().locator('ol > li[id^="hotel-"]');
  card = (i: number) => new Card(this.cards().nth(i));
  heading = () => this.region().getByRole('heading', { level: 2 });
  changeWhere = () => this.page.getByRole('button', { name: 'Change where' });
  changeWhen = () => this.page.getByRole('button', { name: 'Change when' });
  changeWho = () => this.page.getByRole('button', { name: 'Change who' });
  editor = (name: 'where' | 'when' | 'who') => this.page.getByRole('dialog', { name: `Change ${name}` });
  apply = () => this.page.getByRole('button', { name: 'Apply', exact: true });
  priorities = () => this.page.getByRole('button', { name: 'Change what matters most' });
  prioritiesGroup = () => this.region().getByRole('group', { name: 'What matters most' });
  nationality = () => this.page.getByLabel('Nationality for rates');
  mapToggle = () => this.page.getByRole('button', { name: /^(Hide map|Show map)$/ });
  map = () => this.page.getByTestId('map');
  pins = () => this.map().locator('button[data-pin]');
  publicNote = () => this.region().getByText(/^Signed out, each hotel shows its own public price\./);
  async waitForCards(timeout = 90_000): Promise<void> {
    await expect(this.cards().first()).toBeVisible({ timeout });
    await expect(this.cards().first()).not.toHaveAttribute('aria-busy', 'true');
  }
}

export class Chat {
  constructor(readonly page: Page) {}
  region = () => this.page.getByRole('region', { name: 'Conversation' });
  /** The chat's own title bar (the first screen has the page's H1 in the same region). */
  heading = () => this.region().locator('header').getByRole('heading', { level: 1 });
  input = () => this.page.getByLabel('Message', { exact: true });
  send = () => this.page.getByRole('button', { name: 'Send', exact: true });
  alert = () => this.region().locator('[role="alert"]');
  /** Penny's lines and the user's bubbles, as text. */
  lines = () => this.region().locator('p, div').filter({ hasNotText: /^$/ });
  async say(text: string): Promise<void> {
    await this.input().fill(text);
    await this.send().click();
  }
}

export class Sidebar {
  constructor(readonly page: Page) {}
  nav = () => this.page.getByRole('navigation', { name: 'Your trips' });
  toggle = () => this.page.getByRole('button', { name: 'Trips list', exact: true });
  newSearch = () => this.nav().getByRole('button', { name: 'New search' });
  trip = (destination: RegExp | string) => this.nav().getByRole('button', { name: typeof destination === 'string' ? new RegExp(esc(destination)) : destination });
  bookings = () => this.nav().getByRole('link');
  signOut = () => this.nav().getByRole('button', { name: 'Sign out' });
  scrim = () => this.page.getByRole('button', { name: 'Close the trips list' });
}

export class Detail {
  constructor(readonly page: Page) {}
  /** The slide-out variant: a dialog named for the hotel. */
  panel = () => this.page.getByRole('dialog').filter({ has: this.page.getByRole('region', { name: 'Price' }) });
  close = () => this.panel().getByRole('button', { name: 'Close', exact: true });
  price = (within: Locator = this.panel()) => within.getByRole('region', { name: 'Price' });
  keyFacts = (within: Locator = this.panel()) => within.getByRole('list', { name: 'Key facts' });
  photo = (n: number, within: Locator = this.panel()) => within.getByRole('button', { name: new RegExp(`^Photo ${n} of \\d+$`) });
  counter = (within: Locator = this.panel()) => within.getByRole('button', { name: /^1\/\d+ photos$/ });
  lightbox = () => this.page.getByRole('dialog', { name: /^Photos of / });
  section = (name: string, within: Locator = this.panel()) => within.locator('section').filter({ has: this.page.getByRole('heading', { name, exact: true }) });
  bookIn = (within: Locator = this.panel()) => within.getByRole('button', { name: /^Book · / });
}

export class AppPage {
  readonly trip: TripBox;
  readonly results: Results;
  readonly chat: Chat;
  readonly sidebar: Sidebar;
  readonly detail: Detail;
  constructor(readonly page: Page) {
    this.trip = new TripBox(page);
    this.results = new Results(page);
    this.chat = new Chat(page);
    this.sidebar = new Sidebar(page);
    this.detail = new Detail(page);
  }
  async goto(query = ''): Promise<void> {
    await this.page.goto(`./${query}`);
    // The app boots on the client: the first screen or the stored search, never the spinner.
    await expect(this.page.getByText('Starting…')).toHaveCount(0, { timeout: 30_000 });
  }
  /** A search from the first screen: Porto, the given nights, Find my hotel, the cards. */
  async searchPorto(dates: { checkIn: string; checkOut: string }, opts: { priority?: 'Low price' | 'Great reviews' | 'Close to the centre' } = {}): Promise<void> {
    await this.trip.pickPorto();
    await this.trip.setNights(dates.checkIn, dates.checkOut);
    if (opts.priority) await this.trip.priority(opts.priority).click();
    await this.trip.find().click();
    await this.results.waitForCards();
  }
}

/** Nothing is drawn over the element's middle: a person could press it (Playwright's own check only waits). */
export async function expectNotCovered(target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  const covered = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top && !el.contains(top) && !top.contains(el) ? (top.textContent ?? top.tagName).trim().slice(0, 80) : null;
  });
  expect(covered, 'something is drawn over it').toBeNull();
}

export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The sign-in modal (components/SignInModal.tsx): on the results ("Sign in for
 * member prices", "Sign in to book") and over a signed-out checkout ("Who is
 * booking?"). Email, Send code, then the code: the sixth digit signs in.
 */
export class SignInModal {
  constructor(
    readonly page: Page,
    readonly title: string | RegExp,
  ) {}
  dialog = () => this.page.getByRole('dialog', { name: this.title });
  email = () => this.dialog().getByLabel(/^Email\./);
  send = () => this.dialog().getByRole('button', { name: /^(Send code|Sending…)$/ });
  newCode = () => this.dialog().getByRole('button', { name: 'Send a new code' });
  code = () => this.dialog().getByLabel(/^The 6-digit code sent to /);
  devCode = () => this.dialog().getByRole('status').filter({ hasText: 'No email service is set up here' });
  submit = () => this.dialog().getByRole('button', { name: /^(Sign in|Checking the price…|Checking the prices…)$/ });
  notNow = () => this.dialog().getByRole('button', { name: 'Not now' });
  back = () => this.dialog().getByRole('link', { name: 'Back to the shortlist' });
  alert = () => this.dialog().getByRole('alert');
  async sendTo(email: string): Promise<string> {
    await this.email().fill(email);
    await this.send().click();
    await expect(this.devCode()).toBeVisible();
    const code = (await this.devCode().locator('strong').textContent())!.trim();
    expect(code).toMatch(/^\d{6}$/);
    return code;
  }
  /** Email, code, and the modal closes once the price is checked for this account. */
  async signIn(email: string): Promise<void> {
    const code = await this.sendTo(email);
    await this.code().fill(code);
    await expect(this.dialog()).toHaveCount(0, { timeout: 90_000 });
  }
}
