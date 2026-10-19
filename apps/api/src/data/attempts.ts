import {
  isFinishedAttempt,
  type AnswerRecord,
  type AnswerVerdict,
  type AttemptRecord,
  type AttemptStatus,
  type TestAttemptList,
} from '@mitaoe/shared';
import {
  FieldPath,
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

export interface AttemptSummary {
  id: string;
  testId: string;
  testTitle: string;
  status: string;
  score: number | null;
  max: number | null;
  strikes: number;
  startedAt: number;
}

/** What the student dashboard and test page need of an attempt (US-ST-03): never its draw, answers or result. */
export interface StudentAttemptRef {
  id: string;
  testId: string;
  seriesId: string | null;
  status: AttemptStatus;
  startedAt: number;
  submittedAt: number | null;
}

/** What the student history needs of a finished attempt (US-ST-08, RES-04): its score, never its draw or answers. */
export interface FinishedAttemptRef {
  id: string;
  testId: string;
  seriesId: string;
  status: AttemptStatus;
  submittedAt: number | null;
  score: number | null;
  max: number | null;
}

/** What finishing an attempt stores (EX-17, PR-10). */
export type FinishedFields = Required<Pick<AttemptRecord, 'status' | 'submittedAt' | 'result'>> &
  Pick<AttemptRecord, 'terminationReason'>;

/** What saving one answer did: the shared verdict, or `ATTEMPT_FINISHED` when the attempt is no longer in progress. */
export type SaveVerdict = AnswerVerdict | 'ATTEMPT_FINISHED';

/** The new attempt for an ID, built inside the start transaction; it may throw to refuse the start. */
export type AttemptBuilder = (attemptId: string) => AttemptRecord;

/** An attempt record as stored, with the defaults of fields older records may lack. */
export const toAttempt = (d: DocumentSnapshot): AttemptRecord => {
  const { orgId, ...rest } = d.data() ?? {};
  return {
    ...(rest as Omit<AttemptRecord, 'id' | 'orgId'>),
    id: d.id,
    orgId: orgId as string,
    questionServedAt: rest.questionServedAt ?? {},
    strikesCount: rest.strikesCount ?? 0,
    extraTimeSec: rest.extraTimeSec ?? 0,
  };
};

/** An attempt's answers keyed by question ID, read in `tx` by the drawn questions' record references. */
async function answersOf(
  tx: Transaction,
  ref: DocumentReference,
  attempt: AttemptRecord,
): Promise<Record<string, AnswerRecord>> {
  const ids = attempt.draw.questionIds;
  if (ids.length === 0) return {};
  const snaps = await tx.getAll(...ids.map((id) => ref.collection('answers').doc(id)));
  return Object.fromEntries(snaps.flatMap((d) => (d.exists ? [[d.id, d.data() as AnswerRecord]] : [])));
}

export function attemptsData(db: Firestore) {
  const attempts = (orgId: string) => db.collection(`organizations/${orgId}/attempts`);
  const indexRef = (orgId: string, testId: string, studentId: string) =>
    db.doc(`organizations/${orgId}/attemptIndex/${testId}_${studentId}`);

  return {
    /**
     * DATA-02, EX-04: one active attempt per student per test. In one transaction on the attempt index: an active
     * attempt that was not reset is returned as it is; otherwise `build` makes the attempt (with a reserved attempt
     * ID when phone pairing reserved one, PR-13), which is created with the index entry and, on the test's first
     * start, the test's `attemptsStarted` flag (TST-06).
     */
    async startAttempt(
      orgId: string,
      input: { testId: string; studentId: string; firstStart: boolean },
      build: AttemptBuilder,
    ): Promise<{ attempt: AttemptRecord; created: boolean }> {
      const ref = indexRef(orgId, input.testId, input.studentId);
      return db.runTransaction(async (tx) => {
        const index = await tx.get(ref);
        const activeId = index.get('activeAttemptId') as string | null | undefined;
        if (activeId) {
          const active = await tx.get(attempts(orgId).doc(activeId));
          if (active.exists && active.get('status') !== 'reset') return { attempt: toAttempt(active), created: false };
        }
        const reserved = index.get('reservedAttemptId') as string | undefined;
        const attempt = build(reserved ?? attempts(orgId).doc().id);
        const { id, ...fields } = attempt;
        tx.create(attempts(orgId).doc(id), fields);
        tx.set(
          ref,
          {
            testId: input.testId,
            studentId: input.studentId,
            activeAttemptId: id,
            attemptCount: ((index.get('attemptCount') as number | undefined) ?? 0) + 1,
            reservedAttemptId: FieldValue.delete(),
          },
          { merge: true },
        );
        if (input.firstStart)
          tx.update(db.doc(`organizations/${orgId}/tests/${input.testId}`), { attemptsStarted: true });
        return { attempt, created: true };
      });
    },

    /**
     * PR-13: the attempt ID that phone pairing before Start uses, in one transaction on the attempt index. An active
     * attempt that was not reset is returned with its status; otherwise `check` runs (it may throw to refuse, and then
     * nothing is stored) and the reserved ID is returned, reserving a new one when there is none. A reservation is
     * only `reservedAttemptId` on the index entry: no attempt record and no `attemptsStarted` (TST-06).
     */
    async reserveAttempt(
      orgId: string,
      input: { testId: string; studentId: string },
      check: () => void,
    ): Promise<{ attemptId: string; status?: AttemptStatus }> {
      const ref = indexRef(orgId, input.testId, input.studentId);
      return db.runTransaction(async (tx) => {
        const index = await tx.get(ref);
        const activeId = index.get('activeAttemptId') as string | null | undefined;
        if (activeId) {
          const active = await tx.get(attempts(orgId).doc(activeId));
          const status = active.get('status') as AttemptStatus | undefined;
          if (active.exists && status !== 'reset') return { attemptId: activeId, status: status! };
        }
        check();
        const reserved = index.get('reservedAttemptId') as string | undefined;
        if (reserved) return { attemptId: reserved };
        const attemptId = attempts(orgId).doc().id;
        tx.set(
          ref,
          {
            testId: input.testId,
            studentId: input.studentId,
            reservedAttemptId: attemptId,
            attemptCount: (index.get('attemptCount') as number | undefined) ?? 0,
          },
          { merge: true },
        );
        return { attemptId };
      });
    },

    async getAttempt(orgId: string, attemptId: string): Promise<AttemptRecord | null> {
      const d = await attempts(orgId).doc(attemptId).get();
      return d.exists ? toAttempt(d) : null;
    },

    /** The saved answers of an attempt, keyed by question ID (EX-05, EX-14). */
    async getAnswers(orgId: string, attemptId: string): Promise<Record<string, AnswerRecord>> {
      const snap = await attempts(orgId).doc(attemptId).collection('answers').get();
      return Object.fromEntries(snap.docs.map((d) => [d.id, d.data() as AnswerRecord]));
    },

    /**
     * EX-11, EX-13, EX-14: one answer in its own record and its own transaction, so saves of different questions never
     * contend (DATA-03). The transaction reads the attempt too: once it is finished (or gone) nothing is written and
     * the verdict is `ATTEMPT_FINISHED`, so an answer racing a submit is either graded or refused (EX-17). Otherwise
     * `decide` sees the stored `seq` and the attempt as stored (its serve times, Q-12) and says what to do; only
     * `saved` and `late_sync` write, and a late one also logs a `late_sync` event in the same transaction.
     */
    async saveAnswer(
      orgId: string,
      attemptId: string,
      answer: { questionId: string; optionId: string | null; seq: number; clientTs: number; markedForReview?: boolean },
      serverTs: number,
      decide: (storedSeq: number | undefined, attempt: AttemptRecord) => AnswerVerdict,
    ): Promise<SaveVerdict> {
      const attemptRef = attempts(orgId).doc(attemptId);
      const ref = attemptRef.collection('answers').doc(answer.questionId);
      return db.runTransaction(async (tx) => {
        const [snap, stored] = await tx.getAll(attemptRef, ref);
        if (!snap!.exists || snap!.get('status') !== 'in_progress') return 'ATTEMPT_FINISHED';
        const verdict = decide(stored!.exists ? (stored!.get('seq') as number) : undefined, toAttempt(snap!));
        if (verdict !== 'saved' && verdict !== 'late_sync') return verdict;
        const late = verdict === 'late_sync';
        const record: AnswerRecord = {
          optionId: answer.optionId,
          seq: answer.seq,
          clientTs: answer.clientTs,
          serverTs,
          markedForReview: answer.markedForReview ?? false,
          ...(late ? { lateSync: true } : {}),
        };
        tx.set(ref, record);
        if (late)
          tx.create(attemptRef.collection('events').doc(), {
            orgId,
            type: 'late_sync',
            details: { questionId: answer.questionId, seq: answer.seq },
            clientTs: answer.clientTs,
            serverTs,
          });
        return verdict;
      });
    },

    /**
     * EX-15 to EX-17, REL-04: finishes an attempt exactly once. In one transaction the attempt and its answers are read
     * (each drawn question's record by reference, so a concurrent answer save conflicts with it and is retried);
     * an attempt still in progress gets the fields `finish` builds from them (status, submittedAt, graded result),
     * while a finished one is returned as stored, so repeats and retries change nothing. Null when there is no attempt.
     */
    async finalizeAttempt(
      orgId: string,
      attemptId: string,
      finish: (attempt: AttemptRecord, answers: Record<string, AnswerRecord>) => FinishedFields,
    ): Promise<{ attempt: AttemptRecord; finalized: boolean } | null> {
      const ref = attempts(orgId).doc(attemptId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const attempt = toAttempt(snap);
        if (attempt.status !== 'in_progress') return { attempt, finalized: false };
        const fields = finish(attempt, await answersOf(tx, ref, attempt));
        tx.update(ref, fields);
        return { attempt: { ...attempt, ...fields }, finalized: true };
      });
    },

    /**
     * Q-12: the first serve time of a question, stored in the attempt's `questionServedAt` in one transaction; a later
     * call returns the stored time and writes nothing. `ATTEMPT_FINISHED` once the attempt is no longer in progress,
     * null when there is no attempt.
     */
    async serveQuestion(
      orgId: string,
      attemptId: string,
      questionId: string,
      now: number,
    ): Promise<{ servedAt: number } | 'ATTEMPT_FINISHED' | null> {
      const ref = attempts(orgId).doc(attemptId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const attempt = toAttempt(snap);
        if (attempt.status !== 'in_progress') return 'ATTEMPT_FINISHED';
        const stored = attempt.questionServedAt[questionId];
        if (stored !== undefined) return { servedAt: stored };
        tx.update(ref, new FieldPath('questionServedAt', questionId), now);
        return { servedAt: now };
      });
    },

    /** OBS-03: the latest batch's backlog and clock offset; the only attempt field an answer batch writes (EX-14). */
    async recordSync(orgId: string, attemptId: string, sync: NonNullable<AttemptRecord['sync']>): Promise<void> {
      await attempts(orgId).doc(attemptId).update({ sync });
    },

    /**
     * TST-06, Q-15: whether any attempt of the test is stored. A pairing reservation on the attempt index is not an
     * attempt (DECISIONS 2026-10-18); the caller checks the test's `attemptsStarted` flag as well.
     */
    async hasAttempts(orgId: string, testId: string): Promise<boolean> {
      const snap = await attempts(orgId).where('testId', '==', testId).limit(1).get();
      return !snap.empty;
    },

    /**
     * Every attempt of a test in the organization, `reset` ones included, earliest start first, read with only the
     * fields the admin list shows (never a draw, answer or result).
     */
    async listTestAttempts(orgId: string, testId: string): Promise<TestAttemptList['items']> {
      const snap = await attempts(orgId)
        .where('testId', '==', testId)
        .select('studentId', 'status', 'startedAt', 'deadlineAt', 'extraTimeSec', 'strikesCount')
        .get();
      return snap.docs
        .map((d) => ({
          id: d.id,
          studentId: d.get('studentId') as string,
          status: d.get('status') as AttemptStatus,
          startedAt: (d.get('startedAt') as number | undefined) ?? 0,
          deadlineAt: (d.get('deadlineAt') as number | undefined) ?? 0,
          extraTimeSec: (d.get('extraTimeSec') as number | undefined) ?? 0,
          strikesCount: (d.get('strikesCount') as number | undefined) ?? 0,
        }))
        .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
    },

    /** A student's attempts in their organization, newest start first, read with only the fields listed above. */
    async listStudentAttempts(orgId: string, studentId: string): Promise<StudentAttemptRef[]> {
      const snap = await db
        .collection(`organizations/${orgId}/attempts`)
        .where('studentId', '==', studentId)
        .select('testId', 'seriesId', 'status', 'startedAt', 'submittedAt')
        .get();
      return snap.docs
        .map((d) => ({
          id: d.id,
          testId: d.get('testId') as string,
          seriesId: (d.get('seriesId') as string | undefined) ?? null,
          status: d.get('status') as AttemptStatus,
          startedAt: (d.get('startedAt') as number | undefined) ?? 0,
          submittedAt: (d.get('submittedAt') as number | undefined) ?? null,
        }))
        .sort((a, b) => b.startedAt - a.startedAt);
    },

    /**
     * US-ST-08: a student's finished attempts (`submitted`, `auto_submitted`, `terminated`) in their organization,
     * read with only their test, series, status, submission time and score.
     */
    async listFinishedAttempts(orgId: string, studentId: string): Promise<FinishedAttemptRef[]> {
      const snap = await attempts(orgId)
        .where('studentId', '==', studentId)
        .select('testId', 'seriesId', 'status', 'submittedAt', 'result.score', 'result.max')
        .get();
      return snap.docs
        .filter((d) => isFinishedAttempt(d.get('status') as AttemptStatus))
        .map((d) => ({
          id: d.id,
          testId: d.get('testId') as string,
          seriesId: d.get('seriesId') as string,
          status: d.get('status') as AttemptStatus,
          submittedAt: (d.get('submittedAt') as number | undefined) ?? null,
          score: (d.get('result.score') as number | undefined) ?? null,
          max: (d.get('result.max') as number | undefined) ?? null,
        }));
    },

    /** A student's attempts, newest first, with their test titles (STU-10). */
    async listAttemptsForStudent(orgId: string, studentId: string): Promise<AttemptSummary[]> {
      const snap = await db.collection(`organizations/${orgId}/attempts`).where('studentId', '==', studentId).get();
      const testIds = [...new Set(snap.docs.map((d) => d.get('testId') as string))];
      const tests = testIds.length
        ? await db.getAll(...testIds.map((t) => db.doc(`organizations/${orgId}/tests/${t}`)))
        : [];
      const titles = new Map(tests.map((t) => [t.id, (t.get('title') as string | undefined) ?? '']));
      return snap.docs
        .map((d) => ({
          id: d.id,
          testId: d.get('testId'),
          testTitle: titles.get(d.get('testId')) ?? '',
          status: d.get('status'),
          score: d.get('result.score') ?? null,
          max: d.get('result.max') ?? null,
          strikes: d.get('strikesCount') ?? 0,
          startedAt: d.get('startedAt') ?? 0,
        }))
        .sort((a, b) => b.startedAt - a.startedAt);
    },
  };
}
