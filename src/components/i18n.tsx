'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { BASE_PATH } from '@/lib/basePath';
import { copy, type Messages } from '@/lib/i18n';
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALES, isLocale, type Locale } from '@/lib/i18n/locale';

/**
 * The screen's language (docs/i18n.md). The server picks the first one from
 * the cookie or Accept-Language (app/page.tsx); the picker changes it and
 * sets the cookie, so every later request is answered in it too.
 */
type Ctx = { locale: Locale; setLocale: (locale: Locale) => void };
const LocaleContext = createContext<Ctx>({ locale: 'en', setLocale: () => undefined });

export function LocaleProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, set] = useState<Locale>(initial);
  const setLocale = useCallback((next: Locale) => {
    // A year; the app's own path, so it goes with every API call and nothing else.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=${BASE_PATH}; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    document.documentElement.lang = next;
    set(next);
  }, []);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** The language, its words, and the setter. */
export function useLocale(): { locale: Locale; t: Messages; setLocale: (locale: Locale) => void } {
  const { locale, setLocale } = useContext(LocaleContext);
  return { locale, t: copy(locale), setLocale };
}

/** Each language named in itself, so it can be found by someone who reads only that one. */
export function LanguagePicker({ className }: { className?: string }) {
  const { locale, t, setLocale } = useLocale();
  return (
    <label className={className}>
      <span>{t.ui.language}</span>{' '}
      <select aria-label={`${t.ui.language} / ${LOCALES.map((l) => copy(l).ui.language).filter((w) => w !== t.ui.language).join(' / ')}`} value={locale} onChange={(e) => isLocale(e.target.value) && setLocale(e.target.value)}>
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
