'use client';

import type { StudentResult } from '@mitaoe/shared';
import { InlineMessage, Skeleton, Table } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { testHeading } from '@/features/student/test-heading';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { formatScore, formatZonedTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';
import { AnswerReview } from './AnswerReview';

const link = 'inline-flex min-h-11 items-center font-bold text-ballpoint underline';
const h1 = 'font-display text-display-2 font-bold';

export const resultUrl = (attemptId: string) => `/student/result/?attempt=${encodeURIComponent(attemptId)}`;

const timeTaken = (sec: number) =>
  sec < 60
    ? sec === 1
      ? t('result.second')
      : t('result.seconds', { n: sec })
    : Math.floor(sec / 60) === 1
      ? t('result.minute')
      : t('result.minutes', { n: Math.floor(sec / 60) });
const strikes = (n: number) =>
  n === 0 ? t('result.noStrikes') : n === 1 ? t('result.oneStrike') : t('result.strikes', { n });

/** Released results (RES-02): score, percentage, time and strikes, rank, section scores and the full review. */
function Released({ r }: { r: StudentResult }) {
  const sections = r.sections ?? [];
  return (
    <>
      <section aria-label={t('result.region')} className="flex flex-col gap-2 rounded-panel border border-rule p-5">
        <p className="font-display text-display-1 font-extrabold tabular">
          {t('result.score', { score: formatScore(r.score ?? 0), max: formatScore(r.max ?? 0) })}
        </p>
        <p className="text-heading-3 font-bold">{t('result.pct', { pct: formatScore(r.pct ?? 0) })}</p>
        <p>{t('result.timeStrikes', { time: timeTaken(r.durationSec ?? 0), strikes: strikes(r.strikesCount) })}</p>
        {r.rank ? <p>{t('result.rank', { rank: r.rank.rank, total: r.rank.total })}</p> : null}
      </section>
      {sections.length ? (
        <Table
          caption={t('result.sections')}
          rows={sections}
          rowKey={(s) => s.sectionId ?? 'none'}
          columns={[
            { key: 'name', header: t('result.colSection'), cell: (s) => s.name },
            {
              key: 'score',
              header: t('result.colScore'),
              cell: (s) => t('result.score', { score: formatScore(s.score), max: formatScore(s.max) }),
            },
            { key: 'correct', header: t('result.colCorrect'), align: 'end', cell: (s) => s.correct },
            { key: 'wrong', header: t('result.colWrong'), align: 'end', cell: (s) => s.incorrect },
            { key: 'skipped', header: t('result.colSkipped'), align: 'end', cell: (s) => s.unanswered },
          ]}
        />
      ) : null}
      {r.detail === 'full' && r.review ? (
        <>
          <a href="#answer-review" className={link}>
            {t('result.reviewLink')}
          </a>
          <AnswerReview review={r.review} />
        </>
      ) : null}
    </>
  );
}

/**
 * /student/result/?attempt=<attemptId> (US-ST-07, RES-01 to RES-06): the student's own finished attempt as far as
 * the test's release state allows. Nothing of the score shows unless the results are released.
 */
export function StudentResultScreen() {
  const attemptId = useSearchParams().get('attempt') ?? '';
  const { session } = useSession();
  const me = session.status === 'ready' ? session.me : null;
  const orgId = me?.orgId ?? '';
  const zone = me?.org?.timezone ?? 'Asia/Kolkata';
  const query = useQuery({
    queryKey: qk.orgItem(orgId, 'result', attemptId),
    queryFn: () => api<StudentResult>(`/v1/student/results/${encodeURIComponent(attemptId)}`),
    enabled: !!orgId && !!attemptId,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
  const back = (
    <Link href="/student/" className={link}>
      {t('result.back')}
    </Link>
  );
  const error = query.error instanceof ApiError ? query.error : null;
  if (!attemptId || error?.status === 404)
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className={h1}>{t('result.notFound')}</h1>
        <p>{t('result.notFoundBody')}</p>
        {back}
      </div>
    );
  if (error?.code === 'ATTEMPT_IN_PROGRESS')
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className={h1}>{t('result.title')}</h1>
        <p>{t('result.inProgress')}</p>
        <Link href={`/exam/?attempt=${encodeURIComponent(attemptId)}`} className={link}>
          {t('result.resume')}
        </Link>
        {back}
      </div>
    );
  if (query.isError)
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className={h1}>{t('result.title')}</h1>
        <InlineMessage>{t('common.loadFailed')}</InlineMessage>
        {back}
      </div>
    );
  const r = query.data;
  if (!r)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-12 w-80" />
        <Skeleton className="mt-6 h-32 w-full" />
      </div>
    );
  return (
    <div className="flex flex-col items-start gap-6 [&>*]:w-full">
      <h1 className={h1}>{testHeading(r)}</h1>
      {r.status === 'terminated' ? (
        <section className="flex flex-col gap-1" aria-labelledby="result-ended">
          <h2 id="result-ended" className="text-heading-2 font-bold">
            {t('result.ended')}
          </h2>
          <p>
            {r.terminationReason === 'max_strikes' || !r.terminationReason
              ? t('result.endedStrikes', { max: r.maxStrikes })
              : t('result.endedReason', { reason: r.terminationReason })}
          </p>
        </section>
      ) : null}
      {r.release === 'released' ? <Released r={r} /> : null}
      {r.release === 'pending' ? (
        <p>
          {r.resultRelease === 'after_close' && r.windowEnd !== null
            ? t('result.pendingAfterClose', { time: formatZonedTime(r.windowEnd, zone) })
            : t('result.pendingManual')}
        </p>
      ) : null}
      {r.release === 'never' ? <p>{t('result.never')}</p> : null}
      {r.release === 'withdrawn' ? (
        <section className="flex flex-col gap-1" aria-labelledby="result-withdrawn">
          <h2 id="result-withdrawn" className="text-heading-2 font-bold">
            {t('result.withdrawnTitle')}
          </h2>
          <p>{t('result.withdrawnBody')}</p>
        </section>
      ) : null}
      <div>{back}</div>
    </div>
  );
}
