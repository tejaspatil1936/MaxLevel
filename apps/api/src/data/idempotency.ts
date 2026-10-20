import type { Firestore } from 'firebase-admin/firestore';

/** A response kept for replay under its Idempotency-Key (API-02): status and the exact body sent. */
export interface StoredResponse {
  status: number;
  body: string;
  createdAt: number;
}

/** organizations/{orgId}/idempotencyKeys/{id}, where the ID hashes the caller, the request and the key. */
export function idempotencyData(db: Firestore) {
  const col = (orgId: string) => db.collection(`organizations/${orgId}/idempotencyKeys`);
  return {
    /**
     * Claims the key for one request, atomically (API-02): in one transaction, a stored response younger than `ttlMs`
     * is returned for replay; a claim another request holds until after `now` is `in_progress`; otherwise the record
     * becomes this request's claim, held until `lockedUntil`, and `reserved` is returned. A claim whose holder never
     * finished (a stopped process) can be taken once its lock has run out.
     */
    async reserve(
      orgId: string,
      id: string,
      claim: { token: string; now: number; ttlMs: number; lockedUntil: number },
    ): Promise<{ replay: StoredResponse } | 'in_progress' | 'reserved'> {
      const ref = col(orgId).doc(id);
      return db.runTransaction(async (tx) => {
        const d = await tx.get(ref);
        if (d.exists && typeof d.get('body') === 'string' && claim.now - d.get('createdAt') < claim.ttlMs)
          return { replay: { status: d.get('status'), body: d.get('body'), createdAt: d.get('createdAt') } };
        if (d.exists && typeof d.get('token') === 'string' && d.get('lockedUntil') > claim.now) return 'in_progress';
        tx.set(ref, {
          token: claim.token,
          createdAt: claim.now,
          lockedUntil: claim.lockedUntil,
          expireAt: new Date(claim.now + claim.ttlMs),
        });
        return 'reserved';
      });
    },

    /** Gives up a claim this request still holds (its request was refused), so the key can be sent again. */
    async release(orgId: string, id: string, token: string): Promise<void> {
      const ref = col(orgId).doc(id);
      await db.runTransaction(async (tx) => {
        const d = await tx.get(ref);
        if (d.exists && d.get('token') === token) tx.delete(ref);
      });
    },

    /** `expireAt` lets a Firestore TTL policy remove the record once it can no longer be replayed. */
    async putResponse(orgId: string, id: string, response: StoredResponse, expireAt: number): Promise<void> {
      await col(orgId)
        .doc(id)
        .set({ ...response, expireAt: new Date(expireAt) });
    },
  };
}
export type IdempotencyData = ReturnType<typeof idempotencyData>;
