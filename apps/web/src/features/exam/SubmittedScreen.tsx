'use client';

import type { AttemptPayload, StudentResult } from '@mitaoe/shared';
import { InlineMessage, Skeleton } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { resultUrl } from '@/features/results/StudentResultScreen';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { formatZonedTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

const backLink = 'inline-flex min-h-11 items-center font-bold text-ballpoint underline';

/** When students will see the result, from the test's release setting (spec 8.1). */
function releaseLine(settings: AttemptPayload['settings'], timeZone: string): string {
  switch (settings.resultRelease) {
    case 'immediate':
      return t('submitted.immediate');
    case 'never':
      return t('submitted.never');
    case 'after_close':
      if (settings.window) return t('submitted.afterClose', { time: formatZonedTime(settings.window.end, timeZone) });
      return t('submitted.manual');
    default:
      return t('submitted.manual');
  }
}

/**
 * /exam/submitted/?attempt=<attemptId> (EX-15, EX-16, PR-10): the finished attempt's status and when results come.
 * Fullscreen is left. An attempt still in progress goes back to the exam; one that isn't the student's is not found.
 */
export function SubmittedScreen() {
  const attemptId = useSearchParams().get('attempt') ?? '';
  const router = useRouter();
  const { session } = useSession();
  const me = session.status === 'ready' ? session.me : null;
  const orgId = me?.orgId ?? '';
  const query = useQuery({
    queryKey: qk.orgItem(orgId, 'attempt-finished', attemptId),
    queryFn: () => api<AttemptPayload>(`/v1/attempts/${encodeURIComponent(attemptId)}`),
    enabled: !!orgId && !!attemptId,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
  const status = query.data?.attempt.status;
  // RES-01: the link to the result page appears whenever the result is released to the student.
  const result = useQuery({
    queryKey: qk.orgItem(orgId, 'result', attemptId),
    queryFn: () => api<StudentResult>(`/v1/student/results/${encodeURIComponent(attemptId)}`),
    enabled: !!orgId && !!attemptId && !!status && status !== 'in_progress' && status !== 'reset',
    retry: false,
  });
  useEffect(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (status === 'in_progress') router.replace(`/exam/?attempt=${encodeURIComponent(attemptId)}`);
  }, [status, attemptId, router]);

  const back = (
    <Link href="/student/" className={backLink}>
      {t('studentTest.back')}
    </Link>
  );
  if (!attemptId || (query.error instanceof ApiError && query.error.status === 404))
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="font-display text-display-2 font-bold">{t('attempt.notFound')}</h1>
        <p>{t('attempt.notFoundBody')}</p>
        {back}
      </div>
    );
  if (query.isError)
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="font-display text-display-2 font-bold">{t('attempt.title')}</h1>
        <InlineMessage>{t('attempt.loadFailed')}</InlineMessage>
        {back}
      </div>
    );
  if (!query.data || status === 'in_progress')
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-12 w-80" />
        <Skeleton className="mt-6 h-24 w-full" />
      </div>
    );

  const { attempt, settings } = query.data;
  // OPS-10: a reset attempt is kept for the record only; the student starts again from the test page.
  if (attempt.status === 'reset')
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="font-display text-display-2 font-bold">{t('attempt.reset')}</h1>
        <p>{t('attempt.resetBody')}</p>
        {back}
      </div>
    );
  const ended = attempt.status === 'terminated';
  // RES-06, OPS-04: an admin's termination names its reason; a strike termination names the maximum.
  const byAdmin = ended && !!attempt.terminationReason && attempt.terminationReason !== 'max_strikes';
  return (
    <div className="flex flex-col items-start gap-4">
      {ended ? null : <CircleCheck aria-hidden size={40} className="text-ballpoint" />}
      <h1 className="font-display text-display-2 font-bold">{ended ? t('submitted.ended') : t('submitted.title')}</h1>
      {byAdmin ? <p>{t('submitted.endedByAdmin', { reason: attempt.terminationReason ?? '' })}</p> : null}
      {ended && !byAdmin ? <p>{t('submitted.endedBody', { max: attempt.maxStrikes })}</p> : null}
      {attempt.status === 'auto_submitted' ? <p>{t('submitted.auto')}</p> : null}
      <p>{releaseLine(settings, me?.org?.timezone ?? 'Asia/Kolkata')}</p>
      {result.data?.release === 'released' ? (
        <Link href={resultUrl(attemptId)} className={backLink}>
          {t('submitted.seeResult')}
        </Link>
      ) : null}
      {back}
    </div>
  );
}
