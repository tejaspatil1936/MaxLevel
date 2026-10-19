import type { Clock } from '@mitaoe/shared';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { MigrationData } from '../migration-data';
import { migrationVersion, type Migration, type MigrationContext } from '../migrations';

/** `through` names the last migration to apply; without it every pending migration runs. */
export const migratePayloadSchema = z.object({ through: z.string().min(1).max(128).optional() }).optional();
export type MigrateRun = z.infer<typeof migratePayloadSchema>;

/** How long a run holds the lease before an overlapping delivery may take over; renewed before each migration. */
export const MIGRATION_LEASE_MS = 15 * 60_000;

export type MigrateOutcome =
  | { kind: 'applied'; applied: string[] }
  | { kind: 'unknown' }
  /** Another run holds the lease (or took it over): the queue retries this delivery later. */
  | { kind: 'running' };

/** A migration threw: it is not recorded, later ones did not run, and the next run starts again from it. */
export class MigrationFailedError extends Error {
  constructor(
    readonly migrationId: string,
    cause: unknown,
  ) {
    super(`Migration ${migrationId} failed.`, { cause });
  }
}

/**
 * /tasks/migrate (CI-04, REL-04): applies, in ascending version order, every migration not yet in the ledger (only
 * those up to `through` when named), recording each as it finishes with the Clock's time and its write count. One run
 * at a time holds the lease; an overlapping delivery is refused. An unknown `through` is refused before anything is
 * read or written.
 */
export function migrateHandler(deps: {
  data: MigrationData;
  context: MigrationContext;
  migrations: readonly Migration[];
  clock: Clock;
  log: FastifyBaseLogger;
}) {
  const { data, context, migrations, clock, log } = deps;
  return async (run: MigrateRun): Promise<MigrateOutcome> => {
    const last = run?.through === undefined ? migrations.length - 1 : migrations.findIndex((m) => m.id === run.through);
    if (last < 0 && run?.through !== undefined) return { kind: 'unknown' };
    const runId = crypto.randomUUID();
    if (!(await data.claimLease(runId, clock.now(), clock.now() + MIGRATION_LEASE_MS))) return { kind: 'running' };
    try {
      const done = await data.appliedIds();
      const applied: string[] = [];
      for (const m of migrations.slice(0, last + 1)) {
        if (done.has(m.id)) continue;
        if (!(await data.claimLease(runId, clock.now(), clock.now() + MIGRATION_LEASE_MS))) return { kind: 'running' };
        let changed: number;
        try {
          changed = await m.run(context);
        } catch (err) {
          throw new MigrationFailedError(m.id, err);
        }
        const entry = { version: migrationVersion(m.id) ?? 0, appliedAt: clock.now(), changed };
        if (await data.record(m.id, entry)) applied.push(m.id);
        log.info({ task: 'migrate', migrationId: m.id, changed }, 'migration applied');
      }
      return { kind: 'applied', applied };
    } finally {
      await data.releaseLease(runId);
    }
  };
}
