import type { AuditEntry } from '@mitaoe/shared';
import type { Firestore, Transaction, WriteBatch } from 'firebase-admin/firestore';

export type Tx = Transaction | WriteBatch;

// The audit log is append-only (AUD-04): this module has no update or delete.
export function auditData(db: Firestore) {
  const col = (orgId: string) => db.collection(`organizations/${orgId}/auditLogs`);
  return {
    /** Adds the entry to the caller's batch or transaction, so it commits with the change (AUD-02). */
    addAudit(orgId: string, tx: Tx, entry: Omit<AuditEntry, 'id' | 'orgId'>): string {
      const ref = col(orgId).doc();
      const doc = { ...entry, orgId, id: ref.id };
      if ('getAll' in tx) (tx as Transaction).create(ref, doc);
      else (tx as WriteBatch).create(ref, doc);
      return ref.id;
    },

    async listAudit(orgId: string, opts: { limit?: number } = {}): Promise<AuditEntry[]> {
      const snap = await col(orgId)
        .orderBy('createdAt', 'desc')
        .limit(opts.limit ?? 50)
        .get();
      return snap.docs.map((d) => d.data() as AuditEntry);
    },
  };
}
