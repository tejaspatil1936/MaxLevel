import { TestClock } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createServer } from '../app';
import { loadConfig } from '../config';
import { createData } from '../data';
import { AppError } from '../errors';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { IDEMPOTENCY_TTL_MS } from './idempotency';

const { db } = initFirebase();

beforeEach(async () => {
  await clearEmulators();
});

/** A server with one idempotent route that counts its runs; the caller's uid comes from a header. */
async function server() {
  const clock = new TestClock();
  clock.set(1_793_592_000_000);
  const app = await createServer({ ...loadConfig({}), logLevel: 'silent' }, clock, undefined, {
    idempotency: createData(db).idempotency,
  });
  let runs = 0;
  app.addHook('onRequest', async (req) => {
    req.orgId = 'org-a';
    req.user = { uid: String(req.headers['x-uid'] ?? 'u1') } as NonNullable<typeof req.user>;
  });
  app.post(
    '/v1/things',
    {
      config: { idempotent: true },
      schema: {
        body: z.object({ fail: z.boolean().optional() }),
        response: { 201: z.object({ run: z.number(), padding: z.string() }) },
      },
    },
    async (req, reply) => {
      runs += 1;
      if ((req.body as { fail?: boolean }).fail) throw new AppError(409, 'CONFLICT', 'Not now.');
      // A body above the compression threshold, so compression must not change what is stored.
      return reply.status(201).send({ run: runs, padding: 'x'.repeat(2000) });
    },
  );
  const post = (key: string | null, opts: { uid?: string; fail?: boolean; gzip?: boolean } = {}) =>
    app.inject({
      method: 'POST',
      url: '/v1/things',
      headers: {
        ...(key ? { 'idempotency-key': key } : {}),
        'x-uid': opts.uid ?? 'u1',
        'accept-encoding': opts.gzip ? 'gzip' : 'identity',
      },
      payload: opts.fail ? { fail: true } : {},
    });
  return { clock, post, runs: () => runs };
}

describe('Idempotency-Key', () => {
  it('API-02 a write without a key is 400 IDEMPOTENCY_KEY_REQUIRED and runs nothing', async () => {
    const s = await server();
    const res = await s.post(null);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(s.runs()).toBe(0);
  });

  it('API-02 EX-04 a repeated key within 24 hours replays the stored status and body byte for byte', async () => {
    const s = await server();
    const first = await s.post('k1');
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ run: 1 });

    s.clock.advance(IDEMPOTENCY_TTL_MS - 1);
    const replay = await s.post('k1');
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['content-type']).toMatch(/^application\/json/);
    expect(replay.body).toBe(first.body);
    expect(s.runs(), 'the handler did not run again').toBe(1);
    // A compressed first response still stores the JSON itself.
    const zipped = await s.post('k3', { gzip: true });
    expect(zipped.headers['content-encoding']).toBe('gzip');
    expect((await s.post('k3')).json()).toMatchObject({ run: 2 });

    expect((await s.post('k1', { uid: 'u2' })).json(), 'keys are per caller').toMatchObject({ run: 3 });
    expect((await s.post('k2')).json(), 'another key is a new request').toMatchObject({ run: 4 });
  });

  it('API-02 after 24 hours a key is treated as new, and refused requests are not stored', async () => {
    const s = await server();
    await s.post('k1');
    s.clock.advance(IDEMPOTENCY_TTL_MS);
    expect((await s.post('k1')).json()).toMatchObject({ run: 2 });

    expect((await s.post('k9', { fail: true })).statusCode).toBe(409);
    expect((await s.post('k9')).json(), 'a refused request can be retried with its key').toMatchObject({ run: 4 });
  });

  it('API-02 requests sent together with one key run the handler once; the others replay it or get 409', async () => {
    const s = await server();
    const all = await Promise.all([s.post('k1'), s.post('k1'), s.post('k1')]);
    expect(s.runs(), 'the handler ran once').toBe(1);
    const first = all.find((r) => r.statusCode === 201)!;
    expect(first.json()).toMatchObject({ run: 1 });
    for (const r of all) {
      if (r.statusCode === 201) expect(r.body).toBe(first.body);
      else {
        expect(r.statusCode).toBe(409);
        expect(r.json().error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
      }
    }
    expect((await s.post('k1')).body, 'once it finished, the key replays it').toBe(first.body);
  });
});
