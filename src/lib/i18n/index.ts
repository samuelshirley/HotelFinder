import { en, type Messages } from './catalogue/en';
import { es } from './catalogue/es';
import { DEFAULT_LOCALE, INTL, isLocale, type Locale } from './locale';

/**
 * The message catalogues, one per language (docs/i18n.md). Pure data and
 * small grammar functions: safe on the server and in the browser.
 */
export const CATALOGUES: Record<Locale, Messages> = { en, es };

/** Everything the app says, in `locale`. An unknown value falls back to English. */
export function copy(locale: Locale | string | null | undefined): Messages {
  return CATALOGUES[isLocale(locale) ? locale : DEFAULT_LOCALE];
}

/** "A", "A and B", "A, B and C", in the locale's own word for "and" (or "or"). */
export function joinList(items: readonly string[], locale: Locale = DEFAULT_LOCALE, word: 'and' | 'or' = 'and'): string {
  const w = copy(locale).words[word];
  return items.length <= 2 ? items.join(` ${w} `) : `${items.slice(0, -1).join(', ')} ${w} ${items.at(-1)}`;
}

/** A count with the locale's grouping ("1,234" / "1234"). */
export function formatCount(n: number, locale: Locale = DEFAULT_LOCALE): string {
  return n.toLocaleString(INTL[locale].number);
}

export type { Messages } from './catalogue/en';
export { DEFAULT_LOCALE, INTL, LOCALES, LOCALE_COOKIE, LOCALE_NAMES, isLocale, resolveLocale, fromAcceptLanguage, type Locale } from './locale';
