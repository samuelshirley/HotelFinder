import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';

import { LOCALE_COOKIE, resolveLocale } from '@/lib/i18n/locale';
import './globals.css';

export const metadata: Metadata = { title: 'Hotel finder', description: 'Say what you need. Get the best few hotels, with the reason for each.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  const lang = resolveLocale({ cookie: cookies().get(LOCALE_COOKIE)?.value, acceptLanguage: headers().get('accept-language') });
  return (
    <html lang={lang}>
      <body>{children}</body>
    </html>
  );
}
