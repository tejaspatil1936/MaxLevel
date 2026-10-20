import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { createData } from '.';

const { db } = initFirebase();
const data = createData(db);

const stored = async (id: string) => (await db.doc(`organizations/org-a/students/${id}`).get()).get('accommodations');

async function newStudent(): Promise<string> {
  const batch = db.batch();
  const id = data.students.createStudent('org-a', batch, {
    uid: null,
    email: 'aarav@a.test',
    name: 'Aarav',
    prn: 'P-1',
    departmentId: 'dept-a',
    graduationYear: 2027,
    status: 'invited',
    consentAt: null,
    createdAt: 1000,
    updatedAt: 1000,
  });
  await batch.commit();
  return id;
}

beforeEach(async () => {
  await clearEmulators();
});

describe('student accommodations data access', () => {
  it('OPS-07 A11Y-17 an accommodation is stored per series, replaced by the next one, and removed', async () => {
    const id = await newStudent();
    expect(await stored(id)).toEqual({});
    expect((await data.students.getStudent('org-a', id))!.accommodations).toEqual({});

    let batch = db.batch();
    data.students.setAccommodation('org-a', batch, id, 'ser-1', { extraPct: 50 });
    data.students.setAccommodation('org-a', batch, id, 'ser.2', { extraMin: 15 });
    await batch.commit();
    expect(await stored(id)).toEqual({ 'ser-1': { extraPct: 50 }, 'ser.2': { extraMin: 15 } });

    batch = db.batch();
    data.students.setAccommodation('org-a', batch, id, 'ser-1', { extraMin: 5 });
    await batch.commit();
    expect((await data.students.getStudent('org-a', id))!.accommodations).toEqual({
      'ser-1': { extraMin: 5 },
      'ser.2': { extraMin: 15 },
    });

    batch = db.batch();
    data.students.setAccommodation('org-a', batch, id, 'ser-1', null);
    data.students.setAccommodation('org-a', batch, id, 'ser.2', null);
    await batch.commit();
    expect(await stored(id)).toEqual({});
  });

  it('ORG-03 an accommodation write names the org, so another org has no such student to change', async () => {
    const id = await newStudent();
    const batch = db.batch();
    data.students.setAccommodation('org-b', batch, id, 'ser-1', { extraPct: 50 });
    await expect(batch.commit()).rejects.toThrow();
    expect(await stored(id)).toEqual({});
  });
});
