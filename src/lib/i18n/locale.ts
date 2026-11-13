/**
 * The languages the app speaks, and how one is chosen (docs/i18n.md).
 *
 * Order of choice: the picker (a cookie), else the browser's Accept-Language,
 * else English. Pure: the server reads the cookie and the header and passes
 * them in; the client passes what the picker set.
 *
 * Adding a language: add it here, add `catalogue/<code>.ts` (the guard test
 * fails until every English key has an entry), and give the slot extractors
 * its words (lib/router/lexicon.ts).
 */
export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Set by the language picker. Not httpOnly: the client sets it. Path is the app's base path. */
export const LOCALE_COOKIE = 'hf_locale';

/** The picker's own names: each language named in itself. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', es: 'Español' };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The best supported language in an Accept-Language header ("es-ES,es;q=0.9,en;q=0.8"),
 * or null when none of them is one we speak. Only the primary subtag counts.
 */
export function fromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const tags = header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)).find(Boolean);
      return { lang: tag.trim().toLowerCase().split('-')[0], q: q ? Number(q[1]) : 1, i };
    })
    .filter((t) => t.lang && Number.isFinite(t.q) && t.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return tags.map((t) => t.lang).find(isLocale) ?? null;
}

/** The picker's choice, else the browser's languages, else English. */
export function resolveLocale(input: { cookie?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(input.cookie)) return input.cookie;
  return fromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE;
}

/** Tags for Intl: numbers and money, and dates (en-GB keeps "11 Dec", day first). */
export const INTL: Record<Locale, { number: string; date: string }> = {
  en: { number: 'en', date: 'en-GB' },
  es: { number: 'es-ES', date: 'es-ES' },
};

/** The language the Haiku agent is told to write in. */
export const LANGUAGE_NAME_EN: Record<Locale, string> = { en: 'English', es: 'Spanish' };
