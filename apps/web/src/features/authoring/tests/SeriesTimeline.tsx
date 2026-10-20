'use client';

import type { Series, Test } from '@mitaoe/shared';
import { EmptyState, InlineMessage, Skeleton } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { TestStatus } from './TestStatus';
import { testUrl, testWhen } from './test-view';

/** The tests of a series, in the server's schedule order (date, then creation order). */
export function useSeriesTests(seriesId: string) {
  const { orgId } = useWorkspace();
  return useQuery({
    queryKey: qk.orgList(orgId, 'tests', { seriesId }),
    queryFn: () => api<{ items: Test[] }>(`/v1/tests?seriesId=${encodeURIComponent(seriesId)}`),
    select: (d) => d.items,
  });
}

/**
 * SER-03: the series' tests as a day-by-day timeline, each with its day label (TST-02), company, time in the
 * organization's timezone (TST-07) and status.
 */
export function SeriesTimeline({ series, addTest }: { series: Series; addTest: ReactNode }) {
  const { org } = useWorkspace();
  const tests = useSeriesTests(series.id);
  const zone = org?.timezone ?? 'Asia/Kolkata';
  return (
    <section aria-labelledby="timeline-heading" className="mt-8">
      <h2 id="timeline-heading" className="mb-4 text-heading-2 font-bold">
        {t('tests.timeline')}
      </h2>
      {tests.isError ? <InlineMessage>{t('common.loadFailed')}</InlineMessage> : null}
      {tests.isPending ? (
        <div role="status" aria-busy="true" aria-label={t('app.loading')}>
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}
      {tests.data?.length === 0 ? <EmptyState message={t('tests.empty')} action={addTest} /> : null}
      {tests.data?.length ? (
        <ol aria-label={t('tests.timeline')} className="max-w-measure border-l-2 border-rule">
          {tests.data.map((test) => (
            <li key={test.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 pl-4">
              {test.dayLabel ? <span className="font-bold text-graphite">{test.dayLabel}</span> : null}
              <Link
                href={testUrl(test.id)}
                className="inline-flex min-h-11 items-center font-bold text-ballpoint underline"
              >
                {test.title}
              </Link>
              {test.company ? <span>{test.company}</span> : null}
              <span>{testWhen(series, test, zone)}</span>
              <TestStatus status={test.status} />
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
