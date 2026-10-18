import type { Metadata } from 'next';
import Link from 'next/link';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('notFound.title') };

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-student px-4 py-12">
      <h1 className="font-display text-display-2 font-bold">{t('notFound.title')}</h1>
      <p className="mt-4 max-w-measure text-graphite">{t('notFound.lead')}</p>
      <Link href="/" className="mt-6 inline-flex min-h-11 items-center font-bold text-ballpoint underline">
        {t('notFound.home')}
      </Link>
    </main>
  );
}
