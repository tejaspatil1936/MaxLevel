import { systemClock } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { buildWorker } from './app';
import { loadConfig } from './config';

describe('worker skeleton', () => {
  it('accepts task requests without OIDC in test mode', async () => {
    const app = await buildWorker({
      clock: systemClock,
      config: { ...loadConfig({ NODE_ENV: 'test' }), logLevel: 'silent' },
    });
    const res = await app.inject({ method: 'POST', url: '/tasks/auto-submit', payload: {} });
    expect(res.statusCode).toBe(200);
  });

  it('refuses task requests whose OIDC check fails', async () => {
    const app = await buildWorker({
      clock: systemClock,
      config: { ...loadConfig({ NODE_ENV: 'production' }), logLevel: 'silent' },
      checkTaskAuth: async (h) => h === 'Bearer good',
    });
    expect((await app.inject({ method: 'POST', url: '/tasks/auto-submit', payload: {} })).statusCode).toBe(401);
    const ok = await app.inject({
      method: 'POST',
      url: '/tasks/auto-submit',
      payload: {},
      headers: { authorization: 'Bearer good' },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('requires the OIDC audience and service account in production', async () => {
    await expect(buildWorker({ clock: systemClock, config: loadConfig({ NODE_ENV: 'production' }) })).rejects.toThrow(
      /TASKS_AUDIENCE/,
    );
  });
});
