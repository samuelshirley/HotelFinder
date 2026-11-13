/**
 * Shared custom matchers, registered on the `expect` exported by fixtures/test.ts:
 *
 *   await expect(page).toHaveLoadedImages()      every rendered <img> decoded, with an alt attribute
 *   await expect(page).toHaveWorkingLinks(api)   every link resolves (ours) or is a safe https URL (theirs)
 *   await expect(page).toHaveOnlyErrorCopy()     every alert on the page is one of errors.ts' sentences
 */
import { expect as base, type APIRequestContext, type Page } from '@playwright/test';

import { ERROR_COPY } from './copy';
import { BASE_PATH, ORIGIN } from './env';

type ImageReport = { src: string; problem: string };

/** Every <img> the page renders: scrolled into view (lazy ones load), decoded, non-zero size, alt present. */
export async function imageProblems(page: Page, scope = 'body'): Promise<ImageReport[]> {
  const count = await page.locator(`${scope} img`).count();
  const out: ImageReport[] = [];
  for (let i = 0; i < count; i++) {
    const img = page.locator(`${scope} img`).nth(i);
    // A broken image can render as nothing at all, so visibility alone does not decide: one that is
    // hidden AND never asked for (a lazy image off screen in a closed panel) is the only one skipped.
    const visible = await img.isVisible().catch(() => false);
    if (visible) await img.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
    const report = await img
      .evaluate(async (el: HTMLImageElement, shown: boolean) => {
        if (!shown && !el.complete && !el.closest('[hidden]') && el.loading !== 'lazy') await new Promise((r) => setTimeout(r, 2_000));
        if (!shown && (!el.complete || !el.getAttribute('src') || el.closest('[hidden], [aria-hidden="true"]'))) return null;
        const deadline = Date.now() + 15_000;
        while (!el.complete && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
        try {
          await el.decode();
        } catch {
          // reported below by naturalWidth
        }
        const src = el.currentSrc || el.src;
        if (!el.complete) return { src, problem: 'never finished loading' };
        if (el.naturalWidth === 0) return { src, problem: 'did not load (naturalWidth 0)' };
        const alt = el.getAttribute('alt');
        if (alt === null) return { src, problem: 'has no alt attribute' };
        if (alt && /^(image|photo|picture|img)$|\.(png|jpe?g|webp|gif|svg)$|^https?:/i.test(alt.trim())) return { src, problem: `alt is not meaningful: "${alt}"` };
        if (alt === '') {
          // Decorative is right only when something next to it already says what it is.
          // Its control is named ("Photo 2 of 12"), or a close ancestor holds the words (the card's name, "Penny").
          let named = false;
          for (let up = el.parentElement, n = 0; up && n < 3 && !named; up = up.parentElement, n++) {
            named = Boolean(up.getAttribute('aria-label')) || (up.textContent ?? '').trim().length > 0;
          }
          if (!named && !el.closest('[aria-hidden="true"]')) return { src, problem: 'alt="" but nothing around it names it' };
        }
        return null;
      }, visible)
      .catch((e: Error) => ({ src: '?', problem: `could not be checked: ${e.message}` }));
    if (report) out.push(report);
  }
  return out;
}

type LinkReport = { href: string; problem: string };

export async function linkProblems(page: Page, request: APIRequestContext): Promise<LinkReport[]> {
  const links = await page.locator('a[href]').evaluateAll((els) =>
    els.map((a) => ({ href: (a as HTMLAnchorElement).href, raw: a.getAttribute('href') ?? '', target: a.getAttribute('target'), rel: a.getAttribute('rel') ?? '' })),
  );
  const out: LinkReport[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    if (seen.has(l.href)) continue;
    seen.add(l.href);
    const url = new URL(l.href);
    if (url.origin === ORIGIN) {
      if (!url.pathname.startsWith(BASE_PATH)) {
        out.push({ href: l.raw, problem: `leaves ${BASE_PATH} (basePath)` });
        continue;
      }
      const res = await request.get(url.toString(), { maxRedirects: 5 });
      if (res.status() >= 400) out.push({ href: l.raw, problem: `answers ${res.status()}` });
    } else {
      if (url.protocol !== 'https:') out.push({ href: l.raw, problem: 'an external link that is not https' });
      // (target=_blank without rel=noopener is not flagged: browsers imply noopener for it since 2021.)
    }
  }
  return out;
}

const COPY_VALUES = new Set<string>(Object.values(ERROR_COPY));

export const expect = base.extend({
  async toHaveLoadedImages(page: Page, scope = 'body') {
    const problems = await imageProblems(page, scope);
    return {
      pass: problems.length === 0,
      name: 'toHaveLoadedImages',
      message: () => `images that did not load or lack a text alternative:\n${problems.map((p) => `  ${p.problem}: ${p.src}`).join('\n')}`,
    };
  },
  async toHaveWorkingLinks(page: Page, request: APIRequestContext) {
    const problems = await linkProblems(page, request);
    return {
      pass: problems.length === 0,
      name: 'toHaveWorkingLinks',
      message: () => `broken or unsafe links:\n${problems.map((p) => `  ${p.href}: ${p.problem}`).join('\n')}`,
    };
  },
  /** Every role=alert with text says one of the declared error sentences (optionally with its reference). */
  async toHaveOnlyErrorCopy(page: Page) {
    // Next's route announcer is a role=alert too; it reads out the page title, not an error.
    const alerts = (await page.locator('[role="alert"]:not(#__next-route-announcer__)').allTextContents()).map((t) => t.trim()).filter(Boolean);
    const odd = alerts.filter((t) => !COPY_VALUES.has(t.replace(/ \(Reference: [\w-]+\)$/, '')));
    return { pass: odd.length === 0, name: 'toHaveOnlyErrorCopy', message: () => `alerts with copy that is not in src/lib/errors.ts:\n  ${odd.join('\n  ')}` };
  },
});
