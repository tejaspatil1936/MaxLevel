'use client';

import type { HistoryScoreState, HistoryTest, StudentHistory } from '@mitaoe/shared';
import { EmptyState, InlineMessage, PageHeader, Skeleton, Table } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { FINISHED_STATUS } from '@/features/student/test-heading';
import { t, type MessageKey } from '@/i18n';
import { api } from '@/lib/api';
import { formatDay, formatScore } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';
import { resultUrl } from './StudentResultScreen';

const link = 'inline-flex min-h-11 items-center font-bold text-ballpoint underline';

/** RES-04: the words of a score the history may not show. */
const SCORE_WORDS: Record<Exclude<HistoryScoreState, 'shown'>, MessageKey> = {
  hidden: 'history.score.hidden',
  pending: 'history.score.pending',
  withdrawn: 'history.score.withdrawn',
  never: 'history.score.never',
};

const scoreCell = (r: HistoryTest) =>
  r.scoreState === 'shown'
    ? t('result.score', { score: formatScore(r.score ?? 0), max: formatScore(r.max ?? 0) })
    : t(SCORE_WORDS[r.scoreState]);

/**
 * /student/history/ (US-ST-08, RES-04): every finished attempt by series and day, each linking to its result, with the
 * score only where the server says it may be shown.
 */
export function StudentHistoryScreen() {
  const { session } = useSession();
  const orgId = session.status === 'ready' ? (session.me.orgId ?? '') : '';
  const query = useQuery({
    queryKey: qk.orgList(orgId, 'student-history'),
    queryFn: () => api<StudentHistory>('/v1/student/history'),
    enabled: !!orgId,
  });
  const d = query.data;
  return (
    <>
      <PageHeader title={t('history.title')} />
      {query.isError ? <InlineMessage>{t('common.loadFailed')}</InlineMessage> : null}
      {!d ? (
        query.isError ? null : (
          <div role="status" aria-busy="true" aria-label={t('app.loading')}>
            <Skeleton className="h-40 w-full" />
          </div>
        )
      ) : d.series.length === 0 ? (
        <EmptyState
          message={t('history.empty')}
          action={
            <Link href="/student/" className={link}>
              {t('history.emptyAction')}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-10">
          {d.series.map((s) => (
            <section key={s.id} aria-labelledby={`history-${s.id}`} className="flex flex-col gap-3">
              <h2 id={`history-${s.id}`} className="text-heading-2 font-bold">
                {s.title}
              </h2>
              <Table
                caption={s.title}
                rows={s.tests}
                rowKey={(r) => r.attemptId}
                columns={[
                  { key: 'day', header: t('history.colDay'), cell: (r) => r.dayLabel ?? '' },
                  {
                    key: 'test',
                    header: t('history.colTest'),
                    cell: (r) => (
                      <Link href={resultUrl(r.attemptId)} className="font-bold text-ballpoint underline">
                        {r.title}
                      </Link>
                    ),
                  },
                  { key: 'date', header: t('history.colDate'), cell: (r) => formatDay(r.scheduledDate) },
                  { key: 'status', header: t('history.colStatus'), cell: (r) => t(FINISHED_STATUS[r.status]) },
                  { key: 'score', header: t('history.colScore'), cell: scoreCell },
                ]}
              />
            </section>
          ))}
        </div>
      )}
    </>
  );
}
