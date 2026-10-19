import { beforeEach, describe, expect, it } from 'vitest';
import { initFirestore } from './firebase';
import { LEDGER, migrationData } from './migration-data';
import { clearFirestore } from './test-support/emulators';

// The migration ledger and run lease on the Firestore emulator (CI-04, REL-04).

const db = initFirestore();
const data = migrationData(db);

beforeEach(async () => {
  await clearFirestore();
});

describe('migration ledger', () => {
  it('CI-04 REL-04 records a migration once and never rewrites its record', async () => {
    expect(await data.appliedIds()).toEqual(new Set());
    expect(await data.record('0001-a', { version: 1, appliedAt: 1000, changed: 3 })).toBe(true);
    const written = (await db.doc(`${LEDGER}/0001-a`).get()).updateTime?.valueOf();
    expect(await data.record('0001-a', { version: 1, appliedAt: 2000, changed: 0 })).toBe(false);
    const after = await db.doc(`${LEDGER}/0001-a`).get();
    expect(after.data()).toEqual({ version: 1, appliedAt: 1000, changed: 3 });
    expect(after.updateTime?.valueOf()).toBe(written);
    expect(await data.appliedIds()).toEqual(new Set(['0001-a']));
  });
});

describe('migration run lease', () => {
  it('CI-04 REL-04 one run holds the lease; another gets it once it is released or has run out', async () => {
    expect(await data.claimLease('r1', 1000, 2000)).toBe(true);
    expect(await data.claimLease('r2', 1500, 2500), 'held by r1').toBe(false);
    expect(await data.claimLease('r1', 1500, 3000), 'r1 renews').toBe(true);
    await data.releaseLease('r2');
    expect(await data.claimLease('r2', 2000, 3000), 'r2 releasing changed nothing').toBe(false);
    await data.releaseLease('r1');
    expect(await data.claimLease('r2', 2000, 3000)).toBe(true);
    expect(await data.claimLease('r3', 3000, 4000), 'r2 lease ran out').toBe(true);
  });

  it('CI-04 REL-04 of two runs claiming at once exactly one gets the lease', async () => {
    const got = await Promise.all([data.claimLease('a', 1000, 2000), data.claimLease('b', 1000, 2000)]);
    expect(got.filter(Boolean)).toHaveLength(1);
  });
});
