import { migration as studentAccommodations } from './0001-student-accommodations';
import type { Migration } from './types';

export type { Migration, MigrationContext } from './types';

/**
 * Every data migration (CI-04), in ascending version order. Versions are unique and only ever appended: a new
 * migration gets the next number and its own file named after its ID.
 */
export const MIGRATIONS: readonly Migration[] = [studentAccommodations];

/** A migration ID: four digits (the version), then lowercase words joined by `-`. */
export const MIGRATION_ID = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The version a migration ID carries (`0001-…` is 1), or null for an ID of another shape. */
export function migrationVersion(id: string): number | null {
  const m = MIGRATION_ID.exec(id);
  return m ? Number(m[1]) : null;
}

/** Records read or written per page by the shipped migrations (a Firestore batch holds at most 500 writes). */
export const MIGRATION_BATCH_SIZE = 300;
