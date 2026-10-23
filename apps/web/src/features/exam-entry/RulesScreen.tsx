'use client';

import type { AttemptPayload, PairingReservation, StudentTestPage } from '@mitaoe/shared';
import { Button, Checkbox, InlineMessage, PageHeader, Skeleton } from '@mitaoe/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useId, useState } from 'react';
import { PairingCode, usePairingCode } from '@/features/phone/PairingCode';
import { usePhoneLink } from '@/features/phone/presence';
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

/**
 * The deadline as the student will meet it: the slot end, or minutes from their start (spec 5.5), with a standing
 * accommodation on top (OPS-07).
 */
function deadlineLine(p: StudentTestPage): string {
  const extra = p.extraMin ?? 0;
  const n = formatCount(p.durationMin + extra);
  const end = formatZonedTime(p.window.end + extra * 60_000, p.timezone);
  if (p.exam.timingMode === 'fixed') return t('rules.deadlineFixed', { time: end });
  if (p.exam.windowEndPolicy === 'hard_close') return t('rules.deadlineHardClose', { n, time: end });
  return t('rules.deadlineFlexible', { n });
}

/** A11Y-17: the standing accommodation's extra time, shown right after the duration. */
const extraTimeLine = (extraMin: number) =>
  extraMin === 1 ? t('rules.extraTimeOne') : t('rules.extraTime', { n: formatCount(extraMin) });

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
  const pairId = useId();
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

  // The phone (second camera) is paired here, before Start (PR-13): the code reserves the attempt ID the phone signs
  // in for, and Start waits until that attempt's phone presence is online.
  const { secondCamera } = page.exam;
  const pairing = usePairingCode(
    qk.orgItem(orgId, 'pairing', page.testId),
    () =>
      api<PairingReservation>(`/v1/tests/${encodeURIComponent(page.testId)}/pairing-token`, {
        method: 'POST',
        body: {},
      }),
    secondCamera,
  );
  const reservedId = pairing.code?.attemptId;
  const { phoneOnline } = usePhoneLink(
    secondCamera && reservedId ? { orgId, testId: page.testId, attemptId: reservedId } : null,
  );
  const phoneConnected = phoneOnline === true;
  const block = startBlock({ checksPassed: checksOk, agreed, secondCamera, phoneConnected });
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
    ...(page.extraMin ? [extraTimeLine(page.extraMin)] : []),
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
      <MonitoringNotice exam={page.exam} />
      {secondCamera ? (
        <section aria-labelledby={pairId} className="mt-8 max-w-measure border-t border-rule pt-6">
          <h2 id={pairId} className="text-heading-2 font-bold">
            {t('pairing.region')}
          </h2>
          <p className="mt-2 text-graphite">{t('pairing.lead')}</p>
          <div className="mt-4">
            <PairingCode pairing={pairing} timezone={page.timezone} />
          </div>
          <p role="status" className="mt-4 flex items-center gap-2 font-bold">
            <Smartphone aria-hidden size={20} className={phoneConnected ? 'text-tick' : 'text-graphite'} />
            <span>{phoneConnected ? t('pairing.status.connected') : t('pairing.status.waiting')}</span>
          </p>
        </section>
      ) : null}
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

/**
 * What the test watches, told before Start (owner request 2026-10-23): one screen, the student's own answers, a real
 * camera and, when voice detection is on, the microphone with its short review clips.
 */
function MonitoringNotice({ exam }: { exam: StudentTestPage['exam'] }) {
  const id = useId();
  const lines: MessageKey[] = [
    ...(exam.fullscreenRequired ? (['rules.monitor.display'] as const) : []),
    ...(exam.cameraRequired ? (['rules.monitor.camera'] as const) : []),
    'rules.monitor.input',
    ...(exam.audioProctoring ? (['rules.monitor.audio'] as const) : []),
  ];
  return (
    <section aria-labelledby={id} className="mt-6 max-w-measure">
      <h2 id={id} className="text-heading-3 font-bold">
        {t('rules.monitor.title')}
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-6">
        {lines.map((line) => (
          <li key={line}>{t(line)}</li>
        ))}
      </ul>
    </section>
  );
}
