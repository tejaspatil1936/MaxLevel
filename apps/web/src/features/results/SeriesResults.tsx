'use client';

import { seriesBoardId, type Series } from '@mitaoe/shared';
import { InlineMessage, PageHeader, Skeleton } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AdminLeaderboard } from '@/features/leaderboards/AdminLeaderboard';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { resultsUrl } from './release-words';

const link = 'inline-flex min-h-11 items-center font-bold text-ballpoint underline';
const h1 = 'font-display text-display-2 font-bold';

/** /admin/results/?series=<seriesId> (LB-05, US-AD-14): one series' results, its leaderboard with every row. */
export function SeriesResults({ seriesId }: { seriesId: string }) {
  const { orgId, org } = useWorkspace();
  const query = useQuery({
    queryKey: qk.orgItem(orgId, 'series', seriesId),
    queryFn: () => api<Series>(`/v1/series/${encodeURIComponent(seriesId)}`),
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
  const back = (
    <Link href={resultsUrl()} className={link}>
      {t('results.back')}
    </Link>
  );
  if (query.error instanceof ApiError && query.error.status === 404)
    return (
      <div className="flex flex-col items-start gap-2">
        <h1 className={h1}>{t('series.notFound')}</h1>
        <p>{t('series.notFoundBody', { org: org?.name ?? '' })}</p>
        {back}
      </div>
    );
  if (query.isError)
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className={h1}>{t('nav.results')}</h1>
        <InlineMessage>{t('common.loadFailed')}</InlineMessage>
        {back}
      </div>
    );
  if (!query.data)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-12 w-80" />
        <Skeleton className="mt-6 h-32 w-full" />
      </div>
    );
  return (
    <>
      <PageHeader title={t('results.testHeading', { heading: query.data.title })} actions={back} />
      <AdminLeaderboard boardId={seriesBoardId(seriesId)} />
    </>
  );
}
