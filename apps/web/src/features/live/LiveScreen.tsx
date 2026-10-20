'use client';

import { useSearchParams } from 'next/navigation';
import { LiveExamsList } from './LiveExamsList';
import { LiveView } from './LiveView';

/** /admin/live/: the tests live now, or one test's live view with `?test=` (WEB-02). */
export function LiveScreen() {
  const testId = useSearchParams().get('test');
  if (testId) return <LiveView key={testId} testId={testId} />;
  return <LiveExamsList />;
}
