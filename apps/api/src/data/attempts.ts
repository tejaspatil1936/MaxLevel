import type { AnswerRecord, AttemptRecord, AttemptStatus } from '@mitaoe/shared';
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
