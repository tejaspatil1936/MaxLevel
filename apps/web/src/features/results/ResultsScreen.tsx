'use client';

import { useSearchParams } from 'next/navigation';
import { ResultsList } from './ResultsList';

/** /admin/results/: the list, or one test's results with `?test=` (WEB-02). */
export function ResultsScreen() {
  const params = useSearchParams();
  const testId = params.get('test');
  if (testId) return null;
  return <ResultsList />;
}
