import { TestClock } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { workerData } from './data';
import { initFirestore } from './firebase';
import { localTaskQueue } from './tasks/local-queue';
import { clearFirestore } from './test-support/emulators';

const db = initFirestore();
const data = workerData(db);

beforeEach(async () => {
  await clearFirestore();
});

describe('worker data access', () => {
  it('EX-17 ORG-03 reads an attempt, its published test and the answer keys of named questions in one org', async () => {
    const org = db.doc('organizations/org-a');
    await org.collection('attempts').doc('att-1').set({ orgId: 'org-a', testId: 't1', status: 'in_progress' });
    await org
      .collection('tests')
      .doc('t1')
      .set({ seriesId: 's1', sections: [{ id: 'x' }], resolved: { maxStrikes: 3 } });
    await org.collection('tests').doc('t2').set({ seriesId: 's1', sections: [] });
    const questions = org.collection('tests/t1/questions');
    await questions.doc('q1').set({ correctOptionIds: ['a'], marks: 2, explanation: 'never needed' });
    await questions.doc('q2').set({ correctOptionIds: ['c'], negativeMarks: 0 });

    expect(await data.getAttempt('org-a', 'att-1')).toMatchObject({
      id: 'att-1',
      status: 'in_progress',
      strikesCount: 0,
    });
    expect(await data.getAttempt('org-b', 'att-1')).toBeNull();
    expect(await data.getGradedTest('org-a', 't1')).toEqual({
      id: 't1',
      seriesId: 's1',
      sections: [{ id: 'x' }],
      resolved: { maxStrikes: 3 },
    });
    expect(await data.getGradedTest('org-a', 't2'), 'not published').toBeNull();
    expect(await data.answerKeys('org-a', 't1', ['q1', 'q2', 'q9'])).toEqual(
      new Map([
        ['q1', { correctOptionIds: ['a'], marks: 2 }],
        ['q2', { correctOptionIds: ['c'], negativeMarks: 0 }],
      ]),
    );
    expect(await data.answerKeys('org-b', 't1', ['q1'])).toEqual(new Map());
  });

  it('EX-16 REL-04 finishes an attempt in progress once, and leaves it when finish declines', async () => {
    const ref = db.doc('organizations/org-a/attempts/att-1');
    await ref.set({ orgId: 'org-a', testId: 't1', status: 'in_progress', draw: { questionIds: ['q1'] } });
    await ref.collection('answers').doc('q1').set({ optionId: 'b', seq: 1, clientTs: 1, serverTs: 1 });
    const result = { score: 0, max: 1, pct: 0, correct: 0, incorrect: 1, unanswered: 0, sections: {}, durationSec: 1 };

    expect(await data.finalizeAttempt('org-a', 'att-1', () => null)).toMatchObject({ finalized: false });
    expect((await ref.get()).get('status')).toBe('in_progress');
    let seen: unknown;
    const done = await data.finalizeAttempt('org-a', 'att-1', (_a, answers) => {
      seen = answers;
      return { status: 'auto_submitted', submittedAt: 9, result };
    });
    expect(done).toMatchObject({ finalized: true, attempt: { status: 'auto_submitted', submittedAt: 9 } });
    expect(seen).toEqual({ q1: { optionId: 'b', seq: 1, clientTs: 1, serverTs: 1 } });
    const again = await data.finalizeAttempt('org-a', 'att-1', () => ({
      status: 'submitted',
      submittedAt: 99,
      result,
    }));
    expect(again).toMatchObject({ finalized: false, attempt: { status: 'auto_submitted', submittedAt: 9 } });
    expect(await data.finalizeAttempt('org-a', 'missing', () => null)).toBeNull();
  });

  it('EX-16 the worker queues tasks in the shared local queue once per name', async () => {
    const clock = new TestClock();
    clock.set(5_000);
    const queue = localTaskQueue(db, clock);
    const task = { name: 'leaderboard-x', path: '/tasks/leaderboard' as const, payload: { testId: 't1' } };
    await queue.enqueue(task);
    await queue.enqueue({ ...task, payload: { testId: 'other' } });
    expect((await db.doc('_localTasks/leaderboard-x').get()).data()).toEqual({
      ...task,
      scheduleTime: 5_000,
      status: 'pending',
      createdAt: 5_000,
    });
  });

  it('LB-01 LB-02 ORG-03 reads the finished attempts of a test with names, and the published tests of a series', async () => {
    const org = db.doc('organizations/org-a');
    await org.collection('students').doc('stu-1').set({ name: 'Asha', departmentId: 'd1' });
    const attempt = (status: string, studentId: string, extra: object = {}) => ({
      orgId: 'org-a',
      testId: 't1',
      studentId,
      status,
      startedAt: 1_000,
      submittedAt: 61_000,
      result: { score: 3, durationSec: 60, max: 4 },
      ...extra,
    });
    await org.collection('attempts').doc('a1').set(attempt('submitted', 'stu-1'));
    await org.collection('attempts').doc('a2').set(attempt('terminated', 'stu-2'));
    await org
      .collection('attempts')
      .doc('a3')
      .set(attempt('in_progress', 'stu-3', { result: null }));
    await org
      .collection('attempts')
      .doc('a4')
      .set(attempt('submitted', 'stu-4', { testId: 't2' }));
    await org
      .collection('tests')
      .doc('t1')
      .set({ seriesId: 's1', resolved: { resultRelease: 'immediate' } });
    await org.collection('tests').doc('t3').set({ seriesId: 's1' });

    const rows = await data.listRankableAttempts('org-a', 't1');
    expect(rows.sort((a, b) => a.studentId.localeCompare(b.studentId))).toEqual([
      {
        studentId: 'stu-1',
        name: 'Asha',
        departmentId: 'd1',
        status: 'submitted',
        score: 3,
        timeSec: 60,
        submittedAt: 61_000,
      },
      {
        studentId: 'stu-2',
        name: '',
        departmentId: '',
        status: 'terminated',
        score: 3,
        timeSec: 60,
        submittedAt: 61_000,
      },
    ]);
    expect(await data.listRankableAttempts('org-b', 't1')).toEqual([]);
    expect(
      (await data.listSeriesReleaseTests('org-a', 's1')).map((t) => t.id),
      'published only',
    ).toEqual(['t1']);
  });

  it('LB-03 DATA-04 stores a board with its total, and pages above 5,000 rows that a smaller board removes', async () => {
    const row = (n: number) => ({
      studentId: `s${n}`,
      name: `S ${n}`,
      departmentId: 'd',
      score: 1,
      rank: 1,
      timeSec: 0,
    });
    const board = db.doc('organizations/org-a/leaderboards/test_t1');
    await data.putLeaderboard(
      'org-a',
      'test_t1',
      5,
      Array.from({ length: 5_001 }, (_, i) => row(i)),
    );
    expect((await board.get()).data()).toMatchObject({ computedAt: 5, total: 5_001, pageCount: 2 });
    expect((await board.get()).get('rows')).toHaveLength(5_000);
    expect((await board.collection('pages').doc('1').get()).get('rows')).toEqual([row(5_000)]);

    await data.putLeaderboard('org-a', 'test_t1', 6, [row(1)]);
    expect((await board.get()).data()).toEqual({ computedAt: 6, total: 1, pageCount: 1, rows: [row(1)] });
    expect((await board.collection('pages').doc('1').get()).exists).toBe(false);
  });

  it('PERF-06 ORG-03 reads the pre-warm target, counts the eligible registered students and records the slot', async () => {
    const org = db.doc('organizations/org-a');
    const window = { start: 1_000, end: 2_000 };
    await org
      .collection('series')
      .doc('s1')
      .set({ eligibility: { departmentIds: ['cs', 'it'] } });
    await org
      .collection('tests')
      .doc('t1')
      .set({ seriesId: 's1', status: 'scheduled', resolved: { window }, eligibility: { exclude: ['st-3'] } });
    await org.collection('tests').doc('t2').set({ seriesId: 's1', status: 'draft' });
    const student = (id: string, status: string, departmentId: string) =>
      org.collection('students').doc(id).set({ status, departmentId, graduationYear: 2027 });
    await student('st-1', 'registered', 'cs');
    await student('st-2', 'registered', 'it');
    await student('st-3', 'registered', 'cs');
    await student('st-4', 'invited', 'cs');
    await student('st-5', 'registered', 'mech');
    await db.doc('organizations/org-b/students/st-6').set({ status: 'registered', departmentId: 'cs' });

    expect(await data.getPrewarmTarget('org-a', 't1')).toEqual({ status: 'scheduled', window, prewarmedFor: null });
    expect(await data.getPrewarmTarget('org-a', 't2')).toEqual({ status: 'draft', window: null, prewarmedFor: null });
    expect(await data.getPrewarmTarget('org-b', 't1')).toBeNull();
    expect(await data.countEligibleStudents('org-a', 't1')).toBe(2);
    await data.markPrewarmed('org-a', 't1', 1_000, 400);
    expect(await data.getPrewarmTarget('org-a', 't1')).toMatchObject({ prewarmedFor: 1_000 });
  });
});
