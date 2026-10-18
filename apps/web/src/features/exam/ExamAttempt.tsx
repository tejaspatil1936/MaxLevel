'use client';

import type { AnswerBatchResult, AttemptPayload } from '@mitaoe/shared';
import { isFinishedAttempt } from '@mitaoe/shared';
import { Button, InlineMessage, Skeleton } from '@mitaoe/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { AccessibilityButton } from '@/features/shell/AccessibilityPanel';
import { RoleGuard } from '@/features/shell/RoleGuard';
import { testHeading } from '@/features/student/test-heading';
import { t } from '@/i18n';
import { api, ApiError, restoreClockOffset, serverClockOffset, serverNow } from '@/lib/api';
import { firebaseAuth } from '@/lib/firebase';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';
import { createAnswerSync, type AnswerSync, type PendingAnswer, type Rejection, type SyncStatus } from './answer-sync';
import { ExamTimer, StrikeTally, SyncStatusView, TimeAnnouncements, useTimeAnnouncer } from './AttemptBar';
import { examReducer, initialExamState, type ExamState } from './exam-state';
import { ExamScreen } from './ExamScreen';
import {
  clearDeviceExam,
  getDeviceAnswers,
  getDeviceExam,
  mergeDeviceAnswers,
  putDeviceAnswer,
  putDeviceExam,
} from './offline-store';
import { SubmitSummary, type SummaryRow } from './SubmitSummary';
import { CLOCK_REFRESH_MS, timeLeftText, warningText } from './time-left';

const backLink = 'inline-flex min-h-11 items-center font-bold text-ballpoint underline';

/**
 * /exam/?attempt=<attemptId> (EX-05, spec 7.1 step 4): the student's own attempt on the exam screen. Opening it again
 * (or Resume test) loads the same attempt with every saved answer and the same deadline; staff are sent to their own
 * home by the guard. When the API can't be reached at all, the exam kept on this device opens instead (US-ST-05).
 */
export function ExamAttemptRoute() {
  const attemptId = useSearchParams().get('attempt') ?? '';
  const { session } = useSession();
  const guarded = (
    <RoleGuard roles={['student']}>
      {(me) => <AttemptLoader uid={me.uid} orgId={me.orgId ?? ''} attemptId={attemptId} />}
    </RoleGuard>
  );
  return session.status === 'failed' ? <DeviceAttempt attemptId={attemptId} fallback={guarded} /> : guarded;
}

type OpenedExam = { payload: AttemptPayload; waiting: PendingAnswer[] };
type Opening = { status: 'loading' } | { status: 'ready'; exam: OpenedExam } | { status: 'missing' };

/**
 * The attempt with this device's answers merged in (EX-10, US-ST-05): from the server's payload when it came (which is
 * then kept on the device), or from the device alone when the API can't be reached. Once open it stays open, so a late
 * server answer never restarts the screen.
 */
function useOpenedExam(
  attemptId: string,
  uid: string,
  source: { payload: AttemptPayload; orgId: string } | 'device' | null,
): Opening {
  const [opening, setOpening] = useState<Opening>({ status: 'loading' });
  const ready = opening.status === 'ready';
  useEffect(() => {
    if (!source || ready || !attemptId || !uid) return;
    let live = true;
    void (async () => {
      let payload: AttemptPayload;
      if (source === 'device') {
        const kept = await getDeviceExam(attemptId, uid);
        if (!kept) return void (live && setOpening({ status: 'missing' }));
        restoreClockOffset(kept.clockOffsetMs);
        payload = kept.payload;
      } else {
        payload = source.payload;
        await putDeviceExam({ attemptId, uid, orgId: source.orgId, payload, clockOffsetMs: serverClockOffset() });
      }
      const { answers, waiting } = mergeDeviceAnswers(payload.answers, await getDeviceAnswers(attemptId));
      if (live) setOpening({ status: 'ready', exam: { payload: { ...payload, answers }, waiting } });
    })();
    return () => {
      live = false;
    };
  }, [attemptId, uid, source, ready]);
  return opening;
}

function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label={t('app.loading')} className="mx-auto max-w-admin p-6">
      <Skeleton className="h-12 w-80" />
      <Skeleton className="mt-6 h-96 w-full" />
    </div>
  );
}

/** The session could not be checked with the API: open the exam kept on this device for the signed-in user. */
function DeviceAttempt({ attemptId, fallback }: { attemptId: string; fallback: ReactNode }) {
  const [uid] = useState(() => firebaseAuth().currentUser?.uid ?? '');
  const opening = useOpenedExam(attemptId, uid, 'device');
  if (opening.status === 'ready') return <AttemptExam {...opening.exam} />;
  if (opening.status === 'missing' || !uid || !attemptId) return fallback;
  return <Loading />;
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex max-w-student flex-col items-start gap-4 px-4 py-12">
      <h1 className="font-display text-display-2 font-bold">{title}</h1>
      {children}
      <Link href="/student/" className={backLink}>
        {t('studentTest.back')}
      </Link>
    </main>
  );
}

function AttemptLoader({ uid, orgId, attemptId }: { uid: string; orgId: string; attemptId: string }) {
  const query = useQuery({
    queryKey: qk.orgItem(orgId, 'attempt', attemptId),
    queryFn: () => api<AttemptPayload>(`/v1/attempts/${encodeURIComponent(attemptId)}`),
    enabled: !!orgId && !!attemptId,
    // The rules screen leaves the start response here (PERF-03); it is used once and dropped when the exam closes,
    // so every later opening reads the saved answers afresh (EX-05).
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
  const finished = !!query.data && (isFinishedAttempt(query.data.attempt.status) || query.data.questions.length === 0);
  // A network failure (no API answer at all) opens the exam kept on this device while the query keeps retrying.
  const unreachable = query.failureCount > 0 && !(query.failureReason instanceof ApiError);
  const source = useMemo(
    () => (query.data && !finished ? { payload: query.data, orgId } : unreachable ? ('device' as const) : null),
    [query.data, finished, orgId, unreachable],
  );
  const opening = useOpenedExam(attemptId, uid, source);
  useEffect(() => {
    if (finished) void clearDeviceExam(attemptId);
  }, [finished, attemptId]);

  if (opening.status === 'ready') return <AttemptExam {...opening.exam} />;
  if (!attemptId || (query.error instanceof ApiError && query.error.status === 404))
    return (
      <Notice title={t('attempt.notFound')}>
        <p>{t('attempt.notFoundBody')}</p>
      </Notice>
    );
  if (query.isError && (opening.status === 'missing' || !unreachable))
    return (
      <Notice title={t('attempt.title')}>
        <InlineMessage>{t('attempt.loadFailed')}</InlineMessage>
      </Notice>
    );
  // The submitted screen arrives with F-3.08; until then a finished attempt says so and links home.
  if (query.data && finished)
    return (
      <Notice title={testHeading(query.data.test)}>
        <p>{t('studentTest.finished')}</p>
      </Notice>
    );
  return <Loading />;
}

/** Every saved answer's seq, so new changes are numbered after it (EX-11). */
const savedSeqs = (answers: AttemptPayload['answers']) =>
  Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, a.seq]));

/** A batch the API refused (other than throttling, a timeout or an expired sign-in) is not retried. */
const refusal = (e: unknown) =>
  e instanceof ApiError && e.status < 500 && ![401, 408, 429].includes(e.status) ? e.code : null;

function summaryRows(payload: AttemptPayload, state: ExamState): SummaryRow[] {
  const row = (name: string, ids: string[]): SummaryRow => {
    const answered = ids.filter((id) => id in state.answers).length;
    return { name, answered, notAnswered: ids.length - answered, marked: ids.filter((id) => state.marked[id]).length };
  };
  const all = payload.questions.map((q) => q.id);
  if (payload.sections.length === 0) return [row(t('attempt.summaryAll'), all)];
  const rows = payload.sections
    .map((s) =>
      row(
        s.name,
        payload.questions.filter((q) => q.sectionId === s.id).map((q) => q.id),
      ),
    )
    .filter((r) => r.answered + r.notAnswered > 0);
  const listed = new Set(payload.sections.map((s) => s.id));
  const loose = payload.questions.filter((q) => !q.sectionId || !listed.has(q.sectionId)).map((q) => q.id);
  return loose.length ? [...rows, row(t('exam.paletteOther'), loose)] : rows;
}

const TIME_CODES = new Set(['AFTER_DEADLINE', 'QUESTION_TIME_UP', 'QUESTION_NOT_SERVED']);

/** Answers the server refused, by question number: those whose time was up, then any other refusal. */
function RefusedAnswers({ rejections, ids }: { rejections: Rejection[]; ids: readonly string[] }) {
  if (rejections.length === 0) return null;
  const list = new Intl.ListFormat('en-IN', { type: 'conjunction' });
  const sentence = (refused: Rejection[], one: 'attempt.notSavedTimeOne' | 'attempt.notSavedOne') => {
    const numbers = refused.map((r) => ids.indexOf(r.questionId) + 1).sort((a, b) => a - b);
    if (numbers.length === 0) return null;
    if (numbers.length === 1) return t(one, { n: numbers[0]! });
    const many = one === 'attempt.notSavedOne' ? 'attempt.notSavedMany' : 'attempt.notSavedTimeMany';
    return t(many, { list: list.format(numbers.map(String)) });
  };
  const time = sentence(
    rejections.filter((r) => TIME_CODES.has(r.code)),
    'attempt.notSavedTimeOne',
  );
  const other = sentence(
    rejections.filter((r) => !TIME_CODES.has(r.code)),
    'attempt.notSavedOne',
  );
  return <InlineMessage>{[time, other].filter(Boolean).join(' ')}</InlineMessage>;
}

function AttemptExam({ payload, waiting }: OpenedExam) {
  const router = useRouter();
  const attemptId = payload.attempt.id;
  const ids = useMemo(() => payload.questions.map((q) => q.id), [payload]);
  const [state, dispatch] = useReducer(
    useMemo(() => examReducer(ids), [ids]),
    undefined,
    () => initialExamState(ids, payload.answers),
  );

  // Every answer change and mark goes to the sync queue with the question's whole state (EX-10).
  // Each change is kept on the device first (IndexedDB), and answers kept from before a reload are sent first.
  const [status, setStatus] = useState<SyncStatus>(
    waiting.length ? { kind: 'offline', waiting: waiting.length } : { kind: 'saved' },
  );
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const sync = useRef<AnswerSync | null>(null);
  useEffect(() => {
    const queue = createAnswerSync(
      savedSeqs(payload.answers),
      {
        send: (batch) =>
          api<AnswerBatchResult>(`/v1/attempts/${encodeURIComponent(attemptId)}/answers`, {
            method: 'PUT',
            body: batch,
          }),
        now: serverNow,
        clockOffsetMs: serverClockOffset,
        schedule: (fn, ms) => {
          const timer = setTimeout(fn, ms);
          return () => clearTimeout(timer);
        },
        onStatus: setStatus,
        refusal,
        store: (answer, kept) => void putDeviceAnswer(attemptId, answer, kept),
        onRejected: setRejections,
        online: navigator.onLine,
      },
      waiting,
    );
    sync.current = queue;
    // The browser's own network state (EX-12): offline shows at once, and coming back sends what waits.
    const connectivity = () => queue.setOnline(navigator.onLine);
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    return () => {
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
      queue.dispose();
    };
  }, [payload, waiting, attemptId]);
  const synced = useRef({ answers: state.answers, marked: state.marked });
  useEffect(() => {
    const before = synced.current;
    if (before.answers === state.answers && before.marked === state.marked) return;
    synced.current = { answers: state.answers, marked: state.marked };
    const touched = new Set([
      ...Object.keys(before.answers),
      ...Object.keys(state.answers),
      ...Object.keys(before.marked),
      ...Object.keys(state.marked),
    ]);
    for (const id of touched)
      if (before.answers[id] !== state.answers[id] || !!before.marked[id] !== !!state.marked[id])
        sync.current?.record(id, state.answers[id] ?? null, !!state.marked[id]);
  }, [state.answers, state.marked]);

  // The clock offset is measured again every minute from X-Server-Time (EX-06); any API response updates it.
  useEffect(() => {
    const id = setInterval(() => void api('/health').catch(() => undefined), CLOCK_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  const deadlineAt = payload.attempt.deadlineAt;
  const [announcement, announce] = useTimeAnnouncer();

  const [summaryOpen, setSummaryOpen] = useState(false);
  const [submitKey] = useState(() => crypto.randomUUID());
  const submit = useMutation({
    mutationFn: () =>
      api(`/v1/attempts/${encodeURIComponent(attemptId)}/submit`, {
        method: 'POST',
        body: {},
        headers: { 'idempotency-key': submitKey },
      }),
    onSuccess: () => {
      void clearDeviceExam(attemptId);
      router.replace(`/exam/submitted/?attempt=${encodeURIComponent(attemptId)}`);
    },
  });

  return (
    <>
      <ExamScreen
        exam={payload}
        title={testHeading(payload.test)}
        state={state}
        dispatch={dispatch}
        notice={<RefusedAnswers rejections={rejections} ids={ids} />}
        onTimeKey={() => announce(timeLeftText(deadlineAt - serverNow()))}
        bar={
          <>
            <SyncStatusView status={status} />
            <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2">
              <StrikeTally count={payload.attempt.strikesCount} max={payload.attempt.maxStrikes} />
              <ExamTimer deadlineAt={deadlineAt} onWarning={(m) => announce(warningText(m))} />
              <TimeAnnouncements text={announcement} />
              <AccessibilityButton />
              <Button variant="secondary" onClick={() => setSummaryOpen(true)}>
                {t('attempt.submit')}
              </Button>
            </div>
          </>
        }
      />
      <SubmitSummary
        open={summaryOpen}
        onOpenChange={(open) => {
          setSummaryOpen(open);
          if (!open) submit.reset();
        }}
        rows={summaryRows(payload, state)}
        saved={status.kind === 'saved'}
        error={submit.isError}
        onConfirm={() => (submit.isPending ? undefined : submit.mutate())}
      />
    </>
  );
}
