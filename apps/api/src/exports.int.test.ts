import { FieldValue } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, MIN, NOW } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// POST /v1/exports and GET /v1/exports/{id} on the emulators (EXP-03, API-02, FF-02, ORG-05).

const { db, auth } = initFirebase();
const org = `organizations/${SEED.orgA}`;
let ctx: Awaited<ReturnType<typeof testApp>>;
let api: ReturnType<typeof attemptClient>;

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, NOW);
  ctx = await testApp();
  api = attemptClient(ctx.app);
  ctx.clock.set(NOW);
});

const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
const post = async (payload: object, key: string | null = 'k1', headers?: Record<string, string>) => {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/v1/exports',
    headers: { ...(headers ?? (await admin())), ...(key ? { 'idempotency-key': key } : {}) },
    payload,
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
};
const get = async (id: string, headers?: Record<string, string>) => {
  const res = await ctx.app.inject({ method: 'GET', url: `/v1/exports/${id}`, headers: headers ?? (await admin()) });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
};
const code = (r: { body: Record<string, unknown> }) => (r.body.error as { code?: string } | undefined)?.code;
const exports = async () => (await db.collection(`${org}/exports`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

describe('results exports API', () => {
  it('EXP-03 API-02 stores the export with its audit entry in one batch and only queues the export task', async () => {
    const t = await api.examTest();
    const first = await post({ scope: 'test', refId: t.testId, format: 'xlsx' });
    expect(first.status).toBe(202);
    expect(first.body).toEqual({ id: expect.any(String), status: 'queued' });
    const id = first.body.id as string;
    expect(await post({ scope: 'test', refId: t.testId, format: 'xlsx' }), 'the key replays').toEqual(first);

    expect(await exports()).toEqual([
      {
        id,
        orgId: SEED.orgA,
        scope: 'test',
        refId: t.testId,
        format: 'xlsx',
        status: 'queued',
        filePath: `${org}/exports/${id}/results-${t.testId}.xlsx`,
        filename: `results-${t.testId}.xlsx`,
        createdBy: expect.any(String),
        createdAt: NOW,
      },
    ]);
    const audit = (await db.collection(`${org}/auditLogs`).where('action', '==', 'results.export').get()).docs;
    expect(audit.map((d) => d.data())).toEqual([
      expect.objectContaining({
        target: { type: 'test', id: t.testId },
        after: { format: 'xlsx', exportId: id },
        actor: expect.objectContaining({ email: 'admin1@a.test', role: 'admin' }),
      }),
    ]);
    const tasks = (await ctx.queue.pending()).filter((x) => x.path === '/tasks/export');
    expect(tasks).toEqual([{ name: `export-${SEED.orgA}-${id}`, path: '/tasks/export', scheduleTime: NOW }]);
    const objects = await ctx.firebase.bucket.getFiles({ prefix: `${org}/exports/` });
    expect(objects[0], 'the API process builds nothing').toEqual([]);

    expect(await get(id)).toEqual({
      status: 200,
      body: {
        id,
        scope: 'test',
        refId: t.testId,
        format: 'xlsx',
        status: 'queued',
        filename: `results-${t.testId}.xlsx`,
      },
    });
  });

  it('EXP-03 a ready export gets a fresh absolute link that expires 15 minutes after the request', async () => {
    const t = await api.examTest();
    const id = (await post({ scope: 'series', refId: t.seriesId, format: 'csv' })).body.id as string;
    await db.doc(`${org}/exports/${id}`).update({ status: 'ready' });
    ctx.clock.advance(MIN);
    const ready = await get(id);
    expect(ready.body).toMatchObject({ status: 'ready', expiresAt: NOW + 16 * MIN });
    expect(ready.body.filename).toBe(`series-results-${t.seriesId}.csv`);
    expect(String(ready.body.url)).toMatch(new RegExp(`^http://localhost(:\\d+)?/v1/exports/${id}/file\\?org=org-a&`));
  });

  it('API-02 FF-02 ORG-05 refusals store nothing: no key, an unknown or unpublished test, another org, plan off', async () => {
    const t = await api.examTest();
    const body = { scope: 'test', refId: t.testId, format: 'csv' };
    expect(code(await post(body, null))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect((await post({ ...body, refId: 'no-such-test' }, 'k2')).status).toBe(404);
    expect((await post({ scope: 'series', refId: 'nope', format: 'csv' }, 'k3')).status).toBe(404);
    const draft = await api.examTest({ title: 'Draft' });
    await db.doc(`${org}/tests/${draft.testId}`).update({ resolved: FieldValue.delete(), status: 'draft' });
    expect((await post({ ...body, refId: draft.testId }, 'k4')).status, 'an unpublished test').toBe(404);
    const adminB = await asClaims(auth, 'admin1@b.test', { role: 'admin', orgId: SEED.orgB });
    expect((await post(body, 'k5', adminB)).status).toBe(404);
    expect((await post({ ...body, format: 'pdf' }, 'k6')).status).toBe(400);
    await db.doc(org).update({ featureOverrides: { results_export: false } });
    ctx = await testApp();
    ctx.clock.set(NOW);
    const off = await post(body, 'k7');
    expect([off.status, code(off)]).toEqual([403, 'FEATURE_DISABLED']);
    expect(await exports()).toEqual([]);
    expect((await get('no-such-export')).status).toBe(404);
  });
});
