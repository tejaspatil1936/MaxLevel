import { TestClock } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';

async function app() {
  const clock = new TestClock();
  clock.set(1_700_000_000_000);
  return { clock, app: await buildApp({ clock, config: { ...loadConfig({}), logLevel: 'silent' } }) };
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
});
