import { systemClock, TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { buildWorker } from './app';
import { loadConfig } from './config';
import { workerData } from './data';
import { ScriptedLlm } from './llm/scripted';
import { initFirestore } from './firebase';

// Unit tests never reach Firestore. The queue is a no-op fake. Auth is probed with a /tasks/prewarm body that fails
// validation: 401 means the OIDC check refused it, 400 that it passed and the handler never ran.
const stores = { data: workerData(initFirestore()), queue: { enqueue: async () => undefined } };
const PASSED = 400;
const probe = (app: FastifyInstance, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/tasks/prewarm', payload: {}, headers });

describe('worker skeleton', () => {
  it('accepts task requests without OIDC in test mode', async () => {
    const app = await buildWorker({
      ...stores,
      clock: systemClock,
      config: { ...loadConfig({ NODE_ENV: 'test' }), logLevel: 'silent' },
    });
    expect((await probe(app)).statusCode).toBe(PASSED);
  });

  it('refuses task requests whose OIDC check fails', async () => {
    const app = await buildWorker({
      ...stores,
      clock: systemClock,
      config: { ...loadConfig({ NODE_ENV: 'production' }), logLevel: 'silent' },
      checkTaskAuth: async (h) => h === 'Bearer good',
    });
    expect((await probe(app)).statusCode).toBe(401);
    expect((await probe(app, { authorization: 'Bearer good' })).statusCode).toBe(PASSED);
  });

  it('refuses unsigned task requests when NODE_ENV is not set', async () => {
    const app = await buildWorker({
      ...stores,
      clock: systemClock,
      config: {
        ...loadConfig({ TASKS_AUDIENCE: 'https://worker.example', TASKS_SERVICE_ACCOUNT: 'tasks@example.iam' }),
        logLevel: 'silent',
      },
    });
    expect((await probe(app)).statusCode).toBe(401);
    await expect(
      buildWorker({ ...stores, clock: systemClock, config: { ...loadConfig({}), logLevel: 'silent' } }),
      'no OIDC settings and no NODE_ENV: the worker does not start',
    ).rejects.toThrow(/TASKS_AUDIENCE/);
  });

  it('accepts task requests without OIDC only when NODE_ENV is test or development', async () => {
    for (const NODE_ENV of ['test', 'development']) {
      const app = await buildWorker({
        ...stores,
        clock: systemClock,
        config: { ...loadConfig({ NODE_ENV }), logLevel: 'silent' },
      });
      expect((await probe(app)).statusCode, NODE_ENV).toBe(PASSED);
    }
  });

  it('requires the OIDC audience and service account in production', async () => {
    await expect(
      buildWorker({ ...stores, clock: systemClock, config: loadConfig({ NODE_ENV: 'production' }) }),
    ).rejects.toThrow(/TASKS_AUDIENCE/);
  });
});

describe('worker test clock', () => {
  it('is set by the API in test mode and absent otherwise', async () => {
    const clock = new TestClock();
    const test = await buildWorker({
      ...stores,
      clock,
      config: { ...loadConfig({ NODE_ENV: 'test', TEST_API_SECRET: 's' }), logLevel: 'silent' },
    });
    const res = await test.inject({
      method: 'POST',
      url: '/__test/clock',
      payload: { nowMs: 5000 },
      headers: { 'x-test-secret': 's' },
    });
    expect(res.statusCode).toBe(200);
    expect(clock.now()).toBe(5000);
    const dev = await buildWorker({
      ...stores,
      clock,
      config: { ...loadConfig({ NODE_ENV: 'development' }), logLevel: 'silent' },
    });
    expect((await dev.inject({ method: 'POST', url: '/__test/clock', payload: { nowMs: 1 } })).statusCode).toBe(404);
  });
});

describe('worker test-only model routes', () => {
  it('IMP-07 the mock model takes a script, logs calls, releases holds and resets; only with the test secret', async () => {
    const llm = new ScriptedLlm();
    const app = await buildWorker({
      ...stores,
      clock: new TestClock(),
      config: { ...loadConfig({ NODE_ENV: 'test', TEST_API_SECRET: 's' }), logLevel: 'silent' },
      llm,
    });
    const send = (method: 'GET' | 'POST', url: string, payload?: object, secret = 's') =>
      app.inject({ method, url, headers: { 'x-test-secret': secret }, ...(payload ? { payload } : {}) });
    expect((await send('POST', '/__test/llm', { pages: { '1': [] } }, 'wrong')).statusCode).toBe(403);
    expect((await send('POST', '/__test/llm', { pages: { '1': [{ prompt: 'Q' }] }, hold: [2] })).statusCode).toBe(200);
    await llm.generate({ page: 1, system: 's', parts: [{ type: 'text', text: 't' }] });
    expect((await send('GET', '/__test/llm/calls')).json()).toEqual({
      calls: [{ page: 1, parts: [{ type: 'text' }] }],
    });
    const held = llm.generate({ page: 2, system: 's', parts: [] });
    expect((await send('POST', '/__test/llm/release', {})).statusCode).toBe(200);
    await held;
    expect((await send('POST', '/__test/llm/reset', {})).statusCode).toBe(200);
    expect((await send('GET', '/__test/llm/calls')).json()).toEqual({ calls: [] });
    expect((await send('POST', '/__test/llm', { pages: { '1': 'not a list' } })).statusCode).toBe(400);
  });

  it('EXP-05 the report call log lists each summary call with its messages, and a new script or reset clears it', async () => {
    const llm = new ScriptedLlm();
    const app = await buildWorker({
      ...stores,
      clock: new TestClock(),
      config: { ...loadConfig({ NODE_ENV: 'test', TEST_API_SECRET: 's' }), logLevel: 'silent' },
      llm,
    });
    const send = (method: 'GET' | 'POST', url: string, payload?: object) =>
      app.inject({ method, url, headers: { 'x-test-secret': 's' }, ...(payload ? { payload } : {}) });
    const answer = { summary: 'S.', recommendations: ['R.'] };
    expect((await send('POST', '/__test/llm', { report: { answers: [answer], failures: 1 } })).statusCode).toBe(200);
    await expect(llm.summarize({ system: 'sys', prompt: '{}' })).rejects.toThrow();
    expect((await llm.summarize({ system: 'sys 2', prompt: '{}' })).output).toEqual(answer);
    expect((await send('GET', '/__test/llm/report-calls')).json()).toEqual({
      calls: [
        { system: 'sys', prompt: '{}' },
        { system: 'sys 2', prompt: '{}' },
      ],
    });
    expect((await send('POST', '/__test/llm/reset', {})).statusCode).toBe(200);
    expect((await send('GET', '/__test/llm/report-calls')).json()).toEqual({ calls: [] });
  });
});
