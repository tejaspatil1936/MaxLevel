'use client';

import type { BoardResponse } from '@mitaoe/shared';
import { InlineMessage, Skeleton } from '@mitaoe/ui';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { BoardTable } from './BoardTable';

/**
 * The admin view of one board. The results pages call it once and pass the result to `AdminLeaderboard`, so they can
 * hold their skeleton until the board has settled and show the heading and the `Leaderboard` table together. A second
 * observer mounting after the skeleton would refetch an errored board on mount, which puts the query back to pending,
 * brings the skeleton back and unmounts it again: a request loop while the feature is off (FF-03).
 */
export function useAdminBoard(boardId: string) {
  const { orgId } = useWorkspace();
  return useQuery({
    queryKey: qk.orgItem(orgId, 'leaderboard', boardId),
    queryFn: () => api<BoardResponse>(`/v1/leaderboards/${encodeURIComponent(boardId)}`),
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
}

/**
 * The `Leaderboard` section of the admin results pages (LB-05): every ranked row of the test or series board, or the
 * plan notice while `public_leaderboards` is off for the organization (FF-03).
 */
export function AdminLeaderboard({ query }: { query: UseQueryResult<BoardResponse> }) {
  const off = query.error instanceof ApiError && query.error.code === 'FEATURE_DISABLED';
  return (
    <section aria-labelledby="leaderboard-heading" className="mt-10 flex flex-col gap-3">
      <h2 id="leaderboard-heading" className="text-heading-2 font-bold">
        {t('leaderboards.table')}
      </h2>
      {off ? (
        <p>{t('plan.notIncluded')}</p>
      ) : query.isError ? (
        <InlineMessage>{t('common.loadFailed')}</InlineMessage>
      ) : query.data ? (
        <BoardTable board={query.data} />
      ) : (
        <div role="status" aria-busy="true" aria-label={t('app.loading')}>
          <Skeleton className="h-32 w-full" />
        </div>
      )}
    </section>
  );
}
