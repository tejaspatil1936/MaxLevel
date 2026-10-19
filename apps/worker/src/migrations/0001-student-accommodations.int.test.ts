import { beforeEach, describe, expect, it } from 'vitest';
import { initFirestore } from '../firebase';
import { clearFirestore } from '../test-support/emulators';
import { migration } from './0001-student-accommodations';

// 0001-student-accommodations on the Firestore emulator (CI-04, REL-04).

const db = initFirestore();
const student = (orgId: string, id: string) => db.doc(`organizations/${orgId}/students/${id}`);
const updateTimes = async (orgId: string) =>
  Object.fromEntries(
    (await db.collection(`organizations/${orgId}/students`).get()).docs.map((d) => [d.id, d.updateTime.valueOf()]),
  );

beforeEach(async () => {
  await clearFirestore();
  const batch = db.batch();
  for (const orgId of ['org-a', 'org-b', 'org-c']) {
    batch.set(db.doc(`organizations/${orgId}`), { name: orgId });
    for (let i = 1; i <= 5; i++) {
      const old = orgId !== 'org-c' && i % 2 === 1; // org-a and org-b: 1, 3, 5 have the old shape
      batch.set(student(orgId, `st-${i}`), {
        name: `Student ${i}`,
        ...(old ? {} : { accommodations: i === 4 ? { extraTimePct: 25 } : {} }),
      });
    }
  }
  await batch.commit();
});

describe('0001-student-accommodations', () => {
  it('CI-04 pages through students in batches across several organizations and backfills only old records', async () => {
    const untouched = {
      c: await updateTimes('org-c'),
      a4: (await student('org-a', 'st-4').get()).updateTime?.valueOf(),
    };
    // Pages of 2: three organizations need two pages, each organization's five students three pages.
    expect(await migration.run({ db, batchSize: 2 })).toBe(6);
    for (const orgId of ['org-a', 'org-b'])
      for (const i of [1, 3, 5])
        expect((await student(orgId, `st-${i}`).get()).get('accommodations'), `${orgId} st-${i}`).toEqual({});
    expect((await student('org-a', 'st-4').get()).get('accommodations')).toEqual({ extraTimePct: 25 });
    expect((await student('org-a', 'st-4').get()).updateTime?.valueOf(), 'st-4 not written').toBe(untouched.a4);
    expect(await updateTimes('org-c'), 'org-c already current').toEqual(untouched.c);
    expect((await student('org-a', 'st-1').get()).get('name'), 'other fields kept').toBe('Student 1');
  });

  it('CI-04 REL-04 running it again without a ledger record writes nothing', async () => {
    expect(await migration.run({ db, batchSize: 3 })).toBe(6);
    const before = { a: await updateTimes('org-a'), b: await updateTimes('org-b') };
    expect(await migration.run({ db, batchSize: 3 })).toBe(0);
    expect({ a: await updateTimes('org-a'), b: await updateTimes('org-b') }).toEqual(before);
  });
});
