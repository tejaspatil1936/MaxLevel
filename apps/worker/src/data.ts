import type { AnswerRecord, AttemptRecord, GradingQuestion, Section, Settings } from '@mitaoe/shared';
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';

// The worker's data access (ORG-03: every function takes orgId first). It reads and writes the same records as the
// API's data layer (apps/api/src/data), only those its tasks need.

/** What finishing an attempt stores (EX-17). */
export type FinishedFields = Required<Pick<AttemptRecord, 'status' | 'submittedAt' | 'result'>>;

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
        const answers = await tx.get(ref.collection('answers'));
        const fields = finish(attempt, Object.fromEntries(answers.docs.map((d) => [d.id, d.data() as AnswerRecord])));
        if (!fields) return { attempt, finalized: false };
        tx.update(ref, fields);
        return { attempt: { ...attempt, ...fields }, finalized: true };
      });
    },
  };
}
export type WorkerData = ReturnType<typeof workerData>;
