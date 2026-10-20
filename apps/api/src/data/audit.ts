import type { AuditEntry } from '@mitaoe/shared';
import type { Firestore, Transaction, WriteBatch } from 'firebase-admin/firestore';
import { matchesAudit, type AuditFilter } from './platform';
import type { Tx } from './tx';

export type { Tx };

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

    /** Newest first, filtered by actor, action, target and date (AUD-03). */
    async listAudit(orgId: string, f: Omit<AuditFilter, 'orgId'> = {}, max = 2000): Promise<AuditEntry[]> {
      let q: FirebaseFirestore.Query = col(orgId);
      if (f.from !== undefined) q = q.where('createdAt', '>=', f.from);
      if (f.to !== undefined) q = q.where('createdAt', '<=', f.to);
      const snap = await q.orderBy('createdAt', 'desc').limit(max).get();
      return snap.docs.map((d) => d.data() as AuditEntry).filter((e) => matchesAudit(e, f));
    },
  };
}
