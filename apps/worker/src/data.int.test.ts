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
    await ref.set({ orgId: 'org-a', testId: 't1', status: 'in_progress' });
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
});
