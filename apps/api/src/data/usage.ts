import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export type UsageField = 'aiImports' | 'aiReports' | 'testsRun';

export function usageData(db: Firestore) {
  const ref = (orgId: string, month: string) => db.doc(`organizations/${orgId}/usage/${month}`);
  return {
    /**
     * Atomically takes one unit of a monthly allowance (FF-04). Returns false, changing nothing, when the counter has
     * already reached the limit, so a job is refused before it starts.
     */
    async takeUsage(orgId: string, month: string, field: UsageField, limit: number): Promise<boolean> {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref(orgId, month));
        const used = (snap.get(field) as number | undefined) ?? 0;
        if (used >= limit) return false;
        tx.set(ref(orgId, month), { orgId, month, [field]: FieldValue.increment(1) }, { merge: true });
        return true;
      });
    },

    async getUsage(orgId: string, month: string): Promise<Record<UsageField, number>> {
      const s = await ref(orgId, month).get();
      return {
        aiImports: s.get('aiImports') ?? 0,
        aiReports: s.get('aiReports') ?? 0,
        testsRun: s.get('testsRun') ?? 0,
      };
    },
  };
}
