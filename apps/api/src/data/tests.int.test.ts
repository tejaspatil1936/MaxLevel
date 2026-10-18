import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { createData } from '.';

const { db } = initFirebase();
const data = createData(db);
const input = { seriesId: 's1', title: 'Aptitude', dayHidden: false, scheduledDate: '2026-11-03' };

beforeEach(async () => {
  await clearEmulators();
});

async function create(orgId: string, extra: object, now: number) {
  const batch = db.batch();
  const id = data.tests.createTest(orgId, batch, { ...input, ...extra }, now);
  await batch.commit();
  return id;
}

describe('tests data access', () => {
  it('TST-01 TST-04 a created test is a draft in its org with no overrides and no day number stored', async () => {
    const id = await create('org-a', { company: 'TCS', dayNumber: null }, 1000);
    expect((await db.doc(`organizations/org-a/tests/${id}`).get()).data()).toEqual({
      orgId: 'org-a',
      ...input,
      company: 'TCS',
      overrides: {},
      eligibility: { departmentIds: [], graduationYears: [], include: [], exclude: [] },
      sections: [],
      status: 'draft',
      questionSetVersion: 1,
      totalMarks: 0,
      attemptsStarted: false,
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(await data.tests.getTest('org-a', id)).toMatchObject({ id, title: 'Aptitude', dayNumber: null });
    expect(await data.tests.getTest('org-b', id)).toBeNull();
  });

  it('SER-03 TST-02 a series lists its tests by scheduled date, then creation order, in its org only', async () => {
    const late = await create('org-a', { title: 'Late', scheduledDate: '2026-11-05' }, 1000);
    const second = await create('org-a', { title: 'Second' }, 3000);
    const first = await create('org-a', { title: 'First' }, 2000);
    await create('org-a', { seriesId: 's2' }, 1000);
    await create('org-b', {}, 1000);
    expect((await data.tests.listTests('org-a', 's1')).map((t) => t.id)).toEqual([first, second, late]);
    expect(await data.tests.listTests('org-b', 's2')).toEqual([]);
  });

  it('TST-02 updates rename or hide the day label and null removes the company', async () => {
    const id = await create('org-a', { company: 'TCS' }, 1000);
    const batch = db.batch();
    data.tests.updateTest('org-a', batch, id, { dayNumber: 'Mock 1', dayHidden: true, company: null, updatedAt: 2000 });
    await batch.commit();
    const stored = (await db.doc(`organizations/org-a/tests/${id}`).get()).data();
    expect(stored).toMatchObject({ dayNumber: 'Mock 1', dayHidden: true, updatedAt: 2000 });
    expect(stored).not.toHaveProperty('company');
    const clear = db.batch();
    data.tests.updateTest('org-a', clear, id, { dayNumber: null, updatedAt: 3000 });
    await clear.commit();
    expect(await data.tests.getTest('org-a', id)).toMatchObject({ dayNumber: null, dayHidden: true });
  });
});
