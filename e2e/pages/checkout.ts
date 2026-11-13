/** Page objects for /hotels/book/[id] (the checkout and the receipt) and /hotels/admin. */
import { expect, type Page } from '@playwright/test';

export class CheckoutPage {
  constructor(readonly page: Page) {}
  async goto(bookingId: string): Promise<void> {
    await this.page.goto(`./book/${bookingId}`);
    await expect(this.page.getByText('Opening the checkout…')).toHaveCount(0, { timeout: 60_000 });
  }
  back = () => this.page.getByRole('link', { name: '← Back to the shortlist' });
  stay = () => this.page.getByRole('region', { name: 'Your stay' });
  form = () => this.page.getByRole('region', { name: 'Sign in and pay' });
  receipt = () => this.page.getByRole('region', { name: 'Booking' });
  /** Before paying the stay says "Pay now"; on the receipt, "Total" (Checkout.tsx). */
  total = () => this.page.locator('dt').filter({ hasText: /^(Pay now|Total), taxes in$/ }).locator('+ dd');
  dd = (term: string) => this.page.locator('dt').filter({ hasText: new RegExp(`^${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).locator('+ dd');
  email = () => this.page.getByLabel(/^Email\./);
  sendCode = () => this.page.getByRole('button', { name: /^(Send code|Send a new code|Sending…)$/ });
  devCode = () => this.page.getByRole('status').filter({ hasText: 'No email service is set up here' });
  code = () => this.page.getByLabel('6-digit code');
  first = () => this.page.getByLabel("First name (as on the guest's ID)");
  last = () => this.page.getByLabel('Last name', { exact: true });
  pay = (wallet: 'Apple Pay' | 'Google Pay') => this.page.getByRole('button', { name: new RegExp(`^Pay .+ with ${wallet}$`) });
  sheet = (wallet: 'Apple Pay' | 'Google Pay') => this.page.getByRole('dialog', { name: `${wallet} (test)` });
  confirmIn = (wallet: 'Apple Pay' | 'Google Pay') => this.sheet(wallet).getByRole('button', { name: /^Confirm / });
  cancelIn = (wallet: 'Apple Pay' | 'Google Pay') => this.sheet(wallet).getByRole('button', { name: 'Cancel', exact: true });
  notYou = () => this.page.getByRole('button', { name: 'Not you?' });
  heading = () => this.page.getByRole('heading', { level: 1 });
  /** What the hotel charges on top: a named list, or one line ("Nothing listed"). */
  atHotel = () => this.stay().getByRole('group', { name: 'Pay at the hotel' }).or(this.dd('Pay at the hotel'));
  request = () => this.page.getByLabel('Special requests (optional)');
  // Deal Freeze (docs/deal-freeze.md)
  freezeOffer = () => this.page.getByRole('group', { name: 'Freeze this price' });
  freeze = () => this.freezeOffer().getByRole('button', { name: /^(Freeze until .+|Booking with the hotel…)$/ });
  confirmFrozen = (wallet: 'Apple Pay' | 'Google Pay') => this.page.getByRole('button', { name: new RegExp(`^Confirm and pay .+ with ${wallet}$`) });
  releaseIt = () => this.page.getByRole('button', { name: 'Release it', exact: true });
  keepHolding = () => this.page.getByRole('button', { name: 'Keep holding it', exact: true });
  yesRelease = () => this.page.getByRole('button', { name: /^(Yes, release it|Releasing…)$/ });
  cancelBooking = () => this.page.getByRole('button', { name: 'Cancel this booking' });
  keepIt = () => this.page.getByRole('button', { name: 'Keep it' });
  yesCancel = () => this.page.getByRole('button', { name: /^(Yes, cancel it|Cancelling…)$/ });
  backLink = () => this.page.getByRole('link', { name: 'Back to the shortlist', exact: true });
  async readCode(): Promise<string> {
    await expect(this.devCode()).toBeVisible();
    const code = (await this.devCode().locator('strong').textContent())!.trim();
    expect(code).toMatch(/^\d{6}$/);
    return code;
  }
}

export class AdminPage {
  constructor(readonly page: Page) {}
  form = () => this.page.getByRole('form', { name: 'Admin sign-in' });
  email = () => this.form().getByLabel('Email', { exact: true });
  code = () => this.form().getByLabel(/^Code sent to /);
  submit = () => this.form().getByRole('button');
  devCode = () => this.form().getByText(/^Dev mailbox: \d{6}$/);
  alert = () => this.form().getByRole('alert');
  window = (name: '24 hours' | '7 days' | '30 days') => this.page.getByRole('navigation', { name: 'Window' }).getByRole('link', { name, exact: true });
  searches = () => this.page.getByRole('region', { name: 'Most expensive searches' });
  rowFor = (sessionId: string) => this.searches().getByRole('row').filter({ has: this.page.locator(`a[href$="/admin/search/${sessionId}"]`) });
  tile = (label: string) => this.page.getByRole('region', { name: 'Summary' }).locator('div', { has: this.page.getByText(label, { exact: true }) });
  calls = () => this.page.getByRole('table', { name: 'Calls' });

  /** Through the real form: email, Send code, the dev-mailbox code, Sign in. */
  async signIn(email: string, path = './admin'): Promise<void> {
    await this.page.goto(path);
    await expect(this.form()).toBeVisible();
    await this.email().fill(email);
    await this.submit().click();
    await expect(this.devCode().or(this.alert())).toBeVisible();
    await expect(this.alert()).toHaveCount(0);
    const code = (await this.devCode().textContent())!.match(/\d{6}/)![0];
    await this.code().fill(code);
    await this.submit().click();
  }
}
