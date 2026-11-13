import { cookies, headers } from 'next/headers';

import { App } from '@/components/App';
import { LocaleProvider } from '@/components/i18n';
import { LOCALE_COOKIE, resolveLocale } from '@/lib/i18n/locale';

export default function Page() {
  // The picker's cookie, else the browser's languages (lib/i18n/locale.ts).
  const locale = resolveLocale({ cookie: cookies().get(LOCALE_COOKIE)?.value, acceptLanguage: headers().get('accept-language') });
  return (
    <LocaleProvider initial={locale}>
      <App />
    </LocaleProvider>
  );
}
