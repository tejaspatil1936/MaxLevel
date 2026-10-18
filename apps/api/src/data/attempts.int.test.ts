import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { createData } from '.';

const { db } = initFirebase();
const data = createData(db);

beforeEach(async () => {
  await clearEmulators();
});

describe('attempt data access', () => {
  it('US-ST-03 ORG-03 lists one student’s attempts in one org, newest first, without draw or result', async () => {
    const put = (orgId: string, id: string, fields: object) =>
      db.doc(`organizations/${orgId}/attempts/${id}`).set({ orgId, ...fields });
    await Promise.all([
      put('org-a', 'a1', {
        testId: 't1',
        seriesId: 's1',
        studentId: 'stu-1',
        status: 'submitted',
        startedAt: 100,
        submittedAt: 900,
        draw: { questionIds: ['q1'] },
        result: { score: 1 },
      }),
      put('org-a', 'a2', { testId: 't2', seriesId: 's1', studentId: 'stu-1', status: 'in_progress', startedAt: 2000 }),
      put('org-a', 'a3', { testId: 't1', seriesId: 's1', studentId: 'stu-2', status: 'submitted', startedAt: 100 }),
      put('org-b', 'b1', { testId: 't9', seriesId: 's9', studentId: 'stu-1', status: 'submitted', startedAt: 100 }),
    ]);
    expect(await data.attempts.listStudentAttempts('org-a', 'stu-1')).toEqual([
      { id: 'a2', testId: 't2', seriesId: 's1', status: 'in_progress', startedAt: 2000, submittedAt: null },
      { id: 'a1', testId: 't1', seriesId: 's1', status: 'submitted', startedAt: 100, submittedAt: 900 },
    ]);
    expect(await data.attempts.listStudentAttempts('org-c', 'stu-1')).toEqual([]);
  });
});
