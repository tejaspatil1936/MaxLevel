import { AUTHORING_NOW } from '../fixtures/authoring';
import {
  appliedBy,
  ledger,
  ledgerEntry,
  ledgerWriteTimes,
  MIGRATION_0001,
  MIGRATION_ID,
  migrateThroughApi,
  runMigrateTask,
  storedStudent,
  studentWriteTimes,
  versionOf,
} from '../fixtures/migrations';
import { accounts, ORG_A, ORG_B, seededStudent } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';

// F-8.02 Versioned migrations run through the worker's /tasks/migrate task, idempotently (CI-04, REL-04). Contract:
// docs/testids/phase-8.md, "Feature F-8.02". Deploy freeze (REL-01), rollback (REL-02) and the deploy pipeline
// (CI-03) are owner checks (docs/MANUAL_CHECKS.md).

const a1 = seededStudent(ORG_A, 1).id;
const a2 = seededStudent(ORG_A, 2).id;
const a3 = seededStudent(ORG_A, 3).id;
const b1 = seededStudent(ORG_B, 1).id;

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(AUTHORING_NOW);
});

test.describe('F-8.02 migrations runner', () => {
  test('CI-04 REL-04 a migrate task applies pending migrations in version order across organizations, records each in the ledger, and a second run changes nothing', async ({
    request,
    testApi,
    emulators,
  }) => {
    expect(await ledger(emulators), 'no ledger before the first run').toEqual([]);
    expect(await testApi.seedPreMigrationStudents(ORG_A.id, [a1, a2])).toEqual([a1, a2]);
    expect(await testApi.seedPreMigrationStudents(ORG_B.id, [b1])).toEqual([b1]);
    expect((await storedStudent(emulators, ORG_A.id, a1)).data.accommodations, 'old shape').toBeUndefined();
    const untouchedBefore = (await studentWriteTimes(emulators, ORG_A))[a3];
    expect(untouchedBefore, `${a3} exists`).toBeTruthy();

    // First run: every pending migration, ascending version, 0001 among them.
    const applied = appliedBy(await runMigrateTask(request));
    expect(applied).toContain(MIGRATION_0001);
    for (const id of applied) expect(id).toMatch(MIGRATION_ID);
    const versions = applied.map(versionOf);
    expect(versions, 'ascending version order').toEqual([...versions].sort((x, y) => x - y));
    expect(new Set(versions).size, 'unique versions').toBe(versions.length);

    // The records it was written for now have the field; one that already had it was not written.
    for (const [orgId, id] of [
      [ORG_A.id, a1],
      [ORG_A.id, a2],
      [ORG_B.id, b1],
    ] as const)
      expect((await storedStudent(emulators, orgId, id)).data.accommodations, `${id} backfilled`).toEqual({});
    expect((await studentWriteTimes(emulators, ORG_A))[a3], `${a3} not written`).toBe(untouchedBefore);

    // The ledger holds exactly the applied migrations, with their version, the clock's time and what changed.
    const entries = await ledger(emulators);
    expect(entries.map((d) => d.id).sort()).toEqual([...applied].sort());
    for (const d of entries) {
      expect(d.data.version, `${d.id} version`).toBe(versionOf(d.id));
      expect(d.data.appliedAt, `${d.id} appliedAt from the Clock`).toBe(AUTHORING_NOW);
    }
    const first = await ledgerEntry(emulators, MIGRATION_0001);
    expect(first?.data.changed, '0001 wrote the three old-shape records').toBe(3);

    // Second run: nothing pending, nothing written (REL-04).
    const ledgerTimes = await ledgerWriteTimes(emulators);
    const studentsA = await studentWriteTimes(emulators, ORG_A);
    const studentsB = await studentWriteTimes(emulators, ORG_B);
    await testApi.clock.advance(60_000);
    expect(appliedBy(await runMigrateTask(request)), 'second run applies nothing').toEqual([]);
    expect(await ledgerWriteTimes(emulators), 'ledger not rewritten').toEqual(ledgerTimes);
    expect(await studentWriteTimes(emulators, ORG_A), 'org A students not written').toEqual(studentsA);
    expect(await studentWriteTimes(emulators, ORG_B), 'org B students not written').toEqual(studentsB);
    expect((await ledgerEntry(emulators, MIGRATION_0001))?.data.appliedAt).toBe(AUTHORING_NOW);
  });

  test('CI-04 REL-04 two migrate tasks at once apply each migration once', async ({ request, testApi, emulators }) => {
    await testApi.seedPreMigrationStudents(ORG_A.id, [a1, a2]);

    const runs = await Promise.all([runMigrateTask(request), runMigrateTask(request)]);
    for (const run of runs) {
      // A run that overlaps another either skips what the other applies or is refused for a later retry.
      if (run.status === 409) expect(run.body?.error?.code).toBe('MIGRATION_RUNNING');
      else expect(run.status, JSON.stringify(run.body)).toBe(200);
    }
    const appliedLists = runs.filter((r) => r.status === 200).map((r) => r.body?.applied ?? []);
    expect(
      appliedLists.filter((list) => list.includes(MIGRATION_0001)),
      '0001 applied by exactly one run',
    ).toHaveLength(1);

    const entries = await ledger(emulators);
    expect(entries.filter((d) => d.id === MIGRATION_0001)).toHaveLength(1);
    expect((await ledgerEntry(emulators, MIGRATION_0001))?.data.changed, 'two records written once').toBe(2);
    expect((await storedStudent(emulators, ORG_A.id, a1)).data.accommodations).toEqual({});

    // Whatever was refused or skipped, a later run finds nothing left to do.
    expect(appliedBy(await runMigrateTask(request))).toEqual([]);
  });

  test('CI-04 a migrate task naming an unknown migration is refused and applies nothing; naming 0001 then applies only it', async ({
    request,
    testApi,
    emulators,
  }) => {
    await testApi.seedPreMigrationStudents(ORG_A.id, [a1]);
    const before = await studentWriteTimes(emulators, ORG_A);

    const refused = await runMigrateTask(request, { through: '0999-no-such-migration' });
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body?.error?.code).toBe('UNKNOWN_MIGRATION');
    expect(await ledger(emulators), 'nothing recorded').toEqual([]);
    expect(await studentWriteTimes(emulators, ORG_A), 'nothing written').toEqual(before);
    expect((await storedStudent(emulators, ORG_A.id, a1)).data.accommodations).toBeUndefined();

    // `through` the first migration applies exactly that one.
    expect(appliedBy(await runMigrateTask(request, { through: MIGRATION_0001 }))).toEqual([MIGRATION_0001]);
    expect((await ledger(emulators)).map((d) => d.id)).toEqual([MIGRATION_0001]);
    expect((await storedStudent(emulators, ORG_A.id, a1)).data.accommodations).toEqual({});
    expect(appliedBy(await runMigrateTask(request, { through: MIGRATION_0001 })), 'already applied').toEqual([]);
  });

  test('CI-04 REL-04 on records that are already current 0001 is recorded with nothing changed, and the API offers no way to run migrations', async ({
    request,
    emulators,
    apiAs,
  }) => {
    const studentsA = await studentWriteTimes(emulators, ORG_A);
    const studentsB = await studentWriteTimes(emulators, ORG_B);
    expect(Object.keys(studentsA).length, 'seeded org A students').toBeGreaterThanOrEqual(20);

    expect(appliedBy(await runMigrateTask(request))).toContain(MIGRATION_0001);
    const entry = await ledgerEntry(emulators, MIGRATION_0001);
    expect(entry, '0001 recorded').not.toBeNull();
    expect(entry!.data.changed, 'no record needed it').toBe(0);
    expect(entry!.data.appliedAt).toBe(AUTHORING_NOW);
    expect(await studentWriteTimes(emulators, ORG_A), 'org A students not written').toEqual(studentsA);
    expect(await studentWriteTimes(emulators, ORG_B), 'org B students not written').toEqual(studentsB);

    // Migrations run only as worker tasks (CI-04): not through the API, whoever asks.
    expect(await migrateThroughApi(await apiAs(accounts.superAdmin)), 'super admin on the API').toBe(404);
    expect(await migrateThroughApi(await apiAs(accounts.adminA)), 'admin on the API').toBe(404);
  });
});
