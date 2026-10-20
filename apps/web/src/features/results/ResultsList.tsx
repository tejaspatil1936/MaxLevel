'use client';

import type { ResultsOverview } from '@mitaoe/shared';
import { EmptyState, InlineMessage, PageHeader, Table } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { testHeading } from '@/features/authoring/tests/test-view';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { formatCount, formatDay } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { releaseWord, resultsUrl } from './release-words';

const link = 'inline-flex min-h-11 items-center font-bold text-ballpoint underline';

/** /admin/results/ (US-AD-10): published tests with their release state, and the series that hold them. */
export function ResultsList() {
  const { orgId } = useWorkspace();
  const overview = useQuery({
    queryKey: qk.orgList(orgId, 'results'),
    queryFn: () => api<ResultsOverview>('/v1/results'),
  });
  const tests = overview.data?.tests ?? [];
  return (
    <>
      <PageHeader title={t('nav.results')} subtitle={t('results.lead')} />
      {overview.isError ? <InlineMessage>{t('common.loadFailed')}</InlineMessage> : null}
      {overview.isSuccess && tests.length === 0 ? (
        <EmptyState
          message={t('results.empty')}
          action={
            <Link href="/admin/series/" className={link}>
              {t('results.goToSeries')}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3" aria-labelledby="results-tests">
            <h2 id="results-tests" className="text-heading-2 font-bold">
              {t('results.testsTitle')}
            </h2>
            <Table
              caption={t('results.testsTitle')}
              busy={overview.isPending}
              rows={tests}
              rowKey={(r) => r.testId}
              columns={[
                {
                  key: 'test',
                  header: t('results.colTest'),
                  cell: (r) => (
                    <Link href={resultsUrl({ test: r.testId })} className={link}>
                      {testHeading(r)}
                    </Link>
                  ),
                },
                { key: 'series', header: t('results.colSeries'), cell: (r) => r.seriesTitle },
                { key: 'date', header: t('results.colDate'), cell: (r) => formatDay(r.scheduledDate) },
                { key: 'results', header: t('results.colResults'), cell: (r) => t(releaseWord(r)) },
              ]}
            />
          </section>
          <section className="flex flex-col gap-3" aria-labelledby="results-series">
            <h2 id="results-series" className="text-heading-2 font-bold">
              {t('results.seriesTitle')}
            </h2>
            <Table
              caption={t('results.seriesTitle')}
              busy={overview.isPending}
              rows={overview.data?.series ?? []}
              rowKey={(s) => s.id}
              columns={[
                {
                  key: 'series',
                  header: t('results.colSeries'),
                  cell: (s) => (
                    <Link href={resultsUrl({ series: s.id })} className={link}>
                      {s.title}
                    </Link>
                  ),
                },
                { key: 'tests', header: t('results.colTests'), align: 'end', cell: (s) => formatCount(s.testCount) },
              ]}
            />
          </section>
        </div>
      )}
    </>
  );
}
