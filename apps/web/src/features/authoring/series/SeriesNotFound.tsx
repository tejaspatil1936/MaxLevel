'use client';

import Link from 'next/link';
import { t } from '@/i18n';
import { useWorkspace } from '@/lib/workspace';

/** An ID outside the organization being worked in: nothing of the other organization's record is shown (ORG-05). */
export function SeriesNotFound() {
  const { org } = useWorkspace();
  return (
    <>
      <h1 className="font-display text-display-2 font-bold">{t('series.notFound')}</h1>
      <p className="mt-2">{t('series.notFoundBody', { org: org?.name ?? '' })}</p>
      <Link href="/admin/series/" className="mt-4 inline-flex min-h-11 items-center font-bold text-ballpoint underline">
        {t('series.back')}
      </Link>
    </>
  );
}
