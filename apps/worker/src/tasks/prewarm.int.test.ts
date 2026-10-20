import { TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorker } from '../app';
import { loadConfig } from '../config';
import { workerData } from '../data';
import { initFirestore } from '../firebase';
import type { InstanceScaler } from '../scaler';
import { clearFirestore } from '../test-support/emulators';
import { localTaskQueue } from './local-queue';

// /tasks/prewarm on the Firestore emulator (PERF-06, REL-04): the worker raises the API minimum instances through its
// InstanceScaler driver once per task name. The driver here records its calls; the Cloud Run driver is checked on
// staging (docs/MANUAL_CHECKS.md).

const db = initFirestore();
const clock = new TestClock();
const calls: Parameters<InstanceScaler['raiseMinInstances']>[0][] = [];
let app: FastifyInstance;
const org = db.doc('organizations/org-a');
const START = 1_793_592_000_000;
const END = START + 60 * 60_000;
const payload = { orgId: 'org-a', testId: 't1', windowStart: START };

beforeAll(async () => {
  app = await buildWorker({
    clock,
    config: { ...loadConfig({ NODE_ENV: 'test' }), logLevel: 'silent' },
    data: workerData(db),
    queue: localTaskQueue(db, clock),
    scaler: { raiseMinInstances: async (input) => void calls.push(input) },
  });
});

beforeEach(async () => {
  await clearFirestore();
  calls.length = 0;
  clock.set(START - 30 * 60_000);
  await org.collection('series').doc('s1').set({ eligibility: {} });
  await org
    .collection('tests')
    .doc('t1')
    .set({ seriesId: 's1', status: 'scheduled', resolved: { window: { start: START, end: END } } });
  const batch = db.batch();
  for (let i = 0; i < 250; i++) batch.set(org.collection('students').doc(`st-${i}`), { status: 'registered' });
  await batch.commit();
});

const run = async (body: object = payload) => {
  const res = await app.inject({ method: 'POST', url: '/tasks/prewarm', payload: body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ outcome: string }>().outcome;
};

describe('/tasks/prewarm', () => {
  it('PERF-06 REL-04 raises the minimum instances by eligible students once per task name', async () => {
    expect(await run()).toBe('raised');
    expect(calls).toEqual([{ minInstances: 3, until: END, reason: `prewarm-org-a-t1-${START}` }]);
    expect((await org.collection('tests').doc('t1').get()).get('prewarmedFor')).toBe(START);
    expect(await run(), 'a retry').toBe('done');
    expect(calls).toHaveLength(1);
  });

  it('PERF-06 EX-16 a task for a moved, unpublished, ended or missing slot raises nothing', async () => {
    const test = org.collection('tests').doc('t1');
    await test.update({ 'resolved.window.start': START + 86_400_000 });
    expect(await run(), 'moved to another day').toBe('skipped');
    await test.set({ seriesId: 's1', status: 'in_review' });
    expect(await run(), 'sent back to review').toBe('skipped');
    await test.set({ seriesId: 's1', status: 'scheduled', resolved: { window: { start: START, end: END } } });
    clock.set(END);
    expect(await run(), 'slot over').toBe('skipped');
    expect(await run({ ...payload, testId: 'nope' })).toBe('skipped');
    expect(await run({ ...payload, orgId: 'org-b' }), 'another org').toBe('skipped');
    expect(calls).toEqual([]);
  });

  it('PERF-06 refuses a payload without its window start', async () => {
    const res = await app.inject({ method: 'POST', url: '/tasks/prewarm', payload: { orgId: 'org-a', testId: 't1' } });
    expect(res.statusCode).toBe(400);
  });
});
