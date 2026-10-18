import type { PairingRefusal } from '@mitaoe/shared';
import type { Firestore } from 'firebase-admin/firestore';

/** A phone pairing link as stored (PR-13), keyed by the SHA-256 of its secret: the secret itself is never stored. */
export interface PairingTokenRecord {
  orgId: string;
  testId: string;
  attemptId: string;
  studentId: string;
  uid: string;
  issuedAt: number;
  expiresAt: number;
  usedAt?: number;
}

/** Phone pairing tokens under `organizations/{orgId}/pairingTokens/{key}` (ORG-03). */
export function pairingData(db: Firestore) {
  const tokens = (orgId: string) => db.collection(`organizations/${orgId}/pairingTokens`);

  return {
    async createToken(orgId: string, key: string, record: Omit<PairingTokenRecord, 'orgId'>): Promise<void> {
      await tokens(orgId)
        .doc(key)
        .create({ orgId, ...record });
    },

    /**
     * PR-13, PR-14: uses a token once. In one transaction `decide` judges the stored token; only `ok` marks it used at
     * `now`, so two phones redeeming the same link get one sign-in between them. Null for an unknown token.
     */
    async redeemToken(
      orgId: string,
      key: string,
      now: number,
      decide: (record: PairingTokenRecord) => 'ok' | PairingRefusal,
    ): Promise<{ record: PairingTokenRecord } | PairingRefusal | null> {
      const ref = tokens(orgId).doc(key);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const record = snap.data() as PairingTokenRecord;
        const verdict = decide(record);
        if (verdict !== 'ok') return verdict;
        tx.update(ref, { usedAt: now });
        return { record: { ...record, usedAt: now } };
      });
    },
  };
}
