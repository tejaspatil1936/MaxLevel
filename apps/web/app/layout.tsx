import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { code, display, text } from './fonts';
import './globals.css';

export const metadata: Metadata = { title: t('app.name') };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="system"
      data-motion="system"
      className={`${display.variable} ${text.variable} ${code.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
