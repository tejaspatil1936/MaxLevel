import { TestClock } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import { initFirebase } from './firebase';
import { localTaskQueue } from './tasks/local-queue';

const deps = (clock: TestClock) => {
  const firebase = initFirebase();
  return { firebase, queue: localTaskQueue(firebase.db, clock) };
};

async function app() {
  const clock = new TestClock();
  clock.set(1_700_000_000_000);
  return {
    clock,
    app: await buildApp({ clock, config: { ...loadConfig({}), logLevel: 'silent' }, ...deps(clock) }),
  };
}

describe('api skeleton', () => {
  it('API-03 GET /health answers with X-Server-Time from the injected clock', async () => {
    const { app: a } = await app();
    const res = await a.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(res.headers['x-server-time']).toBe('1700000000000');
  });

  it('API-01 unknown routes use the error shape', async () => {
    const { app: a } = await app();
    const res = await a.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND', message: expect.any(String), details: {} } });
    expect(res.headers['x-server-time']).toBe('1700000000000');
  });

  it('API-01 SEC-05 a path parameter of 300 characters gets the error shape with CORS headers', async () => {
    const { app: a } = await app();
    const origin = loadConfig({}).appOrigins[0]!;
    const res = await a.inject({ method: 'GET', url: `/v1/imports/${'a'.repeat(300)}`, headers: { origin } });
    expect(res.statusCode).toBeLessThan(500);
    expect(res.json()).toMatchObject({ error: { code: expect.any(String), details: {} } });
    expect(res.headers['access-control-allow-origin'], 'the browser can read the refusal').toBe(origin);
  });
});

describe('test-only API', () => {
  it('is not registered outside test mode', async () => {
    const clock = new TestClock();
    const config = {
      ...loadConfig({ NODE_ENV: 'production', TEST_API_SECRET: 's', EXPORT_LINK_SECRET: 'x'.repeat(32) }),
      logLevel: 'silent' as const,
    };
    const a = await buildApp({ clock, config, ...deps(clock) });
    expect(
      (await a.inject({ method: 'GET', url: '/__test/clock', headers: { 'x-test-secret': 's' } })).statusCode,
    ).toBe(404);
  });

  it('needs the secret and moves the clock', async () => {
    const clock = new TestClock();
    const config = { ...loadConfig({ NODE_ENV: 'test', TEST_API_SECRET: 's' }), logLevel: 'silent' as const };
    const a = await buildApp({ clock, config, ...deps(clock) });
    expect((await a.inject({ method: 'GET', url: '/__test/clock' })).statusCode).toBe(403);
    const res = await a.inject({ method: 'POST', url: '/__test/clock/real', headers: { 'x-test-secret': 's' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().nowMs).toBeGreaterThan(0);
  });
});
