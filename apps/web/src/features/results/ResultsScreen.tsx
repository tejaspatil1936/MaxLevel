'use client';

import { useSearchParams } from 'next/navigation';
import { ResultsList } from './ResultsList';
import { TestResults } from './TestResults';

/** /admin/results/: the list, or one test's results with `?test=` (WEB-02). */
export function ResultsScreen() {
  const params = useSearchParams();
  const testId = params.get('test');
  if (testId) return <TestResults key={testId} testId={testId} />;
  return <ResultsList />;
}
