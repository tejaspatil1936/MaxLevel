import type { AnswerRecord, AnswerVerdict, AttemptRecord, AttemptStatus } from '@mitaoe/shared';
import { FieldValue, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';

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

/** What finishing an attempt stores (EX-17, PR-10). */
export type FinishedFields = Required<Pick<AttemptRecord, 'status' | 'submittedAt' | 'result'>> &
  Pick<AttemptRecord, 'terminationReason'>;

/** The new attempt for an ID, built inside the start transaction; it may throw to refuse the start. */
export type AttemptBuilder = (attemptId: string) => AttemptRecord;

const toAttempt = (d: DocumentSnapshot): AttemptRecord => {
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
     * contend (DATA-03). `decide` sees the stored `seq` and says what to do; only `saved` and `late_sync` write, and a
     * late one also logs a `late_sync` event in the same transaction.
     */
    async saveAnswer(
      orgId: string,
      attemptId: string,
      answer: { questionId: string; optionId: string | null; seq: number; clientTs: number; markedForReview?: boolean },
      serverTs: number,
      decide: (storedSeq: number | undefined) => AnswerVerdict,
    ): Promise<AnswerVerdict> {
      const attemptRef = attempts(orgId).doc(attemptId);
      const ref = attemptRef.collection('answers').doc(answer.questionId);
      return db.runTransaction(async (tx) => {
        const stored = await tx.get(ref);
        const verdict = decide(stored.exists ? (stored.get('seq') as number) : undefined);
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
            type: 'late_sync',
            details: { questionId: answer.questionId, seq: answer.seq },
            clientTs: answer.clientTs,
            serverTs,
          });
        return verdict;
      });
    },

    /**
     * EX-15 to EX-17, REL-04: finishes an attempt exactly once. In one transaction the attempt and its answers are read;
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
        const answers = await tx.get(ref.collection('answers'));
        const fields = finish(attempt, Object.fromEntries(answers.docs.map((d) => [d.id, d.data() as AnswerRecord])));
        tx.update(ref, fields);
        return { attempt: { ...attempt, ...fields }, finalized: true };
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
