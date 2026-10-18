'use client';

import type { BoardResponse, StudentLeaderboards } from '@mitaoe/shared';
import { EmptyState, InlineMessage, PageHeader, Skeleton } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';
import { BoardTable } from './BoardTable';

const link = 'inline-flex min-h-11 items-center font-bold text-ballpoint underline';
const LIST_URL = '/student/leaderboards/';
export const boardUrl = (boardId: string) => `${LIST_URL}?board=${encodeURIComponent(boardId)}`;
/** No retry for a refusal the server meant (404 not open, 403 feature off). */
const retry = (n: number, e: Error) => !(e instanceof ApiError && e.status < 500) && n < 2;

function useOrgId() {
  const { session } = useSession();
  return session.status === 'ready' ? (session.me.orgId ?? '') : '';
}

const loading = (
  <div role="status" aria-busy="true" aria-label={t('app.loading')}>
    <Skeleton className="h-40 w-full" />
  </div>
);

/** /student/leaderboards/ (US-ST-09, LB-04): the boards open to the student. */
function OpenBoards() {
  const orgId = useOrgId();
  const query = useQuery({
    queryKey: qk.orgList(orgId, 'student-leaderboards'),
    queryFn: () => api<StudentLeaderboards>('/v1/student/leaderboards'),
    enabled: !!orgId,
    retry,
  });
  const off = query.error instanceof ApiError && query.error.code === 'FEATURE_DISABLED';
  const boards = query.data?.boards;
  return (
    <>
      <PageHeader title={t('leaderboards.title')} />
      {off ? (
        <p>{t('leaderboards.off')}</p>
      ) : query.isError ? (
        <InlineMessage>{t('common.loadFailed')}</InlineMessage>
      ) : !boards ? (
        loading
      ) : boards.length === 0 ? (
        <EmptyState
          message={t('leaderboards.empty')}
          action={
            <Link href="/student/" className={link}>
              {t('leaderboards.emptyAction')}
            </Link>
          }
        />
      ) : (
        <ul aria-label={t('leaderboards.list')} className="flex flex-col gap-3">
          {boards.map((b) => (
            <li
              key={b.boardId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-rule bg-surface p-4"
            >
              <Link href={boardUrl(b.boardId)} className={link}>
                {b.title}
              </Link>
              <span className="text-graphite">{t(`leaderboards.kind.${b.kind}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** /student/leaderboards/?board=<boardId> (LB-05, US-ST-09): the top 50 and the student's own row, highlighted. */
function StudentBoard({ boardId }: { boardId: string }) {
  const orgId = useOrgId();
  const query = useQuery({
    queryKey: qk.orgItem(orgId, 'leaderboard', boardId),
    queryFn: () => api<BoardResponse>(`/v1/leaderboards/${encodeURIComponent(boardId)}`),
    enabled: !!orgId,
    retry,
  });
  const back = (
    <Link href={LIST_URL} className={link}>
      {t('leaderboards.back')}
    </Link>
  );
  const closed = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 403);
  if (closed)
    return (
      <div className="flex flex-col items-start gap-2">
        <h1 className="font-display text-display-2 font-bold">{t('leaderboards.notAvailable')}</h1>
        <p>{t('leaderboards.notAvailableText')}</p>
        {back}
      </div>
    );
  if (query.isError)
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="font-display text-display-2 font-bold">{t('leaderboards.title')}</h1>
        <InlineMessage>{t('common.loadFailed')}</InlineMessage>
        {back}
      </div>
    );
  const board = query.data;
  if (!board) return loading;
  return (
    <>
      <PageHeader title={t('leaderboards.boardHeading', { title: board.title })} actions={back} />
      <div className="flex flex-col gap-4">
        <p>
          {board.me
            ? t('leaderboards.ownRank', { rank: board.me.rank, total: board.total })
            : t('leaderboards.notOnBoard')}
        </p>
        <BoardTable board={board} />
      </div>
    </>
  );
}

/** The list, or one board with `?board=` (WEB-02). */
export function StudentLeaderboardsScreen() {
  const boardId = useSearchParams().get('board');
  return boardId ? <StudentBoard key={boardId} boardId={boardId} /> : <OpenBoards />;
}
