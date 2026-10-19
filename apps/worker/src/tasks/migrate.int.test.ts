import { TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildWorker } from '../app';
import { loadConfig } from '../config';
import { workerData } from '../data';
import { initFirestore } from '../firebase';
import { LEDGER } from '../migration-data';
import type { Migration } from '../migrations';
import { clearFirestore } from '../test-support/emulators';
import { localTaskQueue } from './local-queue';

// /tasks/migrate on the Firestore emulator (CI-04, REL-04), with the shipped migrations and with injected ones.

const db = initFirestore();
const clock = new TestClock();
const NOW = 1_792_476_000_000;

/** A test migration that counts its runs and, while `fail` is set, throws after writing its marker record. */
function probe(id: string) {
  const state = { runs: 0, fail: false };
  const migration: Migration = {
    id,
    async run() {
      state.runs++;
      await db.doc(`probe/${id}`).set({ at: state.runs });
      if (state.fail) throw new Error(`${id} broke`);
      return 1;
    },
  };
  return { migration, state };
}

const worker = (list?: readonly Migration[]) =>
  buildWorker({
    clock,
    config: { ...loadConfig({ NODE_ENV: 'test' }), logLevel: 'silent' },
    data: workerData(db),
    queue: localTaskQueue(db, clock),
    migrations: { db, ...(list ? { list } : {}), batchSize: 2 },
  });
const migrate = (app: FastifyInstance, payload: object = {}) =>
  app.inject({ method: 'POST', url: '/tasks/migrate', payload });
const ledger = async () => Object.fromEntries((await db.collection(LEDGER).get()).docs.map((d) => [d.id, d.data()]));

beforeEach(async () => {
  await clearFirestore();
  clock.set(NOW);
});

describe('/tasks/migrate', () => {
  it('CI-04 REL-04 applies the shipped migrations once, records them with the clock time, and a rerun applies none', async () => {
    const app = await worker();
    await db.doc('organizations/org-a').set({ name: 'A' });
    await db.doc('organizations/org-a/students/s1').set({ name: 'S1' });
    const res = await migrate(app);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ applied: ['0001-student-accommodations'] });
    expect(await ledger()).toEqual({ '0001-student-accommodations': { version: 1, appliedAt: NOW, changed: 1 } });
    clock.set(NOW + 60_000);
    expect((await migrate(app)).json()).toEqual({ applied: [] });
    expect(await ledger()).toEqual({ '0001-student-accommodations': { version: 1, appliedAt: NOW, changed: 1 } });
    expect((await db.doc('_migrationLease/run').get()).exists, 'lease released').toBe(false);
  });

  it('CI-04 REL-04 a migration that throws stops the run unrecorded; the next run applies it and the rest', async () => {
    const [one, two, three] = [probe('0001-one'), probe('0002-two'), probe('0003-three')];
    const app = await worker([one.migration, two.migration, three.migration]);
    two.state.fail = true;
    const failed = await migrate(app);
    expect(failed.statusCode, 'non-2xx, so Cloud Tasks retries').toBe(500);
    expect(failed.json()).toMatchObject({ error: { code: 'MIGRATION_FAILED', details: { migrationId: '0002-two' } } });
    expect(Object.keys(await ledger())).toEqual(['0001-one']);
    expect(three.state.runs, 'later migrations did not run').toBe(0);
    expect((await db.doc('_migrationLease/run').get()).exists, 'lease released after the failure').toBe(false);

    two.state.fail = false;
    expect((await migrate(app)).json()).toEqual({ applied: ['0002-two', '0003-three'] });
    expect([one.state.runs, two.state.runs, three.state.runs]).toEqual([1, 2, 1]);
    expect(await ledger()).toEqual({
      '0001-one': { version: 1, appliedAt: NOW, changed: 1 },
      '0002-two': { version: 2, appliedAt: NOW, changed: 1 },
      '0003-three': { version: 3, appliedAt: NOW, changed: 1 },
    });
  });

  it('CI-04 refuses an unknown migration with nothing written, and `through` stops at the migration it names', async () => {
    const [one, two] = [probe('0001-one'), probe('0002-two')];
    const app = await worker([one.migration, two.migration]);
    const refused = await migrate(app, { through: '0999-nope' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ error: { code: 'UNKNOWN_MIGRATION' } });
    expect((await db.collection('_migrationLease').get()).size + (await db.collection(LEDGER).get()).size).toBe(0);
    expect(one.state.runs).toBe(0);
    expect((await migrate(app, { through: '0001-one' })).json()).toEqual({ applied: ['0001-one'] });
    expect(two.state.runs).toBe(0);
    expect((await migrate(app, { through: '0001-one' })).json()).toEqual({ applied: [] });
  });

  it('CI-04 REL-04 a run while another holds the lease is refused 409 MIGRATION_RUNNING and applies nothing', async () => {
    const one = probe('0001-one');
    const app = await worker([one.migration]);
    await db.doc('_migrationLease/run').set({ runId: 'other', leaseUntil: NOW + 1000 });
    const res = await migrate(app);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'MIGRATION_RUNNING' } });
    expect(one.state.runs).toBe(0);
    clock.set(NOW + 1000);
    expect((await migrate(app)).json(), 'the lease ran out').toEqual({ applied: ['0001-one'] });
  });

  it('CI-04 REL-04 a run stopped between its data writes and the ledger record re-runs safely', async () => {
    const app = await worker();
    await db.doc('organizations/org-a').set({ name: 'A' });
    for (const id of ['s1', 's2', 's3']) await db.doc(`organizations/org-a/students/${id}`).set({ name: id });
    // The first run's writes land, then it stops before recording: the same migration run directly.
    const { migration } = await import('../migrations/0001-student-accommodations');
    expect(await migration.run({ db, batchSize: 2 })).toBe(3);
    const written = (await db.collection('organizations/org-a/students').get()).docs.map((d) => d.updateTime.valueOf());
    expect((await migrate(app)).json()).toEqual({ applied: ['0001-student-accommodations'] });
    expect((await ledger())['0001-student-accommodations']).toMatchObject({ changed: 0 });
    const after = (await db.collection('organizations/org-a/students').get()).docs.map((d) => d.updateTime.valueOf());
    expect(after, 'nothing written the second time').toEqual(written);
  });
});
