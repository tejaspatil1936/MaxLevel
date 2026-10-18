'use client';

import type { BoardResponse } from '@mitaoe/shared';
import { InlineMessage, Skeleton } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { BoardTable } from './BoardTable';

/**
 * The `Leaderboard` section of the admin results pages (LB-05): every ranked row of the test or series board, or the
 * plan notice while `public_leaderboards` is off for the organization (FF-03).
 */
export function AdminLeaderboard({ boardId }: { boardId: string }) {
  const { orgId } = useWorkspace();
  const query = useQuery({
    queryKey: qk.orgItem(orgId, 'leaderboard', boardId),
    queryFn: () => api<BoardResponse>(`/v1/leaderboards/${encodeURIComponent(boardId)}`),
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
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
