import {
  accommodationExtraSec,
  answeredCount,
  answerVerdict,
  attemptDeadline,
  autoSubmitTask,
  releaseResultsTask,
  canStart,
  dayLabels,
  drawAttempt,
  isEligible,
  isFinishedAttempt,
  liveRecordPath,
  questionTimeLimit,
  strikeVerdict,
  type AnswerBatch,
  type AnswerBatchResult,
  type AnswerRecord,
  type AttemptEventList,
  type AttemptEventReport,
  type AttemptEventResult,
  type AttemptPayload,
  type AttemptRecord,
  type Clock,
  type Settings,
  type TaskQueue,
} from '@mitaoe/shared';
import type { Database } from 'firebase-admin/database';
import type { Data } from '../data';
import type { SeriesRecord } from '../data/series';
import type { StudentRecord } from '../data/students';
import type { TestRecord } from '../data/tests';
import { AppError, notFound } from '../errors';
import { asEligibility } from './eligibility';
import { attemptGrader } from './grading';
import type { PublishedQuestions, PublishedTestCache } from './published-tests';
import { liveMirror, startedRecord } from './live-mirror';
import { withinLimit, type WarnLogger } from './rtdb-writes';

const REFUSALS = {
  WINDOW_NOT_OPEN: "This test hasn't opened yet.",
  WINDOW_CLOSED: 'The last start time for this test has passed.',
} as const;

/**
 * The checks of a start (EX-03, SER-08), shared with phone pairing before Start (PR-13): a scheduled test with its
 * settings snapshot (else 404), in an active series (else 404), for a student its stored series and test rules admit
 * (else 403 NOT_ELIGIBLE). Returns the test's settings.
 */
export function admitStudent(
  test: TestRecord | null,
  series: SeriesRecord | null,
  student: StudentRecord | null,
): { settings: Settings; student: StudentRecord } {
  if (!test || test.status !== 'scheduled' || !test.resolved) throw notFound('Test');
  if (!series || series.status !== 'active') throw notFound('Test');
  if (!student || !isEligible(asEligibility(student), series.eligibility, test.eligibility))
    throw new AppError(403, 'NOT_ELIGIBLE', "This test isn't open to you.");
  return { settings: test.resolved, student };
}

/**
 * The start window of the test's timing mode at `now` (spec 5.5): 409 WINDOW_NOT_OPEN or WINDOW_CLOSED outside it.
 * After a reset it runs to the window end, past the late-entry cutoff (OPS-10, DECISIONS Q25).
 */
export function assertStartWindow(settings: Settings, now: number, afterReset = false): void {
  const open = canStart(settings, now, { afterReset });
  if (!open.ok) throw new AppError(409, open.code, REFUSALS[open.code]);
}

const finishedError = () =>
  new AppError(409, 'ATTEMPT_FINISHED', 'This attempt is finished and takes no more answers.');

export interface AttemptDeps {
  data: Data;
  clock: Clock;
  queue: TaskQueue;
  rtdb: Database;
  published: PublishedTestCache;
  /** Where failed or late Realtime Database writes are logged (REL-05). */
  log: WarnLogger;
}

/**
 * The attempt engine's start and resume (EX-03, EX-04, EX-05, Q-06, SER-08, PERF-03): one exam payload per call,
 * built from the attempt's stored draw and the cached published questions, never with an answer key (DATA-05).
 */
export function attemptService(deps: AttemptDeps) {
  const { data, clock, queue, rtdb, published, log } = deps;
  const grader = attemptGrader(deps);
  const live = liveMirror(rtdb, log);

  /** Everything the exam screen needs in one response (PERF-03); the response schema strips any answer key. */
  function payload(
    test: TestRecord,
    dayLabel: string | null,
    settings: Settings,
    set: PublishedQuestions,
    attempt: AttemptRecord,
    answers: Record<string, AnswerRecord>,
  ): AttemptPayload {
    const sectionOf = new Map(attempt.draw.sections.flatMap((s) => s.questionIds.map((id) => [id, s.sectionId])));
    const questions = attempt.draw.questionIds.flatMap((id) => {
      const q = set.byId.get(id);
      if (!q) return [];
      const options = new Map(q.options.map((o) => [o.id, o]));
      const timeLimitSec = questionTimeLimit(settings, q);
      return [
        {
          id,
          sectionId: sectionOf.get(id) ?? null,
          prompt: q.prompt,
          images: q.images,
          options: (attempt.draw.optionOrder[id] ?? []).flatMap((o) => (options.has(o) ? [options.get(o)!] : [])),
          ...(q.marks !== undefined ? { marks: q.marks } : {}),
          ...(q.negativeMarks !== undefined ? { negativeMarks: q.negativeMarks } : {}),
          ...(timeLimitSec !== undefined ? { timeLimitSec } : {}),
        },
      ];
    });
    const paths = questions.flatMap((q) => [
      ...q.images.map((i) => i.path),
      ...q.options.flatMap((o) => (o.image ? [o.image.path] : [])),
    ]);
    return {
      test: { id: test.id, title: test.title, dayLabel },
      durationMin: settings.durationMin,
      sections: test.sections.map((s) => ({
        id: s.id,
        name: s.name,
        order: s.order,
        ...(s.instructions ? { instructions: s.instructions } : {}),
        ...(s.durationMin !== undefined ? { durationMin: s.durationMin } : {}),
        forwardOnly: s.forwardOnly,
      })),
      questions,
      imageUrls: Object.fromEntries(paths.flatMap((p) => (set.imageUrls[p] ? [[p, set.imageUrls[p]]] : []))),
      attempt: {
        id: attempt.id,
        testId: attempt.testId,
        status: attempt.status,
        startedAt: attempt.startedAt,
        deadlineAt: attempt.deadlineAt,
        strikesCount: attempt.strikesCount,
        maxStrikes: settings.maxStrikes,
        ...(attempt.submittedAt !== undefined ? { submittedAt: attempt.submittedAt } : {}),
        ...(attempt.terminationReason ? { terminationReason: attempt.terminationReason } : {}),
      },
      settings,
      answers: Object.fromEntries(
        Object.entries(answers).map(([id, a]) => [
          id,
          { optionId: a.optionId, seq: a.seq, ...(a.markedForReview ? { markedForReview: true } : {}) },
        ]),
      ),
      questionServedAt: attempt.questionServedAt,
      serverTime: clock.now(),
    };
  }

  /** The caller's own attempt; another student's or another organization's is 404 (ORG-05). */
  async function ownAttempt(orgId: string, studentId: string, attemptId: string): Promise<AttemptRecord> {
    const attempt = await data.attempts.getAttempt(orgId, attemptId);
    if (!attempt || attempt.studentId !== studentId) throw notFound('Attempt');
    return attempt;
  }

  const dayLabelOf = async (orgId: string, test: TestRecord) =>
    dayLabels(await data.tests.listTests(orgId, test.seriesId))[test.id] ?? null;

  return {
    /**
     * POST /v1/attempts (EX-03, EX-04): a scheduled test of an active series that the student's series and test rules
     * admit (SER-08, checked now from the stored records), inside its start window; a repeat returns the same attempt.
     * A new attempt is drawn once, seeded by its ID (Q-06), with its deadline fixed (spec 5.5), a standing accommodation
     * for the series on top (OPS-07). Each start enqueues
     * the auto-submit and release tasks (idempotent by name) and writes the attempt's owner for the Realtime Database rules.
     */
    async start(
      orgId: string,
      who: { uid: string; studentId: string },
      testId: string,
    ): Promise<{ payload: AttemptPayload; created: boolean }> {
      const test = await data.tests.getTest(orgId, testId);
      if (!test || test.status !== 'scheduled' || !test.resolved) throw notFound('Test');
      const [series, stored, dayLabel, set] = await Promise.all([
        data.series.getSeries(orgId, test.seriesId),
        data.students.getStudent(orgId, who.studentId),
        dayLabelOf(orgId, test),
        published.questions(orgId, test),
      ]);
      const { settings, student } = admitStudent(test, series, stored);

      const now = clock.now();
      // OPS-07: a standing accommodation for the test's series is fixed into the deadline once, at start (spec 5.5).
      const extraTimeSec = accommodationExtraSec(settings.durationMin, student.accommodations[test.seriesId]);
      const { attempt, created } = await data.attempts.startAttempt(
        orgId,
        { testId, studentId: who.studentId, firstStart: !test.attemptsStarted },
        (id, { afterReset }) => {
          assertStartWindow(settings, now, afterReset);
          return {
            id,
            orgId,
            testId,
            seriesId: test.seriesId,
            studentId: who.studentId,
            uid: who.uid,
            status: 'in_progress',
            startedAt: now,
            deadlineAt: attemptDeadline(settings, now, extraTimeSec),
            extraTimeSec,
            draw: drawAttempt(set.pools, set.options, settings, id),
            questionServedAt: {},
            strikesCount: 0,
          };
        },
      );
      if (isFinishedAttempt(attempt.status))
        throw new AppError(409, 'ATTEMPT_FINISHED', "You've already finished this test.");

      const [answers] = await Promise.all([
        created ? Promise.resolve({}) : data.attempts.getAnswers(orgId, attempt.id),
        queue.enqueue(autoSubmitTask(orgId, attempt.id, attempt.deadlineAt)),
        // RES-01: the release task for the window end in force now, idempotent by name.
        settings.window
          ? queue.enqueue(releaseResultsTask({ orgId, testId, windowEnd: settings.window.end }))
          : Promise.resolve(),
        withinLimit(
          rtdb.ref().update({
            [`attemptOwners/${attempt.id}`]: who.uid,
            ...(created ? { [liveRecordPath(orgId, testId, attempt.id)]: startedRecord(attempt, student, now) } : {}),
          }),
          log,
          `attemptOwners/${attempt.id}`,
        ),
      ]);
      return { payload: payload(test, dayLabel, settings, set, attempt, answers), created };
    },

    /** GET /v1/attempts/{id} (EX-05): the caller's own attempt, in progress or finished, with its saved answers. */
    async resume(orgId: string, studentId: string, attemptId: string): Promise<AttemptPayload> {
      const attempt = await ownAttempt(orgId, studentId, attemptId);
      const test = await data.tests.getTest(orgId, attempt.testId);
      if (!test?.resolved) throw notFound('Attempt');
      const [dayLabel, set, answers] = await Promise.all([
        dayLabelOf(orgId, test),
        published.questions(orgId, test),
        data.attempts.getAnswers(orgId, attempt.id),
      ]);
      return payload(test, dayLabel, test.resolved, set, attempt, answers);
    },

    /**
     * PUT /v1/attempts/{id}/answers (EX-11, EX-13, EX-14, Q-12, OBS-03): each answer is judged by shared
     * `answerVerdict` against its stored seq, the deadline and its question timer on the server clock, and written in
     * its own transaction. An answer for a question or option outside the attempt's draw refuses the whole batch.
     */
    async saveAnswers(
      orgId: string,
      studentId: string,
      attemptId: string,
      batch: AnswerBatch,
    ): Promise<AnswerBatchResult> {
      const attempt = await ownAttempt(orgId, studentId, attemptId);
      if (attempt.status !== 'in_progress') throw finishedError();
      const test = await data.tests.getTest(orgId, attempt.testId);
      if (!test?.resolved) throw notFound('Attempt');
      const settings = test.resolved;
      const set = await published.questions(orgId, test);
      for (const a of batch.answers) {
        const options = attempt.draw.optionOrder[a.questionId];
        if (!options || (a.optionId !== null && !options.includes(a.optionId)))
          throw new AppError(400, 'VALIDATION', 'An answer names a question or option outside this attempt.', {
            questionId: a.questionId,
          });
      }

      const now = clock.now();
      const verdicts = await Promise.all(
        batch.answers.map(async (a) => {
          const timeLimitSec = questionTimeLimit(settings, set.byId.get(a.questionId) ?? {});
          const verdict = await data.attempts.saveAnswer(orgId, attempt.id, a, now, (storedSeq, stored) =>
            answerVerdict({
              seq: a.seq,
              storedSeq,
              clientTs: a.clientTs,
              serverNow: now,
              deadlineAt: stored.deadlineAt,
              servedAt: stored.questionServedAt[a.questionId],
              ...(timeLimitSec !== undefined ? { timeLimitSec } : {}),
            }),
          );
          return { questionId: a.questionId, verdict };
        }),
      );
      if (verdicts.some((v) => v.verdict === 'ATTEMPT_FINISHED')) throw finishedError();
      const sync = { backlog: batch.backlog, clockOffsetMs: batch.clockOffsetMs, at: now };
      // OPS-02: the answered count is read after this batch's saves, beside the sync write.
      const [answers] = await Promise.all([
        data.attempts.getAnswers(orgId, attempt.id),
        data.attempts.recordSync(orgId, attempt.id, sync),
      ]);
      live.answered(orgId, attempt, answeredCount(attempt.draw.questionIds, answers), batch.backlog, now);
      const result: AnswerBatchResult = { saved: [], stale: [], rejected: [], serverTime: now };
      for (const { questionId, verdict } of verdicts) {
        if (verdict === 'saved' || verdict === 'late_sync') result.saved.push(questionId);
        else if (verdict === 'stale') result.stale.push(questionId);
        else if (verdict !== 'ATTEMPT_FINISHED') result.rejected.push({ questionId, code: verdict });
      }
      return result;
    },

    /**
     * POST /v1/attempts/{id}/navigate (Q-11, Q-12): the exam screen shows a question. A timed question's first serve
     * time is stored once and returned on every later call; an untimed question stores nothing. A question outside the
     * attempt's draw is refused.
     */
    async navigate(
      orgId: string,
      studentId: string,
      attemptId: string,
      questionId: string,
    ): Promise<{ servedAt: number; serverTime: number }> {
      const attempt = await ownAttempt(orgId, studentId, attemptId);
      if (attempt.status !== 'in_progress') throw finishedError();
      if (!attempt.draw.questionIds.includes(questionId))
        throw new AppError(400, 'VALIDATION', 'This question is not part of this attempt.', { questionId });
      const test = await data.tests.getTest(orgId, attempt.testId);
      if (!test?.resolved) throw notFound('Attempt');
      const set = await published.questions(orgId, test);
      const now = clock.now();
      if (questionTimeLimit(test.resolved, set.byId.get(questionId) ?? {}) === undefined)
        return { servedAt: now, serverTime: now };
      const served = await data.attempts.serveQuestion(orgId, attempt.id, questionId, now);
      if (!served) throw notFound('Attempt');
      if (served === 'ATTEMPT_FINISHED') throw finishedError();
      return { servedAt: served.servedAt, serverTime: now };
    },

    /**
     * POST /v1/attempts/{id}/events (PR-07, PR-08, PR-10, PR-11, spec 11.2): every report is logged; shared
     * `strikeVerdict` decides in the transaction, from the stored count and the server clock, whether it is a new
     * strike. A counted strike is mirrored to `live/…` without waiting (REL-05); the strike that reaches the maximum ends the attempt as
     * `terminated` (`max_strikes`) and grades it once. The response carries the server's count.
     */
    async reportEvent(
      orgId: string,
      studentId: string,
      attemptId: string,
      report: AttemptEventReport,
    ): Promise<AttemptEventResult> {
      const attempt = await ownAttempt(orgId, studentId, attemptId);
      if (attempt.status !== 'in_progress') throw finishedError();
      const test = await data.tests.getTest(orgId, attempt.testId);
      if (!test?.resolved) throw notFound('Attempt');
      const { devtoolsPolicy, maxStrikes } = test.resolved;
      const now = clock.now();
      const done = await data.events.recordEvent(orgId, attempt.id, report, now, (stored) =>
        strikeVerdict({
          type: report.type,
          devtoolsPolicy,
          maxStrikes,
          strikesCount: stored.strikesCount,
          lastStrikeAt: stored.lastStrikeAt,
          now,
        }),
      );
      if (!done) throw notFound('Attempt');
      if (done === 'ATTEMPT_FINISHED') throw finishedError();
      const { verdict } = done;
      if (verdict.counted) live.strikes(orgId, done.attempt, now);
      const status = verdict.terminates
        ? (await grader.finish(orgId, done.attempt, 'terminated', { terminationReason: 'max_strikes' })).status
        : done.attempt.status;
      return { strikesCount: done.attempt.strikesCount, counted: verdict.counted, status };
    },

    /** GET /v1/attempts/{id}/events (PR-11): an attempt's event timeline for admins; another org's attempt is 404. */
    async listEvents(orgId: string, attemptId: string): Promise<AttemptEventList> {
      if (!(await data.attempts.getAttempt(orgId, attemptId))) throw notFound('Attempt');
      return { items: await data.events.listEvents(orgId, attemptId) };
    },

    /**
     * POST /v1/attempts/{id}/submit (EX-15, EX-16, EX-17): the client sends it after its answers are synced. An
     * attempt in progress is graded and finished as `submitted`, or `auto_submitted` when time ran out (`time_up`);
     * a finished one is returned as it is, so a repeat gives the same `submittedAt`.
     */
    async submit(
      orgId: string,
      studentId: string,
      attemptId: string,
      reason?: 'time_up',
    ): Promise<{ status: AttemptRecord['status']; submittedAt: number }> {
      const attempt = await ownAttempt(orgId, studentId, attemptId);
      if (attempt.status === 'reset') throw new AppError(409, 'ATTEMPT_FINISHED', 'This attempt was reset.');
      const done = isFinishedAttempt(attempt.status)
        ? attempt
        : await grader.finish(orgId, attempt, reason === 'time_up' ? 'auto_submitted' : 'submitted');
      return { status: done.status, submittedAt: done.submittedAt ?? done.startedAt };
    },
  };
}
export type AttemptService = ReturnType<typeof attemptService>;
