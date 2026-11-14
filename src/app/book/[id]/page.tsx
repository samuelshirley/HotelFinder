import { cookies, headers } from 'next/headers';

import { Checkout } from '@/components/Checkout';
import { LocaleProvider } from '@/components/i18n';
import { LOCALE_COOKIE, resolveLocale } from '@/lib/i18n/locale';

export default function Page({ params }: { params: { id: string } }) {
  // The same choice as the app's page: the picker's cookie, else the browser's languages (docs/i18n.md).
  const locale = resolveLocale({ cookie: cookies().get(LOCALE_COOKIE)?.value, acceptLanguage: headers().get('accept-language') });
  return (
    <LocaleProvider initial={locale}>
      <Checkout bookingId={params.id} />
    </LocaleProvider>
  );
}
