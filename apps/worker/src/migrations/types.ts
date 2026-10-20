import type { Firestore } from 'firebase-admin/firestore';

// Data migrations (CI-04): versioned scripts in this folder, run only by the worker's /tasks/migrate task.

export interface MigrationContext {
  db: Firestore;
  /** Records read or written per page; a migration never reads a collection in one unbounded query. */
  batchSize: number;
}

export interface Migration {
  /** `NNNN-<kebab-name>`, equal to its file name; `NNNN` is its version. */
  id: string;
  /**
   * Brings every organization's records to the new shape and returns how many records it wrote. Idempotent: a run
   * after a finished one writes nothing (REL-04), so a run stopped before its ledger record can simply run again.
   */
  run(ctx: MigrationContext): Promise<number>;
}
