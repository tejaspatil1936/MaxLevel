'use client';

import type { AttemptPayload, StudentTestPage } from '@mitaoe/shared';
import { Button, Checkbox, InlineMessage, PageHeader, Skeleton } from '@mitaoe/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useId, useState } from 'react';
import { TestNotAvailable } from '@/features/student/TestNotAvailable';
import { sectionsLine, testHeading } from '@/features/student/test-heading';
import { useStudentTest } from '@/features/student/use-student-test';
import { t, type MessageKey } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { formatCount, formatMarking, formatZonedTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { checksPassed, startBlock, type StartBlock } from './device-checks';
import { attemptUrl, preflightUrl } from './links';

const BLOCKED: Record<StartBlock, MessageKey> = {
  checks: 'rules.blocked.checks',
  agreement: 'rules.blocked.agreement',
  phone: 'rules.blocked.phone',
};
const START_ERRORS = ['WINDOW_NOT_OPEN', 'WINDOW_CLOSED', 'ATTEMPT_FINISHED', 'NOT_ELIGIBLE'] as const;

/** The deadline as the student will meet it: the slot end, or minutes from their start (spec 5.5). */
function deadlineLine(p: StudentTestPage): string {
  const n = formatCount(p.durationMin);
  if (p.exam.timingMode === 'fixed')
    return t('rules.deadlineFixed', { time: formatZonedTime(p.window.end, p.timezone) });
  if (p.exam.windowEndPolicy === 'hard_close')
    return t('rules.deadlineHardClose', { n, time: formatZonedTime(p.window.end, p.timezone) });
  return t('rules.deadlineFlexible', { n });
}

/**
 * /exam/rules/?test=<testId> (EX-02, spec 7.1 step 3): duration, deadline, strikes, marking and sections, the privacy
 * note and the agreement. `Start test` waits for this tab's passed device checks and the agreement, then starts (or
 * resumes, EX-04) the attempt and opens the exam screen.
 */
export function RulesScreen() {
  const testId = useSearchParams().get('test') ?? '';
  const { query, notFound, orgId } = useStudentTest(testId);
  if (notFound) return <TestNotAvailable />;
  if (query.isError) return <InlineMessage>{t('preflight.loadFailed')}</InlineMessage>;
  if (!query.data)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-12 w-96" />
        <Skeleton className="mt-6 h-80 w-full" />
      </div>
    );
  return <Rules page={query.data} orgId={orgId} />;
}

function Rules({ page, orgId }: { page: StudentTestPage; orgId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const reasonId = useId();
  const [checksOk] = useState(() => checksPassed(page.testId));
  const [agreed, setAgreed] = useState(false);
  // One key per visit: a double press or a retry after a lost response replays the same start (API-02).
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const start = useMutation({
    mutationFn: () =>
      api<AttemptPayload>('/v1/attempts', {
        method: 'POST',
        body: { testId: page.testId },
        headers: { 'idempotency-key': idempotencyKey },
      }),
    onSuccess: (payload) => {
      // The exam screen opens on this response without asking again (PERF-03).
      queryClient.setQueryData(qk.orgItem(orgId, 'attempt', payload.attempt.id), payload);
      router.push(attemptUrl(payload.attempt.id));
    },
  });

  // The phone (second camera) is paired on this screen (F-3.13); until then such a test waits for it here.
  const block = startBlock({
    checksPassed: checksOk,
    agreed,
    secondCamera: page.exam.secondCamera,
    phoneConnected: false,
  });
  const onStart = () => {
    if (block || start.isPending) return;
    // Fullscreen needs the click's user activation, so it is requested before the API call (PR-04).
    if (page.exam.fullscreenRequired && !document.fullscreenElement)
      document.documentElement.requestFullscreen().catch(() => undefined);
    start.mutate();
  };
  const code = start.error instanceof ApiError ? start.error.code : '';
  const reason = (START_ERRORS as readonly string[]).includes(code)
    ? t(`rules.error.${code as (typeof START_ERRORS)[number]}`)
    : t('rules.error.other');

  const rules = [
    t('studentTests.duration', { n: formatCount(page.durationMin) }),
    deadlineLine(page),
    t('studentTest.maxStrikes', { n: formatCount(page.maxStrikes) }),
    t('studentTest.marking', { marking: formatMarking(page.marking) }),
    sectionsLine(page.sections),
  ];

  return (
    <>
      <PageHeader title={t('rules.title')} subtitle={testHeading(page)} />
      <ul aria-label={t('rules.list')} className="max-w-measure border-t border-rule">
        {rules.map((line) => (
          <li key={line} className="border-b border-rule py-3">
            {line}
          </li>
        ))}
      </ul>
      <p className="mt-6 flex max-w-measure items-start gap-2">
        <ShieldCheck aria-hidden size={20} className="mt-1 shrink-0 text-tick" />
        <span>{t('rules.privacy')}</span>
      </p>
      <div className="mt-8 flex max-w-measure flex-col items-start gap-4">
        <Checkbox label={t('rules.agreement')} checked={agreed} onCheckedChange={setAgreed} />
        <Button
          size="lg"
          aria-disabled={block ? 'true' : undefined}
          aria-describedby={block ? reasonId : undefined}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          onClick={onStart}
        >
          {t('rules.start')}
        </Button>
        {block ? (
          <p id={reasonId} className="text-graphite">
            {t(BLOCKED[block])}
          </p>
        ) : null}
        {!checksOk ? (
          <Link
            href={preflightUrl(page.testId)}
            className="inline-flex min-h-11 items-center font-bold text-ballpoint underline"
          >
            {t('studentTest.checkDevice')}
          </Link>
        ) : null}
        {start.isError ? <InlineMessage>{t('rules.startFailed', { reason })}</InlineMessage> : null}
      </div>
    </>
  );
}
