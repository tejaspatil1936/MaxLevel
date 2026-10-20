'use client';

import Link from 'next/link';
import { t } from '@/i18n';

/**
 * A test the dashboard would not list (another organization, not eligible, not published): nothing of it is shown
 * (US-ST-03, ORG-05). Used by the test page, and later by preflight and the rules screen.
 */
export function TestNotAvailable() {
  return (
    <>
      <h1 className="font-display text-display-2 font-bold">{t('studentTest.notFound')}</h1>
      <p className="mt-2">{t('studentTest.notFoundBody')}</p>
      <Link href="/student/" className="mt-4 inline-flex min-h-11 items-center font-bold text-ballpoint underline">
        {t('studentTest.back')}
      </Link>
    </>
  );
}
