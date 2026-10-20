import type { Firestore } from 'firebase-admin/firestore';

// The migration ledger and run lease (CI-04, REL-04). Both are platform-level records, not an organization's: the
// ledger at `_migrations/{migrationId}` holds one record per applied migration and is never rewritten; the lease at
// `_migrationLease/run` lets one migrate run at a time work while overlapping deliveries are refused.

export const LEDGER = '_migrations';
export const LEASE = '_migrationLease/run';

export interface LedgerEntry {
  version: number;
  /** Epoch ms on the Clock. */
  appliedAt: number;
  /** Records the migration wrote. */
  changed: number;
}

export function migrationData(db: Firestore) {
  const lease = db.doc(LEASE);
  return {
    /** The IDs of every applied migration (one small record per migration ever shipped). */
    async appliedIds(): Promise<Set<string>> {
      return new Set((await db.collection(LEDGER).select().get()).docs.map((d) => d.id));
    },

    /** Records an applied migration once; false (writing nothing) when it is in the ledger already. */
    async record(id: string, entry: LedgerEntry): Promise<boolean> {
      try {
        await db.collection(LEDGER).doc(id).create(entry);
        return true;
      } catch (err) {
        if ((err as { code?: number }).code === 6) return false; // ALREADY_EXISTS
        throw err;
      }
    },

    /**
     * Takes the run lease for `runId` until `leaseUntil` when nobody holds it, or the holder's lease ran out, or
     * `runId` already holds it (a renewal). False when another run holds it.
     */
    async claimLease(runId: string, now: number, leaseUntil: number): Promise<boolean> {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(lease);
        const holder = snap.get('runId') as string | undefined;
        const until = snap.get('leaseUntil') as number | undefined;
        if (snap.exists && holder !== runId && typeof until === 'number' && until > now) return false;
        tx.set(lease, { runId, leaseUntil });
        return true;
      });
    },

    /** Gives the lease up when `runId` still holds it. */
    async releaseLease(runId: string): Promise<void> {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(lease);
        if (snap.exists && snap.get('runId') === runId) tx.delete(lease);
      });
    },
  };
}

export type MigrationData = ReturnType<typeof migrationData>;
