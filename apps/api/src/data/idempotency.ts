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
    async getResponse(orgId: string, id: string): Promise<StoredResponse | null> {
      const d = await col(orgId).doc(id).get();
      if (!d.exists) return null;
      return { status: d.get('status'), body: d.get('body'), createdAt: d.get('createdAt') };
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
