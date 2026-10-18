import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SeriesView } from '@/features/authoring/series/SeriesView';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('nav.series') };

// The series ID travels in ?id= (WEB-02).
export default function SeriesViewPage() {
  return (
    <Suspense>
      <SeriesView />
    </Suspense>
  );
}
