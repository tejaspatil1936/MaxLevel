import Fastify from 'fastify';
import { TestClock } from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createServer } from './app';
import { loadConfig } from './config';
import { AppError } from './errors';
import { installGracefulShutdown } from './shutdown';
import { logSink, TEST_SECRET, testApp } from './test-support/app';

const secret = { 'x-test-secret': TEST_SECRET };

describe('error shape', () => {
  it('API-01 unknown routes, validation failures and domain errors share one shape', async () => {
    const { app } = await testApp();
    const notFound = await app.inject({ method: 'GET', url: '/v1/nothing-here' });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String), details: {} } });

    const invalid = await app.inject({
      method: 'POST',
      url: '/__test/clock',
      headers: secret,
      payload: { nowMs: 'soon' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: { code: 'VALIDATION', message: expect.any(String), details: { issues: expect.any(Array) } },
    });

    const forbidden = await app.inject({ method: 'GET', url: '/__test/clock' });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'Test secret missing.', details: {} } });
  });

  it('API-01 unexpected errors become INTERNAL without leaking the cause', async () => {
    const app = await createServer({ ...loadConfig({}), logLevel: 'silent' }, new TestClock());
    app.get('/boom', async () => {
      throw new Error('database password is hunter2');
    });
    app.get('/domain', async () => {
      throw new AppError(409, 'WINDOW_CLOSED', 'The test window has closed.', { closedAt: 1 });
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Something failed on our side.', details: {} } });
    expect((await app.inject({ method: 'GET', url: '/domain' })).json()).toEqual({
      error: { code: 'WINDOW_CLOSED', message: 'The test window has closed.', details: { closedAt: 1 } },
    });
  });
});

describe('server time', () => {
  it('API-03 every response, success or error, carries X-Server-Time from the clock', async () => {
    const { app, clock } = await testApp();
    clock.set(1_800_000_000_000);
    for (const url of ['/health', '/nope']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['x-server-time'], url).toBe('1800000000000');
    }
  });

  it('API-03 browsers on the app origin may read X-Server-Time', async () => {
    const { app } = await testApp();
    const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://localhost:3000' } });
    expect(String(res.headers['access-control-expose-headers'])).toContain('X-Server-Time');
  });
});

describe('schemas', () => {
  it('SEC-04 every route declares a response schema and every write route a body schema', async () => {
    const { app } = await testApp();
    expect(app.routeTable.length).toBeGreaterThan(0);
    const missing = app.routeTable.flatMap((r) => {
      const s = (r.schema ?? {}) as { body?: unknown; response?: unknown };
      const problems = [];
      if (!s.response) problems.push(`${r.method} ${r.url}: no response schema`);
      if (
        ['POST', 'PUT', 'PATCH'].includes(r.method) &&
        !s.body &&
        !r.url.endsWith('/real') &&
        !r.url.includes('/run-due')
      )
        problems.push(`${r.method} ${r.url}: no body schema`);
      return problems;
    });
    expect(missing).toEqual([]);
  });

  it('SEC-04 fields missing from the response schema are stripped from output', async () => {
    const app = await createServer({ ...loadConfig({}), logLevel: 'silent' }, new TestClock());
    const route: FastifyPluginAsyncZod = async (a) => {
      a.get(
        '/q',
        { schema: { response: { 200: z.object({ id: z.string(), prompt: z.string() }) } } },
        async () => ({ id: 'q1', prompt: 'What is 2 + 2?', correctOptionIds: ['b'], explanation: 'Because.' }) as never,
      );
    };
    await app.register(route);
    const res = await app.inject({ method: 'GET', url: '/q' });
    expect(res.json()).toEqual({ id: 'q1', prompt: 'What is 2 + 2?' });
  });
});

describe('CORS', () => {
  it('SEC-05 allows the configured app origin and nothing else', async () => {
    const { app } = await testApp({ config: { appOrigins: ['https://app.mitaoe.example'] } });
    const preflight = (origin: string) =>
      app.inject({ method: 'OPTIONS', url: '/health', headers: { origin, 'access-control-request-method': 'GET' } });
    expect((await preflight('https://app.mitaoe.example')).headers['access-control-allow-origin']).toBe(
      'https://app.mitaoe.example',
    );
    expect((await preflight('https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
    const plain = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(plain.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('request logs', () => {
  it('OBS-01 each request logs requestId, orgId, attemptId and route', async () => {
    const { app, logs } = await testApp({ withLogs: true });
    const res = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'req-123' } });
    expect(res.headers['x-request-id']).toBe('req-123');
    const line = logs.find((l) => l.message === 'request' && l.requestId === 'req-123');
    expect(line).toMatchObject({
      requestId: 'req-123',
      orgId: null,
      attemptId: null,
      route: '/health',
      statusCode: 200,
      severity: 'INFO',
    });
  });

  it('OBS-01 attempt routes log the attempt ID and SEC-07 bodies with emails stay hashed', async () => {
    const { lines: logs, logger } = logSink();
    const app = await createServer({ ...loadConfig({}), logLevel: 'info' }, new TestClock(), logger);
    app.get('/v1/attempts/:id', { schema: { response: { 200: z.object({ ok: z.boolean() }) } } }, async (req) => {
      req.orgId = 'org-a';
      req.log.info({ email: 'student01@a.test' }, 'looked up');
      return { ok: true };
    });
    await app.inject({ method: 'GET', url: '/v1/attempts/att-9' });
    expect(logs.find((l) => l.message === 'request')).toMatchObject({
      orgId: 'org-a',
      attemptId: 'att-9',
      route: '/v1/attempts/:id',
    });
    expect(JSON.stringify(logs)).not.toContain('student01@a.test');
  });
});

describe('graceful shutdown', () => {
  it('REL-03 SIGTERM stops new requests and lets in-flight ones finish', async () => {
    const app = Fastify();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const inFlight = new Promise<void>((r) => (started = r));
    app.get('/slow', async () => {
      started();
      await gate;
      return { done: true };
    });
    const exits: number[] = [];
    const shutdown = installGracefulShutdown(app, { timeoutMs: 8000, exit: (c) => exits.push(c), signal: 'SIGUSR2' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const slow = fetch(`http://127.0.0.1:${port}/slow`).then((r) => r.json());
    await inFlight;
    const closing = shutdown();
    // The listener closes at once, so no new connection is accepted while the slow request finishes.
    await new Promise((r) => setImmediate(r));
    expect(app.server.listening).toBe(false);
    release();
    expect(await slow).toEqual({ done: true });
    await closing;
    expect(exits).toEqual([0]);
  });

  it('REL-03 gives up after the timeout when a request hangs', async () => {
    const app = Fastify();
    let started!: () => void;
    const inFlight = new Promise<void>((r) => (started = r));
    app.get('/hang', async () => {
      started();
      await new Promise(() => {});
    });
    const exited = new Promise<number>((resolve) => {
      const shutdown = installGracefulShutdown(app, { timeoutMs: 200, exit: resolve, signal: 'SIGUSR2' });
      void app.listen({ port: 0, host: '127.0.0.1' }).then(() => {
        const port = (app.server.address() as { port: number }).port;
        fetch(`http://127.0.0.1:${port}/hang`).catch(() => {});
        void inFlight.then(() => shutdown());
      });
    });
    expect(await exited).toBe(1);
  });
});
