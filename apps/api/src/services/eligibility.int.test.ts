import { NO_RESTRICTION } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createData } from '../data';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { seedBase } from '../test-support/seed';
import { eligibilityService } from './eligibility';

const { db } = initFirebase();
const data = createData(db);
const service = eligibilityService(data);
const computer = 'dept-org-a-computer';

async function series(orgId: string, status: string, eligibility = NO_RESTRICTION) {
  const ref = db.collection(`organizations/${orgId}/series`).doc();
  await ref.set({
    orgId,
    title: `${status} series`,
    status,
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    defaults: {},
    eligibility,
  });
  return ref.id;
}

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
});

describe('eligibility service', () => {
  it('SER-02 a student sees only active series whose rules admit them', async () => {
    const open = await series('org-a', 'active');
    const forComputer = await series('org-a', 'active', { ...NO_RESTRICTION, departmentIds: [computer] });
    await series('org-a', 'draft');
    await series('org-a', 'archived');
    const excluded = await series('org-a', 'active', { ...NO_RESTRICTION, exclude: ['stu-org-a-01'] });
    await series('org-b', 'active');

    // Student 01 is in Computer, student 02 in IT.
    expect((await service.visibleSeries('org-a', 'stu-org-a-01')).map((s) => s.id).sort()).toEqual(
      [open, forComputer].sort(),
    );
    expect((await service.visibleSeries('org-a', 'stu-org-a-02')).map((s) => s.id).sort()).toEqual(
      [open, excluded].sort(),
    );
    expect(await service.visibleSeries('org-a', 'stu-org-b-01')).toEqual([]);
  });

  it('SER-02 SER-04 a disabled student sees no series, even an open one', async () => {
    await series('org-a', 'active');
    await db.doc('organizations/org-a/students/stu-org-a-03').update({ status: 'disabled' });
    expect(await service.visibleSeries('org-a', 'stu-org-a-03')).toEqual([]);
  });

  it('SER-07 the matching list holds registered students admitted by both rule sets, sorted by name', async () => {
    await db.doc('organizations/org-a/students/stu-org-a-05').update({ status: 'disabled' });
    const all = await service.matchingStudents('org-a', NO_RESTRICTION);
    expect(all).toHaveLength(19);
    expect(all.map((s) => s.name)).toEqual([...all.map((s) => s.name)].sort((a, b) => a.localeCompare(b)));
    const computer2026 = await service.matchingStudents(
      'org-a',
      { ...NO_RESTRICTION, departmentIds: [computer] },
      { ...NO_RESTRICTION, graduationYears: [2026] },
    );
    // Computer: students 01, 05 (disabled), 09, 13, 17, all graduating in 2026.
    expect(computer2026.map((s) => s.id).sort()).toEqual([
      'stu-org-a-01',
      'stu-org-a-09',
      'stu-org-a-13',
      'stu-org-a-17',
    ]);
    expect(computer2026[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      prn: expect.stringMatching(/^220101/),
      departmentId: computer,
      graduationYear: 2026,
    });
  });
});
