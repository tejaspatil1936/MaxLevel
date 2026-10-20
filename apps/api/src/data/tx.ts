import type { Transaction, WriteBatch } from 'firebase-admin/firestore';

/** A batch or a transaction; both write the same way, so data functions accept either (AUD-02). */
export type Tx = Transaction | WriteBatch;
export const writer = (tx: Tx) => tx as WriteBatch;
