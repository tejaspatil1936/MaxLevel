import { FieldPath, type Firestore } from 'firebase-admin/firestore';

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

export function attemptsData(db: Firestore) {
  return {
    /**
     * TST-06, Q-15: whether any attempt of the test exists, read from the attempts and the attempt index (phase 3
     * writes both when an attempt starts; a test record's `attemptsStarted` flag is checked by the caller as well).
     */
    async hasAttempts(orgId: string, testId: string): Promise<boolean> {
      const [attempts, index] = await Promise.all([
        db.collection(`organizations/${orgId}/attempts`).where('testId', '==', testId).limit(1).get(),
        db
          .collection(`organizations/${orgId}/attemptIndex`)
          .where(FieldPath.documentId(), '>=', `${testId}_`)
          .where(FieldPath.documentId(), '<', `${testId}_\uf8ff`)
          .limit(1)
          .get(),
      ]);
      return !attempts.empty || !index.empty;
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
