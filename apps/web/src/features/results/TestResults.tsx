'use client';

import { testBoardId, type TestReleaseSummary } from '@mitaoe/shared';
import { InlineMessage, PageHeader, Skeleton } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { testHeading } from '@/features/authoring/tests/test-view';
import { AdminLeaderboard, useAdminBoard } from '@/features/leaderboards/AdminLeaderboard';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { ExportRegion } from './ExportRegion';
import { ReleaseRegion } from './ReleaseRegion';
import { resultsUrl } from './release-words';

const link = 'inline-flex min-h-11 items-center font-bold text-ballpoint underline';

/** /admin/results/?test=<testId> (US-AD-10): one published test's results, starting with their release. */
export function TestResults({ testId }: { testId: string }) {
  const { orgId, org } = useWorkspace();
  const query = useQuery({
    queryKey: qk.orgItem(orgId, 'test-release', testId),
    queryFn: () => api<TestReleaseSummary>(`/v1/tests/${encodeURIComponent(testId)}/release`),
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
  const board = useAdminBoard(testBoardId(testId));
  const back = (
    <Link href={resultsUrl()} className={link}>
      {t('results.back')}
    </Link>
  );
  if (query.error instanceof ApiError && query.error.status === 404)
    return (
      <div className="flex flex-col items-start gap-2">
        <h1 className="font-display text-display-2 font-bold">{t('tests.notFound')}</h1>
        <p>{t('tests.notFoundBody', { org: org?.name ?? '' })}</p>
        {back}
      </div>
    );
  if (query.isError)
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="font-display text-display-2 font-bold">{t('nav.results')}</h1>
        <InlineMessage>{t('common.loadFailed')}</InlineMessage>
        {back}
      </div>
    );
  if (!query.data || board.isPending)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-12 w-80" />
        <Skeleton className="mt-6 h-32 w-full" />
      </div>
    );
  return (
    <>
      <PageHeader title={t('results.testHeading', { heading: testHeading(query.data) })} actions={back} />
      <ReleaseRegion summary={query.data} />
      <ExportRegion scope="test" refId={testId} />
      <AdminLeaderboard query={board} />
    </>
  );
}
