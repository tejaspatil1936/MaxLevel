import { beforeEach, describe, expect, it } from 'vitest';
import { exportData } from './export-data';
import { initFirestore } from './firebase';
import { clearFirestore } from './test-support/emulators';

const db = initFirestore();
const data = exportData(db);
const org = db.doc('organizations/org-a');

beforeEach(async () => {
  await clearFirestore();
});

describe('export data access', () => {
  it('EXP-03 REL-04 ORG-03 starts a queued export once, and never one that is ready or in another org', async () => {
    const rec = { orgId: 'org-a', scope: 'test', refId: 't1', format: 'csv', filePath: 'p/results-t1.csv' };
    await org
      .collection('exports')
      .doc('e1')
      .set({ ...rec, status: 'queued' });
    await org
      .collection('exports')
      .doc('e2')
      .set({ ...rec, status: 'ready' });

    expect(await data.startExport('org-b', 'e1', 5)).toBeNull();
    expect(await data.startExport('org-a', 'e1', 5)).toMatchObject({ id: 'e1', status: 'running', refId: 't1' });
    expect(await data.startExport('org-a', 'e2', 5)).toBeNull();
    await data.endExport('org-a', 'e1', 'ready', 9);
    expect((await org.collection('exports').doc('e1').get()).data()).toMatchObject({ status: 'ready', readyAt: 9 });
    expect(await data.startExport('org-a', 'e1', 10), 'a second run changes nothing').toBeNull();
  });

  it('EXP-01 EXP-02 ORG-03 reads tests in schedule order, attempts, profiles with department names and boards', async () => {
    await org.set({ timezone: 'Asia/Kolkata' });
    await org.collection('series').doc('s1').set({ orgId: 'org-a' });
    await org.collection('departments').doc('d1').set({ orgId: 'org-a', name: 'Computer Engineering' });
    const test = (id: string, scheduledDate: string, createdAt: number, extra: object = {}) =>
      org
        .collection('tests')
        .doc(id)
        .set({ orgId: 'org-a', seriesId: 's1', title: id, scheduledDate, createdAt, sections: [], ...extra });
    await test('t2', '2026-11-03', 1, { resolved: {} });
    await test('t1', '2026-11-02', 2, { resolved: {}, sections: [{ id: 'q', name: 'Quant', marks: 1 }] });
    await test('t0', '2026-11-03', 0);
    await org.collection('students').doc('stu-1').set({
      orgId: 'org-a',
      name: 'Asha',
      email: 'asha@a.test',
      prn: '2201',
      departmentId: 'd1',
      graduationYear: 2026,
    });
    await org.collection('attempts').doc('a1').set({
      orgId: 'org-a',
      testId: 't1',
      studentId: 'stu-1',
      status: 'terminated',
      startedAt: 1,
      submittedAt: 2,
      terminationReason: 'max_strikes',
    });
    await org
      .collection('leaderboards')
      .doc('test_t1')
      .set({ computedAt: 1, pageCount: 2, rows: [{ rank: 1 }] });
    await org
      .collection('leaderboards/test_t1/pages')
      .doc('1')
      .set({ rows: [{ rank: 2 }] });

    expect(await data.timezone('org-a')).toBe('Asia/Kolkata');
    expect(await data.seriesExists('org-a', 's1')).toBe(true);
    expect(await data.seriesExists('org-b', 's1')).toBe(false);
    const tests = await data.listSeriesTests('org-a', 's1');
    expect(tests.map((t) => [t.id, t.published])).toEqual([
      ['t1', true],
      ['t0', false],
      ['t2', true],
    ]);
    expect(tests[0]!.sections).toEqual([{ id: 'q', name: 'Quant' }]);
    expect(await data.getTest('org-b', 't1')).toBeNull();
    expect(await data.listAttempts('org-a', 't1')).toEqual([
      {
        testId: 't1',
        studentId: 'stu-1',
        status: 'terminated',
        startedAt: 1,
        submittedAt: 2,
        strikesCount: 0,
        terminationReason: 'max_strikes',
        extraTimeSec: 0,
      },
    ]);
    expect(await data.students('org-a', ['stu-1', 'stu-x'])).toEqual(
      new Map([
        [
          'stu-1',
          {
            name: 'Asha',
            email: 'asha@a.test',
            prn: '2201',
            department: 'Computer Engineering',
            graduationYear: 2026,
          },
        ],
      ]),
    );
    expect((await data.boardRows('org-a', 'test_t1')).map((r) => r.rank)).toEqual([1, 2]);
    expect(await data.boardRows('org-a', 'test_t2')).toEqual([]);
  });
});
