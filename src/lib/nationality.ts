import { isCountryCode, type CountryCode } from './countries';

/**
 * The nationality a rate search is made with (the supplier requires one).
 * It is never asked as a question: it is inferred, shown on the results as a
 * chip, and the user may change it to anything.
 *
 * This function takes no price, no offer and no rate, on purpose: the app
 * must never pick a nationality to chase a cheaper rate on the user's behalf
 * (docs/onboarding.md §4). nationalityGuard.test.ts keeps it that way.
 *
 * First hit wins: what the user chose before, then the region of their
 * browser language, then the country of their IP, then the destination's.
 */
export type NationalitySource = 'saved' | 'browser' | 'ip' | 'destination';

export type InferredNationality = { code: CountryCode; source: NationalitySource };

export function inferNationality(signals: {
  saved: string | null;
  acceptLanguage: string | null;
  ipCountry: string | null;
  destinationCountry: string | null;
}): InferredNationality | null {
  const saved = upper(signals.saved);
  if (saved && isCountryCode(saved)) return { code: saved, source: 'saved' };
  const browser = regionFromAcceptLanguage(signals.acceptLanguage);
  if (browser) return { code: browser, source: 'browser' };
  const ip = upper(signals.ipCountry);
  if (ip && isCountryCode(ip)) return { code: ip, source: 'ip' };
  const dest = upper(signals.destinationCountry);
  if (dest && isCountryCode(dest)) return { code: dest, source: 'destination' };
  return null;
}

/** "en-US,en;q=0.9,es;q=0.8" → US. The highest-weighted tag that carries a real region. */
export function regionFromAcceptLanguage(header: string | null): CountryCode | null {
  if (!header) return null;
  const tags = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((t) => t.tag && t.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { tag } of tags) {
    // language[-script][-REGION]: the region is the 2-letter subtag after the language.
    const region = tag
      .split('-')
      .slice(1)
      .find((s) => /^[A-Za-z]{2}$/.test(s));
    const code = upper(region ?? null);
    if (code && isCountryCode(code)) return code;
  }
  return null;
}

const upper = (s: string | null | undefined) => (s ? s.trim().toUpperCase() : null);
