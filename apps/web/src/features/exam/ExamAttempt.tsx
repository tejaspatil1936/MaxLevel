'use client';

import type { AnswerBatchResult, AttemptPayload } from '@mitaoe/shared';
import { isFinishedAttempt, questionTimeUpAt } from '@mitaoe/shared';
import { AcknowledgeDialog, Button, cx, InlineMessage, Skeleton } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { PhoneStatus, ReconnectPhone, usePhoneWatch } from '@/features/phone/PhoneWatch';
import { useLaptopPresence } from '@/features/phone/presence';
import { CameraPreview } from '@/features/proctoring/CameraPreview';
import { useCameraWatch } from '@/features/proctoring/useCameraWatch';
import { AccessibilityButton } from '@/features/shell/AccessibilityPanel';
import { RoleGuard } from '@/features/shell/RoleGuard';
import { testHeading } from '@/features/student/test-heading';
import { t } from '@/i18n';
import { api, ApiError, restoreClockOffset, serverClockOffset, serverNow } from '@/lib/api';
import { firebaseAuth } from '@/lib/firebase';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';
import { useDeadlineSignal } from './deadline-signal';
import { createAnswerSync, type AnswerSync, type PendingAnswer, type Rejection, type SyncStatus } from './answer-sync';
import { ExamTimer, StrikeTally, SyncStatusView, TimeAnnouncements, useTimeAnnouncer } from './AttemptBar';
import { installFocusWrap } from './focus-wrap';
import { installLockdown } from './lockdown';
import { examReducer, initialExamState, resumeTimedState, type ExamState } from './exam-state';
import { ExamScreen } from './ExamScreen';
import {
  clearDeviceExam,
  getDeviceAnswers,
  getDeviceExam,
  mergeDeviceAnswers,
  putDeviceAnswer,
  putDeviceDeadline,
  putDeviceExam,
} from './offline-store';
import { createServeTracker, type ServeTracker } from './question-serves';
import { StrikeWarning } from './StrikeWarning';
import { QuestionTimer } from './QuestionTimer';
import { createSubmission, type Submission, type SubmitPhase } from './submission';
import { SubmitSummary, type SummaryRow } from './SubmitSummary';
import { CLOCK_REFRESH_MS, timeLeftText, warningText } from './time-left';
import { useProctorReporter } from './useProctorReporter';

const backLink = 'inline-flex min-h-11 items-center font-bold text-ballpoint underline';
/** This browser's localStorage, shared by its tabs, or null where the browser blocks it. */
const deviceStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
const submittedUrl = (attemptId: string) => `/exam/submitted/?attempt=${encodeURIComponent(attemptId)}`;

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
  // OPS-10: a reset attempt is kept for the record only; the student starts again from the test page.
  const reset = query.data?.attempt.status === 'reset';
  const finished =
    !!query.data && !reset && (isFinishedAttempt(query.data.attempt.status) || query.data.questions.length === 0);
  // A network failure (no API answer at all) opens the exam kept on this device while the query keeps retrying.
  const unreachable = query.failureCount > 0 && !(query.failureReason instanceof ApiError);
  const source = useMemo(
    () =>
      query.data && !finished && !reset ? { payload: query.data, orgId } : unreachable ? ('device' as const) : null,
    [query.data, finished, reset, orgId, unreachable],
  );
  const opening = useOpenedExam(attemptId, uid, source);
  const router = useRouter();
  // A finished attempt opens the submitted screen. A terminated one keeps the answers waiting on the device, so they
  // are sent if it is reinstated (OPS-04); the submitted screen forgets those of a submitted one.
  const terminated = query.data?.attempt.status === 'terminated';
  useEffect(() => {
    if (!finished) return;
    if (!terminated) void clearDeviceExam(attemptId);
    router.replace(submittedUrl(attemptId));
  }, [finished, terminated, attemptId, router]);
  useEffect(() => {
    if (reset) void clearDeviceExam(attemptId);
  }, [reset, attemptId]);

  if (reset)
    return (
      <Notice title={t('attempt.reset')}>
        <p>{t('attempt.resetBody')}</p>
      </Notice>
    );
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

/** The API says the attempt is finished (submitted, auto-submitted or ended), so nothing more is sent. */
const attemptFinished = (e: unknown) => e instanceof ApiError && e.code === 'ATTEMPT_FINISHED';

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

/**
 * The extra-time notice (OPS-06): a status whose whole text is the notice, with Dismiss beside it, outside the status.
 * The status stays in the page while empty, so screen readers announce the notice when it arrives; it never takes
 * focus or opens a dialog.
 */
function ExtensionNotice({ notice, onDismiss }: { notice: string | null; onDismiss: () => void }) {
  // Dismiss removes its own button, so focus goes back to where it came from, or to the exam's main region (A11Y-03).
  const before = useRef<HTMLElement | null>(null);
  const dismiss = () => {
    const back = before.current?.isConnected ? before.current : document.getElementById('main');
    back?.focus();
    onDismiss();
  };
  return (
    <div
      className={
        notice
          ? 'flex flex-wrap items-center justify-between gap-3 rounded-panel border border-ballpoint bg-ballpoint-wash px-4 py-2'
          : 'contents'
      }
    >
      <p role="status" className={cx(notice ? 'font-bold' : 'sr-only')}>
        {notice ?? ''}
      </p>
      {notice ? (
        <Button
          variant="secondary"
          onFocus={(e) => {
            before.current = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null;
          }}
          onClick={dismiss}
        >
          {t('attempt.dismissNotice')}
        </Button>
      ) : null}
    </div>
  );
}

function AttemptExam({ payload, waiting }: OpenedExam) {
  const router = useRouter();
  const attemptId = payload.attempt.id;
  const ids = useMemo(() => payload.questions.map((q) => q.id), [payload]);
  // Per-question timers (Q-11): forward-only, and a timed question locks when its time, from its first serve, ends.
  const timed = payload.settings.questionTimeMode !== 'none';
  const limits = useMemo(() => new Map(payload.questions.map((q) => [q.id, q.timeLimitSec])), [payload]);
  const timeUpAt = (id: string, at: number) => {
    const limit = limits.get(id);
    return limit === undefined ? undefined : questionTimeUpAt(at, limit);
  };
  const [state, dispatch] = useReducer(
    useMemo(() => examReducer(ids), [ids]),
    undefined,
    () => {
      const opened = initialExamState(ids, payload.answers);
      return timed ? resumeTimedState(opened, ids, payload.questionServedAt, timeUpAt, serverNow()) : opened;
    },
  );

  // Every answer change and mark goes to the sync queue with the question's whole state (EX-10).
  // Each change is kept on the device first (IndexedDB), and answers kept from before a reload are sent first.
  const [status, setStatus] = useState<SyncStatus>(
    waiting.length ? { kind: 'offline', waiting: waiting.length } : { kind: 'saved' },
  );
  const [rejections, setRejections] = useState<Rejection[]>([]);
  // A finished attempt (submitted here, by the auto-submit task, or ended) opens the submitted screen, which forgets
  // the device's copy unless the attempt was terminated (its waiting answers stay for a reinstate, OPS-04).
  const finished = useRef(() => {});
  useEffect(() => {
    finished.current = () => router.replace(submittedUrl(attemptId));
  }, [attemptId, router]);
  // Proctoring reports (PR-08): lockdown (F-3.11), the camera (F-3.12) and the phone (F-3.13) call `proctor.report`.
  // A strike warns at once; the strike that reaches the maximum ends the attempt and opens the submitted screen.
  const proctor = useProctorReporter(payload, {
    onFinished: () => finished.current(),
    final: (e) => {
      if (attemptFinished(e)) finished.current();
      return refusal(e) !== null;
    },
  });
  // Browser lockdown (PR-04 to PR-06): fullscreen, focus, developer tools keys and the clipboard, reported as above.
  const { report } = proctor;
  const { fullscreenRequired, devtoolsPolicy } = payload.settings;
  // Outside fullscreen when it is required (opened, reloaded or come back to), the screen is blocked until the student
  // goes back in (PR-04); the time the page unloaded is kept in this browser, so a long absence counts even when the
  // exam is opened again in a new tab (PR-05).
  const [fullscreenNeeded, setFullscreenNeeded] = useState(false);
  useEffect(
    () =>
      installLockdown({
        win: window,
        doc: document,
        report,
        fullscreenRequired,
        devtoolsPolicy,
        now: serverNow,
        storage: deviceStorage(),
        awayKey: `mitaoe.exam.away.${attemptId}`,
        onFullscreenNeeded: setFullscreenNeeded,
      }),
    [report, fullscreenRequired, devtoolsPolicy, attemptId],
  );
  const enterFullscreen = () =>
    void document.documentElement.requestFullscreen?.().catch(() => setFullscreenNeeded(true));
  // Tab past either end wraps round inside the page, so the keyboard never blurs the window (PR-05, A11Y-03).
  useEffect(() => installFocusWrap(document), []);
  // The laptop camera (PR-01, PR-02): on for the whole exam, faces counted on the device, incidents reported as above.
  const { cameraRequired } = payload.settings;
  const cameraStream = useCameraWatch(cameraRequired, report);
  // Presence in Realtime Database (DATA-06): this laptop's own record, and with a second camera the phone's, whose
  // disconnection brings up the reconnect overlay and then a strike (PR-16) unless our database is down (REL-05).
  const { session } = useSession();
  const me = session.status === 'ready' ? session.me : null;
  const orgId = me?.orgId ?? null;
  const testId = payload.attempt.testId;
  const presenceOf = useMemo(() => (orgId ? { orgId, testId, attemptId } : null), [orgId, testId, attemptId]);
  useLaptopPresence(presenceOf);
  const { secondCamera } = payload.settings;
  const phone = usePhoneWatch(secondCamera ? presenceOf : null, report);
  // Each timed question is reported as served when it shows (Q-12); until the server answers, its countdown runs from
  // the time it showed here (QuestionTimer).
  const [served, setServed] = useState<Record<string, number>>(payload.questionServedAt);
  const serves = useRef<ServeTracker | null>(null);
  useEffect(() => {
    const tracker = createServeTracker({
      send: (questionId) =>
        api<{ servedAt: number }>(`/v1/attempts/${encodeURIComponent(attemptId)}/navigate`, {
          method: 'POST',
          body: { questionId },
        }),
      schedule: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      },
      onServed: (id, at) => setServed((now) => (now[id] === at ? now : { ...now, [id]: at })),
      final: (e) => {
        if (attemptFinished(e)) finished.current();
        return refusal(e) !== null;
      },
    });
    serves.current = tracker;
    return () => tracker.dispose();
  }, [attemptId]);
  const currentId = ids[state.index]!;
  const currentTimed = timed && limits.get(currentId) !== undefined;
  useEffect(() => {
    if (currentTimed && !(currentId in payload.questionServedAt)) serves.current?.serve(currentId);
  }, [currentId, currentTimed, payload]);
  const currentLimit = timed ? limits.get(currentId) : undefined;

  const sync = useRef<AnswerSync | null>(null);
  useEffect(() => {
    const queue = createAnswerSync(
      savedSeqs(payload.answers),
      {
        // An answer goes after the serve report of its question (Q-12).
        send: async (batch) => {
          await serves.current?.settled();
          return api<AnswerBatchResult>(`/v1/attempts/${encodeURIComponent(attemptId)}/answers`, {
            method: 'PUT',
            body: batch,
          }).catch((e: unknown) => {
            if (attemptFinished(e)) finished.current();
            throw e;
          });
        },
        now: serverNow,
        clockOffsetMs: serverClockOffset,
        schedule: (fn, ms) => {
          const timer = setTimeout(fn, ms);
          return () => clearTimeout(timer);
        },
        onStatus: setStatus,
        // A finished attempt refuses the batch, but its answers keep waiting on the device (OPS-04).
        refusal: (e) => (attemptFinished(e) ? null : refusal(e)),
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
  // OPS-06: extra time reaches the screen through the attempt's signal record, with its notice.
  const extension = useDeadlineSignal(orgId, attemptId, payload.attempt.deadlineAt);
  const deadlineAt = extension.deadlineAt;
  const { adopt } = extension;
  // The device's copy follows a later deadline, so a reload while offline counts down to it (US-ST-05).
  const sentDeadline = useRef(deadlineAt);
  useEffect(() => {
    sentDeadline.current = deadlineAt;
    if (deadlineAt > payload.attempt.deadlineAt) void putDeviceDeadline(attemptId, deadlineAt);
  }, [deadlineAt, attemptId, payload]);
  const [announcement, announce] = useTimeAnnouncer();

  const [summaryOpen, setSummaryOpen] = useState(false);
  const [submitKey] = useState(() => crypto.randomUUID());
  const [phase, setPhase] = useState<SubmitPhase>('idle');
  const submission = useRef<Submission | null>(null);
  useEffect(() => {
    const s = createSubmission({
      flush: () => sync.current?.flush() ?? Promise.resolve(),
      send: (reason) =>
        api(`/v1/attempts/${encodeURIComponent(attemptId)}/submit`, {
          method: 'POST',
          // A time-up names the deadline this screen counted down to; the API refuses it if that moved (OPS-06).
          body: reason ? { reason, deadlineAt: sentDeadline.current } : {},
          headers: { 'idempotency-key': submitKey },
        }),
      retryable: (e) => !(e instanceof ApiError) || e.status >= 500 || [408, 429].includes(e.status),
      finished: attemptFinished,
      notYet: (e) =>
        e instanceof ApiError && e.code === 'DEADLINE_NOT_REACHED' && typeof e.details.deadlineAt === 'number'
          ? e.details.deadlineAt
          : null,
      onDeadline: adopt,
      schedule: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      },
      onPhase: setPhase,
      onDone: () => finished.current(),
    });
    submission.current = s;
    // Coming back online sends the waiting submit at once (EX-15).
    const online = () => s.retryNow();
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('online', online);
      s.dispose();
    };
  }, [attemptId, submitKey, adopt]);
  const submitOffline = phase === 'offline' || (phase === 'saving' && status.kind === 'offline');

  return (
    <>
      <ExamScreen
        exam={payload}
        title={testHeading(payload.test)}
        state={state}
        dispatch={dispatch}
        forwardOnly={timed}
        lockdown
        camera={cameraRequired ? <CameraPreview stream={cameraStream} /> : undefined}
        questionTimer={
          currentLimit !== undefined && !state.locked[currentId] ? (
            <QuestionTimer
              key={currentId}
              servedAt={served[currentId]}
              timeLimitSec={currentLimit}
              onTimeUp={() => dispatch({ type: 'lock' })}
            />
          ) : null
        }
        notice={
          <>
            <ExtensionNotice notice={extension.notice} onDismiss={extension.dismiss} />
            <RefusedAnswers rejections={rejections} ids={ids} />
            {submitOffline && !summaryOpen ? (
              <p role="status" className="font-bold text-redpen">
                {t('attempt.submitOffline')}
              </p>
            ) : null}
          </>
        }
        onTimeKey={() => announce(timeLeftText(deadlineAt - serverNow()))}
        bar={
          <>
            <SyncStatusView status={status} />
            <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2">
              {secondCamera ? <PhoneStatus link={phone.link} /> : null}
              <StrikeTally count={proctor.strikes} max={payload.attempt.maxStrikes} />
              <ExamTimer
                deadlineAt={deadlineAt}
                onWarning={(m) => announce(warningText(m))}
                onTimeUp={() => void submission.current?.submit('time_up')}
              />
              <TimeAnnouncements text={announcement} />
              <AccessibilityButton inExam />
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
          // A submit already sent can't be called back; anything waiting stops when the summary closes.
          if (!open && (phase === 'sending' || phase === 'done')) return;
          if (!open) submission.current?.cancel();
          setSummaryOpen(open);
        }}
        rows={summaryRows(payload, state)}
        saved={status.kind === 'saved'}
        phase={phase}
        offline={submitOffline}
        onConfirm={() => void submission.current?.submit()}
      />
      {secondCamera && presenceOf ? (
        <ReconnectPhone open={phone.reconnect} attempt={presenceOf} timezone={me?.org?.timezone ?? null} />
      ) : null}
      <StrikeWarning
        warning={proctor.warning}
        max={payload.attempt.maxStrikes}
        onAcknowledge={(type) => {
          proctor.acknowledge();
          // The blocking overlay of PR-04: acknowledging a fullscreen exit enters fullscreen again.
          if (type === 'fullscreen_exit') enterFullscreen();
        }}
      />
      <AcknowledgeDialog
        open={fullscreenRequired && fullscreenNeeded && !proctor.warning}
        title={t('fullscreen.title')}
        actionLabel={t('strike.returnFullscreen')}
        onAction={enterFullscreen}
      >
        <p>{t('fullscreen.body')}</p>
      </AcknowledgeDialog>
    </>
  );
}
