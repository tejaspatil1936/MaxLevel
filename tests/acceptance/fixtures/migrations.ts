import { expect, type APIRequestContext } from '@playwright/test';
import type { ApiClient } from './api';
import type { Emulators, StoredDoc } from './emulators';
import { WORKER_URL } from './results';
import type { SeedOrg } from './seed';

// Phase 8 migrations (CI-04, REL-04): the worker's /tasks/migrate task, its ledger and the records it changes
// (docs/testids/phase-8.md, "Migrations").

/** The one migration v1 ships: backfills `accommodations: {}` on student records that lack it. */
export const MIGRATION_0001 = '0001-student-accommodations';

/** Root collection holding one record per applied migration. */
export const LEDGER = '_migrations';

/** A migration ID: four digits, then lowercase words joined by `-`. */
export const MIGRATION_ID = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The version a migration ID carries (`0001-…` is 1). */
export function versionOf(id: string): number {
  const m = MIGRATION_ID.exec(id);
  expect(m, `migration ID ${id}`).not.toBeNull();
  return Number(m![1]);
}

export interface MigrateResult {
  status: number;
  body: { applied?: string[]; error?: { code?: string } } | null;
}

/** Calls the worker's migrate task (open without OIDC in test mode) and returns its status and body. */
export async function runMigrateTask(
  request: APIRequestContext,
  payload: { through?: string } = {},
): Promise<MigrateResult> {
  const res = await request.post(`${WORKER_URL}/tasks/migrate`, { data: payload });
  const text = await res.text();
  let body: MigrateResult['body'] = null;
  try {
    body = text ? (JSON.parse(text) as MigrateResult['body']) : null;
  } catch {
    body = null;
  }
  return { status: res.status(), body };
}

/** The IDs a successful run applied; fails unless the run answered 200 with an `applied` list. */
export function appliedBy(run: MigrateResult): string[] {
  expect(run.status, `migrate task: ${JSON.stringify(run.body)}`).toBe(200);
  expect(Array.isArray(run.body?.applied), `applied list in ${JSON.stringify(run.body)}`).toBe(true);
  return run.body!.applied!;
}

/** The ledger's records (one per applied migration). */
export function ledger(e: Emulators): Promise<StoredDoc[]> {
  return e.list('', LEDGER);
}

/** The ledger record of one migration, or null when it is not applied. */
export function ledgerEntry(e: Emulators, id: string): Promise<StoredDoc | null> {
  return e.doc(`${LEDGER}/${id}`);
}

/** A student record as stored; fails when it does not exist. */
export async function storedStudent(e: Emulators, orgId: string, studentId: string): Promise<StoredDoc> {
  const doc = await e.doc(`organizations/${orgId}/students/${studentId}`);
  expect(doc, `student ${studentId} of ${orgId}`).not.toBeNull();
  return doc!;
}

/** Last-write times of every student record of the organization, by student ID. */
export function studentWriteTimes(e: Emulators, org: SeedOrg): Promise<Record<string, string>> {
  return e.updateTimes(`organizations/${org.id}`, 'students');
}

/** Last-write times of every ledger record, by migration ID. */
export function ledgerWriteTimes(e: Emulators): Promise<Record<string, string>> {
  return e.updateTimes('', LEDGER);
}

/** Calls `POST /tasks/migrate` on the API (which must not have that route) with this account's token. */
export async function migrateThroughApi(api: ApiClient): Promise<number> {
  return (await api.post('/tasks/migrate', {})).status;
}
