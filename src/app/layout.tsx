import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';

import { LOCALE_COOKIE, resolveLocale } from '@/lib/i18n/locale';
import './globals.css';

export const metadata: Metadata = { title: 'Hotel finder', description: 'Say what you need. Get the best few hotels, with the reason for each.' };

/**
 * Phones: the page may run under the notch and home bar (insets are padded where it matters), and
 * the keyboard resizes the content where the browser supports it. iOS Safari ignores
 * interactive-widget, so App.tsx also sizes the app to the visual viewport (docs/design/mobile.md).
 */
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-content', themeColor: '#161826' };

export default function RootLayout({ children }: { children: ReactNode }) {
  const lang = resolveLocale({ cookie: cookies().get(LOCALE_COOKIE)?.value, acceptLanguage: headers().get('accept-language') });
  return (
    <html lang={lang}>
      <body>{children}</body>
    </html>
  );
}
