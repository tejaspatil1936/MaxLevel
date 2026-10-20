import type { TestReleaseSummary } from '@mitaoe/shared';
import type { MessageKey } from '@/i18n';

/** The admin results list's `Results` word for a test's release state (docs/testids/phase-4.md "Results list"). */
export function releaseWord(s: Pick<TestReleaseSummary, 'state' | 'resultRelease'>): MessageKey {
  if (s.state === 'pending')
    return s.resultRelease === 'after_close' ? 'results.word.afterClose' : 'results.word.manual';
  return `results.word.${s.state}`;
}

export const resultsUrl = (params: { test?: string; series?: string } = {}) =>
  params.test
    ? `/admin/results/?test=${encodeURIComponent(params.test)}`
    : params.series
      ? `/admin/results/?series=${encodeURIComponent(params.series)}`
      : '/admin/results/';
