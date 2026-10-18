import type { AnswerRecord, AttemptRecord, GradingQuestion, Section, Settings } from '@mitaoe/shared';
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';

// The worker's data access (ORG-03: every function takes orgId first). It reads and writes the same records as the
// API's data layer (apps/api/src/data), only those its tasks need.

/** What finishing an attempt stores (EX-17). */
export type FinishedFields = Required<Pick<AttemptRecord, 'status' | 'submittedAt' | 'result'>>;

/** What the release task reads of a test: its settings snapshot and release state (RES-01). */
export interface ReleaseTest {
  id: string;
  seriesId: string;
  resolved: Settings;
  resultsReleasedAt: number | null;
  resultsWithdrawn: boolean;
}

const toReleaseTest = (d: DocumentSnapshot): ReleaseTest => ({
  id: d.id,
  seriesId: d.get('seriesId') as string,
  resolved: d.get('resolved') as Settings,
  resultsReleasedAt: typeof d.get('resultsReleasedAt') === 'number' ? (d.get('resultsReleasedAt') as number) : null,
  resultsWithdrawn: d.get('resultsWithdrawn') === true,
});

/** What grading needs of a test: its sections (section marks) and its published settings snapshot. */
export interface GradedTest {
  id: string;
  seriesId: string;
  sections: Section[];
  resolved: Settings;
}

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

export function workerData(db: Firestore) {
  const org = (orgId: string) => db.doc(`organizations/${orgId}`);

  return {
    async getAttempt(orgId: string, attemptId: string): Promise<AttemptRecord | null> {
      const d = await org(orgId).collection('attempts').doc(attemptId).get();
      return d.exists ? toAttempt(d) : null;
    },

    /** A published test (one with a settings snapshot), or null. */
    async getGradedTest(orgId: string, testId: string): Promise<GradedTest | null> {
      const d = await org(orgId).collection('tests').doc(testId).get();
      if (!d.exists || !d.get('resolved')) return null;
      return {
        id: d.id,
        seriesId: d.get('seriesId') as string,
        sections: (d.get('sections') as Section[] | undefined) ?? [],
        resolved: d.get('resolved') as Settings,
      };
    },

    /** A published test's release state, or null for a missing or unpublished test. */
    async getReleaseTest(orgId: string, testId: string): Promise<ReleaseTest | null> {
      const d = await org(orgId).collection('tests').doc(testId).get();
      return d.exists && d.get('resolved') ? toReleaseTest(d) : null;
    },

    /**
     * RES-01, REL-04: stores `resultsReleasedAt` in a transaction when `decide` still says so on the stored test, so a
     * Release or Withdraw results racing the task is never overwritten. True when it stored.
     */
    async releaseByTask(
      orgId: string,
      testId: string,
      decide: (test: ReleaseTest) => boolean,
      now: number,
    ): Promise<boolean> {
      const ref = org(orgId).collection('tests').doc(testId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || !snap.get('resolved') || !decide(toReleaseTest(snap))) return false;
        tx.update(ref, { resultsReleasedAt: now });
        return true;
      });
    },

    /** The answer key and own marks of the named questions of a test (EX-17); missing questions are left out. */
    async answerKeys(orgId: string, testId: string, questionIds: string[]): Promise<Map<string, GradingQuestion>> {
      const col = org(orgId).collection('tests').doc(testId).collection('questions');
      const docs = questionIds.length ? await db.getAll(...questionIds.map((id) => col.doc(id))) : [];
      return new Map(
        docs
          .filter((d) => d.exists)
          .map((d) => {
            const marks = d.get('marks') as number | undefined;
            const negativeMarks = d.get('negativeMarks') as number | undefined;
            return [
              d.id,
              {
                correctOptionIds: (d.get('correctOptionIds') as string[] | undefined) ?? [],
                ...(marks !== undefined ? { marks } : {}),
                ...(negativeMarks !== undefined ? { negativeMarks } : {}),
              },
            ];
          }),
      );
    },

    /**
     * EX-16, REL-04: finishes an attempt at most once. In one transaction the attempt and its answers are read; an
     * attempt still in progress gets what `finish` builds, unless `finish` returns null (for example, the deadline
     * moved). Null when there is no attempt.
     */
    async finalizeAttempt(
      orgId: string,
      attemptId: string,
      finish: (attempt: AttemptRecord, answers: Record<string, AnswerRecord>) => FinishedFields | null,
    ): Promise<{ attempt: AttemptRecord; finalized: boolean } | null> {
      const ref = org(orgId).collection('attempts').doc(attemptId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const attempt = toAttempt(snap);
        if (attempt.status !== 'in_progress') return { attempt, finalized: false };
        // Each drawn question's answer by reference, so an answer save racing this transaction conflicts with it.
        const ids = attempt.draw.questionIds;
        const answers = ids.length ? await tx.getAll(...ids.map((id) => ref.collection('answers').doc(id))) : [];
        const fields = finish(
          attempt,
          Object.fromEntries(answers.flatMap((d) => (d.exists ? [[d.id, d.data() as AnswerRecord]] : []))),
        );
        if (!fields) return { attempt, finalized: false };
        tx.update(ref, fields);
        return { attempt: { ...attempt, ...fields }, finalized: true };
      });
    },
  };
}
export type WorkerData = ReturnType<typeof workerData>;
