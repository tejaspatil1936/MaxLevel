'use client';

import { useSearchParams } from 'next/navigation';
import { ResultsList } from './ResultsList';
import { SeriesResults } from './SeriesResults';
import { TestResults } from './TestResults';

/** /admin/results/: the list, one test's results with `?test=`, or one series' with `?series=` (WEB-02). */
export function ResultsScreen() {
  const params = useSearchParams();
  const testId = params.get('test');
  const seriesId = params.get('series');
  if (testId) return <TestResults key={testId} testId={testId} />;
  if (seriesId) return <SeriesResults key={seriesId} seriesId={seriesId} />;
  return <ResultsList />;
}
