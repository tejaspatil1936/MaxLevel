import {
  answerVerdict,
  attemptDeadline,
  autoSubmitTask,
  canStart,
  dayLabels,
  drawAttempt,
  isEligible,
  isFinishedAttempt,
  questionTimeLimit,
  type AnswerBatch,
  type AnswerBatchResult,
  type AnswerRecord,
  type AttemptPayload,
  type AttemptRecord,
  type Clock,
  type Settings,
  type TaskQueue,
} from '@mitaoe/shared';
import type { Database } from 'firebase-admin/database';
import type { Data } from '../data';
import type { TestRecord } from '../data/tests';
import { AppError, notFound } from '../errors';
import { asEligibility } from './eligibility';
import { attemptGrader } from './grading';
import type { PublishedQuestions, PublishedTestCache } from './published-tests';

const REFUSALS = {
  WINDOW_NOT_OPEN: "This test hasn't opened yet.",
  WINDOW_CLOSED: 'The last start time for this test has passed.',
} as const;

const finishedError = () =>
  new AppError(409, 'ATTEMPT_FINISHED', 'This attempt is finished and takes no more answers.');

export interface AttemptDeps {
  data: Data;
  clock: Clock;
  queue: TaskQueue;
  rtdb: Database;
  published: PublishedTestCache;
}

/**
 * The attempt engine's start and resume (EX-03, EX-04, EX-05, Q-06, SER-08, PERF-03): one exam payload per call,
 * built from the attempt's stored draw and the cached published questions, never with an answer key (DATA-05).
 */
export function attemptService(deps: AttemptDeps) {
  const { data, clock, queue, rtdb, published } = deps;
  const grader = attemptGrader(deps);

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
     * A new attempt is drawn once, seeded by its ID (Q-06), with its deadline fixed (spec 5.5). Each start enqueues
     * the auto-submit task (idempotent by name) and writes the attempt's owner for the Realtime Database rules.
     */
    async start(
      orgId: string,
      who: { uid: string; studentId: string },
      testId: string,
    ): Promise<{ payload: AttemptPayload; created: boolean }> {
      const test = await data.tests.getTest(orgId, testId);
      if (!test || test.status !== 'scheduled' || !test.resolved) throw notFound('Test');
      const settings = test.resolved;
      const [series, student, dayLabel, set] = await Promise.all([
        data.series.getSeries(orgId, test.seriesId),
        data.students.getStudent(orgId, who.studentId),
        dayLabelOf(orgId, test),
        published.questions(orgId, test),
      ]);
      if (!series || series.status !== 'active') throw notFound('Test');
      if (!student || !isEligible(asEligibility(student), series.eligibility, test.eligibility))
        throw new AppError(403, 'NOT_ELIGIBLE', "This test isn't open to you.");

      const now = clock.now();
      const { attempt, created } = await data.attempts.startAttempt(
        orgId,
        { testId, studentId: who.studentId, firstStart: !test.attemptsStarted },
        (id) => {
          const open = canStart(settings, now);
          if (!open.ok) throw new AppError(409, open.code, REFUSALS[open.code]);
          return {
            id,
            orgId,
            testId,
            seriesId: test.seriesId,
            studentId: who.studentId,
            uid: who.uid,
            status: 'in_progress',
            startedAt: now,
            deadlineAt: attemptDeadline(settings, now),
            extraTimeSec: 0,
            draw: drawAttempt(set.pools, set.options, settings, id),
            questionServedAt: {},
            strikesCount: 0,
          };
        },
      );
      if (isFinishedAttempt(attempt.status))
        throw new AppError(409, 'ATTEMPT_FINISHED', "You've already finished this test.");

      const live = {
        name: student.name ?? '',
        prn: student.prn ?? '',
        status: attempt.status,
        answered: 0,
        total: attempt.draw.questionIds.length,
        strikes: 0,
        deadlineAt: attempt.deadlineAt,
        updatedAt: now,
      };
      const [answers] = await Promise.all([
        created ? Promise.resolve({}) : data.attempts.getAnswers(orgId, attempt.id),
        queue.enqueue(autoSubmitTask(orgId, attempt.id, attempt.deadlineAt)),
        rtdb.ref().update({
          [`attemptOwners/${attempt.id}`]: who.uid,
          ...(created ? { [`live/${orgId}/${testId}/${attempt.id}`]: live } : {}),
        }),
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
      await Promise.all([
        data.attempts.recordSync(orgId, attempt.id, sync),
        rtdb.ref(`live/${orgId}/${attempt.testId}/${attempt.id}`).update({ backlog: batch.backlog, updatedAt: now }),
      ]);
      const result: AnswerBatchResult = { saved: [], stale: [], rejected: [], serverTime: now };
      for (const { questionId, verdict } of verdicts) {
        if (verdict === 'saved' || verdict === 'late_sync') result.saved.push(questionId);
        else if (verdict === 'stale') result.stale.push(questionId);
        else if (verdict !== 'ATTEMPT_FINISHED') result.rejected.push({ questionId, code: verdict });
      }
      return result;
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
