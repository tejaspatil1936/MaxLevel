import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/features/shell/Providers';
import { SkipLink } from '@/features/shell/SkipLink';
import { t } from '@/i18n';
import { PREFERENCES_BOOT_SCRIPT } from '@/lib/preferences-boot';
import { code, display, text } from './fonts';
import './globals.css';

export const metadata: Metadata = { title: { default: t('app.name'), template: `%s – ${t('app.name')}` } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="system"
      data-motion="system"
      className={`${display.variable} ${text.variable} ${code.variable}`}
      // The boot script sets the saved theme, size and motion on <html> before React hydrates.
      suppressHydrationWarning
    >
      <head>
        {/* A11Y-02: apply this browser's saved preferences before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: PREFERENCES_BOOT_SCRIPT }} />
      </head>
      <body>
        <SkipLink />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
