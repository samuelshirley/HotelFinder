/**
 * Everything a page does wrong that no assertion asked about: console errors,
 * uncaught exceptions, failed requests, 4xx/5xx answers, and a 500 from our
 * API without the `ref` its log line carries. Attached to every page of every
 * test by the auto fixture in fixtures/test.ts; the test fails at teardown if
 * anything unexpected was seen. A test that provokes an error on purpose says
 * so with `allow()`, naming the URL and status it expects.
 */
import type { BrowserContext, ConsoleMessage, Page, Request, Response } from '@playwright/test';

import { ORIGIN } from './env';

type Rule = { url: RegExp; status?: number | number[]; reason: string };

export class Diagnostics {
  readonly problems: string[] = [];
  /** 503 supplier_unavailable: the live sandbox was busy (its rate limit). Reported, not failed: see docs/testing.md. */
  readonly sandboxBusy: string[] = [];
  private readonly rules: Rule[] = [];
  private readonly pending: Promise<void>[] = [];

  /** An error this test causes on purpose. Unused rules are fine; an unexpected error is not. */
  allow(url: RegExp, status: number | number[] | undefined, reason: string): void {
    this.rules.push({ url, status, reason });
  }

  private allowed(url: string, status?: number): boolean {
    return this.rules.some((r) => r.url.test(url) && (r.status === undefined || (Array.isArray(r.status) ? r.status.includes(status ?? -1) : r.status === status)));
  }

  attach(context: BrowserContext): void {
    for (const page of context.pages()) this.attachPage(page);
    context.on('page', (page) => this.attachPage(page));
  }

  private attachPage(page: Page): void {
    page.on('pageerror', (err) => this.problems.push(`pageerror on ${page.url()}: ${err.message}`));
    page.on('console', (msg) => this.onConsole(page, msg));
    page.on('response', (res) => this.pending.push(this.onResponse(res)));
    page.on('requestfailed', (req) => this.onFailed(req));
  }

  private onConsole(page: Page, msg: ConsoleMessage): void {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // The browser's own line for a 4xx/5xx answer: the response handler below judges it, with its status.
    if (/^Failed to load resource: the server responded with a status of \d+/.test(text)) return;
    // A request the test drops on purpose (allow() without a status) logs its own line.
    if (/^Failed to load resource: net::/.test(text) && this.allowed(msg.location().url)) return;
    this.problems.push(`console.error on ${page.url()}: ${text.slice(0, 500)}`);
  }

  private async onResponse(res: Response): Promise<void> {
    const status = res.status();
    if (status < 400) return;
    const url = res.url();
    const ours = url.startsWith(ORIGIN);
    // A 500 from our API is an unexpected throw: it must carry the ref its log line has (docs/deploy.md).
    if (ours && status === 500 && /\/api\//.test(url)) {
      const text = await res.text().catch(() => '');
      if (!/"ref":"[0-9a-f]{8}"/.test(text)) this.problems.push(`500 from ${res.request().method()} ${url} without a ref: ${text.slice(0, 200)}`);
    }
    if (this.allowed(url, status)) return;
    if (ours && status === 503) {
      const text = await res.text().catch(() => '');
      if (text.includes('"supplier_unavailable"')) {
        this.sandboxBusy.push(`${res.request().method()} ${url}`);
        return;
      }
    }
    this.problems.push(`${status} ${res.request().method()} ${url}`);
  }

  private onFailed(req: Request): void {
    const failure = req.failure()?.errorText ?? 'failed';
    // A request the page itself abandoned (a navigation away, a map tile no longer in view, a fetch it aborted).
    if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(failure)) return;
    if (this.allowed(req.url())) return;
    this.problems.push(`request failed: ${req.method()} ${req.url()} (${failure})`);
  }

  async settle(): Promise<string[]> {
    await Promise.allSettled(this.pending);
    return this.problems;
  }
}
