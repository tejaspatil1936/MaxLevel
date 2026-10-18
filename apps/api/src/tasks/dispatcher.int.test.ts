import { TestClock } from '@mitaoe/shared';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { TEST_SECRET, testApp } from '../test-support/app';
import { clearEmulators } from '../test-support/emulators';
import { localTaskDispatcher } from './dispatcher';
import { localTaskQueue } from './local-queue';

// The local queue's dispatcher (docs/TEST_ENV.md, "Cloud Tasks"): due tasks are posted to the worker URL once each.
// The worker is stood in for by a small HTTP server that records each push, as Cloud Tasks would deliver it.

const { db } = initFirebase();
const received: Array<{ path: string; body: unknown; name: string | undefined }> = [];
let failNext = new Set<string>();
const worker = createServer((req: IncomingMessage, res) => {
  let raw = '';
  req.on('data', (c: Buffer) => (raw += String(c)));
  req.on('end', () => {
    const path = req.url ?? '';
    received.push({ path, body: JSON.parse(raw), name: req.headers['x-cloudtasks-taskname'] as string | undefined });
    const fail = failNext.delete(path);
    res.writeHead(fail ? 500 : 200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: !fail }));
  });
});
let workerUrl = '';

beforeAll(async () => {
  await new Promise<void>((r) => worker.listen(0, '127.0.0.1', r));
  workerUrl = `http://127.0.0.1:${(worker.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => worker.close(() => r())));
beforeEach(async () => {
  await clearEmulators();
  received.length = 0;
  failNext = new Set();
});

const status = async (name: string) => (await db.doc(`_localTasks/${name}`).get()).data()!;

describe('local task dispatcher', () => {
  it('EX-16 REL-04 posts each due task once to the worker, leaves later ones, and retries a failure later', async () => {
    const clock = new TestClock();
    clock.set(10_000);
    const queue = localTaskQueue(db, clock);
    const dispatcher = localTaskDispatcher(db, clock, { workerUrl });
    await queue.enqueue({
      name: 'a-due',
      path: '/tasks/auto-submit',
      payload: { attemptId: 'x' },
      scheduleTime: 9_000,
    });
    await queue.enqueue({ name: 'b-due', path: '/tasks/leaderboard', payload: { testId: 't' } });
    await queue.enqueue({ name: 'c-later', path: '/tasks/auto-submit', payload: {}, scheduleTime: 20_000 });
    failNext.add('/tasks/leaderboard');

    const runs = await Promise.all([dispatcher.runDue(), dispatcher.runDue(), dispatcher.runDue()]);
    expect(new Set(runs.flat())).toEqual(new Set(['a-due', 'b-due']));
    expect(received.map((r) => r.name).sort(), 'each due task posted once').toEqual(['a-due', 'b-due']);
    expect(received.find((r) => r.name === 'a-due')).toEqual({
      path: '/tasks/auto-submit',
      body: { attemptId: 'x' },
      name: 'a-due',
    });
    expect(await status('a-due')).toMatchObject({ status: 'done', attempts: 1 });
    expect(await status('b-due')).toMatchObject({ status: 'pending', attempts: 1, scheduleTime: 11_000 });
    expect(await status('c-later')).toMatchObject({ status: 'pending' });
    expect((await queue.pending()).map((t) => t.name)).toEqual(['b-due', 'c-later']);

    expect(await dispatcher.runDue(), 'the retry waits for its backoff').toEqual([]);
    clock.set(20_000);
    expect((await dispatcher.runDue()).sort()).toEqual(['b-due', 'c-later']);
    expect(await status('b-due')).toMatchObject({ status: 'done', attempts: 2 });
    expect(await queue.pending()).toEqual([]);
    expect(await dispatcher.runDue(), 'a done task never runs again').toEqual([]);
    expect(received).toHaveLength(4);
  });

  it('EX-16 the test-only run-due route runs the due tasks on the API clock and names them', async () => {
    const { app, clock, queue } = await testApp({ config: { workerUrl } });
    clock.set(50_000);
    await queue.enqueue({ name: 'due', path: '/tasks/auto-submit', payload: { n: 1 }, scheduleTime: 50_000 });
    await queue.enqueue({ name: 'later', path: '/tasks/auto-submit', payload: { n: 2 }, scheduleTime: 50_001 });
    const res = await app.inject({
      method: 'POST',
      url: '/__test/tasks/run-due',
      headers: { 'x-test-secret': TEST_SECRET },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ran: ['due'] });
    expect(received.map((r) => r.body)).toEqual([{ n: 1 }]);
    const refused = await app.inject({ method: 'POST', url: '/__test/tasks/run-due' });
    expect(refused.statusCode).toBe(403);
  });
});
