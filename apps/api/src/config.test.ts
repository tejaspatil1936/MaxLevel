import { TestClock } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import { initFirebase } from './firebase';
import { localTaskQueue } from './tasks/local-queue';

const secret = 'x'.repeat(32);

describe('export link secret', () => {
  it('EXP-03 production without EXPORT_LINK_SECRET still starts, with no export link key at all', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).exportLinkSecret).toBeUndefined();
    expect(loadConfig({ NODE_ENV: 'production', EXPORT_LINK_SECRET: secret }).exportLinkSecret).toBe(secret);
  });

  it('EXP-03 a secret under 32 bytes is refused in every mode', () => {
    for (const NODE_ENV of ['production', 'development', 'test'])
      expect(() => loadConfig({ NODE_ENV, EXPORT_LINK_SECRET: 'x'.repeat(31) }), NODE_ENV).toThrow(
        /EXPORT_LINK_SECRET/,
      );
  });

  it('EXP-03 development and test fall back to a random key of their own', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const a = loadConfig({ NODE_ENV }).exportLinkSecret;
      expect(a, NODE_ENV).toMatch(/^[0-9a-f]{64}$/);
      expect(loadConfig({ NODE_ENV }).exportLinkSecret, NODE_ENV).not.toBe(a);
      expect(loadConfig({ NODE_ENV, EXPORT_LINK_SECRET: secret }).exportLinkSecret, NODE_ENV).toBe(secret);
    }
    expect(loadConfig({}).exportLinkSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('EXP-03 without a link key, production answers export links with 503 instead of a per-process key', async () => {
    const clock = new TestClock();
    const firebase = initFirebase();
    const config = { ...loadConfig({ NODE_ENV: 'production' }), logLevel: 'silent' as const };
    const a = await buildApp({ clock, config, firebase, queue: localTaskQueue(firebase.db, clock) });
    const res = await a.inject({ method: 'GET', url: '/v1/exports/e1/file?org=org-a&expires=1&sig=abc' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'EXPORTS_UNAVAILABLE' } });
    expect((await a.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});
