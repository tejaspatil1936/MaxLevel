import { TestClock, autoSubmitTask } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { TEST_SECRET, testApp } from '../test-support/app';
import { clearEmulators } from '../test-support/emulators';
import { localTaskQueue } from './local-queue';

const { db } = initFirebase();

beforeEach(async () => {
  await clearEmulators();
});

describe('local task queue', () => {
  it('EX-03 EX-16 stores a task once per name with its schedule time, and the test-only API lists it', async () => {
    const clock = new TestClock();
    clock.set(1_000);
    const queue = localTaskQueue(db, clock);
    await queue.enqueue(autoSubmitTask('org-a', 'att-1', 600_000));
    await queue.enqueue(autoSubmitTask('org-a', 'att-1', 600_000));
    await queue.enqueue({ name: 'leaderboard-t1', path: '/tasks/leaderboard', payload: { testId: 't1' } });
    const expected = [
      { name: 'leaderboard-t1', path: '/tasks/leaderboard', scheduleTime: 1_000 },
      { name: 'auto-submit-att-1-600000', path: '/tasks/auto-submit', scheduleTime: 720_000 },
    ];
    expect(await queue.pending()).toEqual(expected);
    expect((await db.doc('_localTasks/auto-submit-att-1-600000').get()).get('payload')).toEqual({
      orgId: 'org-a',
      attemptId: 'att-1',
      deadlineAt: 600_000,
    });

    const { app } = await testApp();
    const res = await app.inject({ method: 'GET', url: '/__test/tasks', headers: { 'x-test-secret': TEST_SECRET } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ tasks: expected });
  });
});
