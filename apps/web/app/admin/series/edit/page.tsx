import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EditSeries } from '@/features/authoring/series/SeriesForm';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('series.edit') };

// The series ID travels in ?id= (WEB-02).
export default function EditSeriesPage() {
  return (
    <Suspense>
      <EditSeries />
    </Suspense>
  );
}
