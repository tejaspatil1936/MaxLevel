import { systemClock, TestClock } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { buildWorker } from './app';
import { loadConfig } from './config';
import { workerData } from './data';
import { initFirestore } from './firebase';

// Unit tests never reach Firestore: they call task paths whose handlers read nothing. The queue is a no-op fake.
const stores = { data: workerData(initFirestore()), queue: { enqueue: async () => undefined } };

describe('worker skeleton', () => {
  it('accepts task requests without OIDC in test mode', async () => {
    const app = await buildWorker({
      ...stores,
      clock: systemClock,
      config: { ...loadConfig({ NODE_ENV: 'test' }), logLevel: 'silent' },
    });
    const res = await app.inject({ method: 'POST', url: '/tasks/prewarm', payload: {} });
    expect(res.statusCode).toBe(200);
  });

  it('refuses task requests whose OIDC check fails', async () => {
    const app = await buildWorker({
      ...stores,
      clock: systemClock,
      config: { ...loadConfig({ NODE_ENV: 'production' }), logLevel: 'silent' },
      checkTaskAuth: async (h) => h === 'Bearer good',
    });
    expect((await app.inject({ method: 'POST', url: '/tasks/prewarm', payload: {} })).statusCode).toBe(401);
    const ok = await app.inject({
      method: 'POST',
      url: '/tasks/prewarm',
      payload: {},
      headers: { authorization: 'Bearer good' },
    });
    expect(ok.statusCode).toBe(200);
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
