import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResultsScreen } from '@/features/results/ResultsScreen';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('nav.results') };

// The test or series ID travels in ?test= or ?series= (WEB-02).
export default function ResultsPage() {
  return (
    <Suspense>
      <ResultsScreen />
    </Suspense>
  );
}
