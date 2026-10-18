import { TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorker } from '../app';
import { loadConfig } from '../config';
import { workerData } from '../data';
import { initFirestore } from '../firebase';
import { clearFirestore } from '../test-support/emulators';
import { localTaskQueue } from './local-queue';

// /tasks/release-results on the Firestore emulator (RES-01, LB-03, REL-04): `after_close` results are released at the
// window end with no admin, and every run queues the leaderboard recompute.

const db = initFirestore();
const clock = new TestClock();
let app: FastifyInstance;
const test = db.doc('organizations/org-a/tests/t1');
const START = 1_793_592_000_000;
const END = START + 60 * 60_000;

beforeAll(async () => {
  app = await buildWorker({
    clock,
    config: { ...loadConfig({ NODE_ENV: 'test' }), logLevel: 'silent' },
    data: workerData(db),
    queue: localTaskQueue(db, clock),
  });
});

const publish = (resolved: object, extra: object = {}) =>
  test.set({
    orgId: 'org-a',
    seriesId: 's1',
    status: 'scheduled',
    resolved: {
      timingMode: 'fixed',
      window: { start: START, end: END },
      resultRelease: 'after_close',
      resultDetail: 'score',
      ...resolved,
    },
    ...extra,
  });

beforeEach(async () => {
  await clearFirestore();
  clock.set(END);
});

const run = async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/tasks/release-results',
    payload: { orgId: 'org-a', testId: 't1' },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ outcome: string }>().outcome;
};
const released = async () => (await test.get()).get('resultsReleasedAt') as number | undefined;
const boardTasks = async () =>
  (await db.collection('_localTasks').get()).docs
    .map((d) => d.data())
    .filter((t) => t.path === '/tasks/leaderboard')
    .map((t) => ({ name: t.name, scheduleTime: t.scheduleTime, payload: t.payload }));

describe('/tasks/release-results', () => {
  it('RES-01 LB-03 REL-04 releases after_close results at the window end once and queues one recompute', async () => {
    await publish({});
    clock.set(END + 5_000);
    expect(await run()).toBe('released');
    expect(await released()).toBe(END + 5_000);
    const queued = await boardTasks();
    expect(queued).toEqual([
      {
        name: `leaderboard-org-a-t1-close-${END}`,
        scheduleTime: END + 5_000,
        payload: { orgId: 'org-a', testId: 't1', seriesId: 's1' },
      },
    ]);
    clock.set(END + 9_000);
    expect(await run(), 'a second run changes nothing').toBe('recomputed');
    expect(await released()).toBe(END + 5_000);
    expect(await boardTasks()).toEqual(queued);
    expect((await db.collection('organizations/org-a/audit').get()).size, 'no audit entry').toBe(0);
  });

  it('RES-01 stores nothing before the window end, and queues the task again for a window end that moved', async () => {
    await publish({ window: { start: START, end: END + 600_000 } });
    clock.set(END);
    expect(await run()).toBe('early');
    expect(await released()).toBeUndefined();
    expect(await boardTasks()).toEqual([]);
    const tasks = (await db.collection('_localTasks').get()).docs.map((d) => d.data());
    expect(tasks).toEqual([
      expect.objectContaining({
        name: `release-results-org-a-t1-${END + 600_000}`,
        path: '/tasks/release-results',
        scheduleTime: END + 600_000,
      }),
    ]);
  });

  it('RES-01 RES-05 leaves other modes, released and withdrawn tests as they are, and still recomputes', async () => {
    for (const [resolved, extra] of [
      [{ resultRelease: 'manual' }, {}],
      [{ resultRelease: 'immediate', timingMode: 'flexible' }, {}],
      [{ resultRelease: 'never' }, {}],
      [{}, { resultsReleasedAt: 42 }],
      [{}, { resultsWithdrawn: true }],
    ] as const) {
      await clearFirestore();
      await publish(resolved, extra);
      expect(await run(), JSON.stringify([resolved, extra])).toBe('recomputed');
      const stored = (await test.get()).data()!;
      expect(stored.resultsReleasedAt ?? null).toBe('resultsReleasedAt' in extra ? 42 : null);
      expect(stored.resultsWithdrawn ?? false).toBe('resultsWithdrawn' in extra);
      expect(await boardTasks()).toHaveLength(1);
    }
  });

  it('RES-01 acknowledges a missing or unpublished test without changing anything', async () => {
    expect(await run()).toBe('skipped');
    await test.set({ orgId: 'org-a', seriesId: 's1', status: 'draft' });
    expect(await run()).toBe('skipped');
    expect((await db.collection('_localTasks').get()).size).toBe(0);
  });
});
