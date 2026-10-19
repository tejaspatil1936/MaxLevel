import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { NOW } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SCENARIOS } from './test-support/scenarios';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// The routes after the worker: retry, source pages, draft edits, discard and approval, on the emulators (REL-06,
// IMP-03, IMP-11, IMP-12, ORG-05).

const { db, auth } = initFirebase();
const org = `organizations/${SEED.orgA}`;
let ctx: Awaited<ReturnType<typeof testApp>>;
let testId: string;

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, NOW);
  ctx = await testApp();
  ctx.clock.set(NOW);
  const seeded = await SCENARIOS['authoring-test']!(db, NOW, { orgId: SEED.orgA }, ctx.queue);
  testId = seeded.testId as string;
});

type Res = { status: number; body: Record<string, unknown> };
const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
const adminB = () => asClaims(auth, 'admin1@b.test', { role: 'admin', orgId: SEED.orgB });
const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, headers?: object) => {
  const res = await ctx.app.inject({
    method,
    url,
    headers: { ...(headers ?? (await admin())) },
    ...(payload ? { payload } : {}),
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> } as Res;
};
const code = (r: Res) => (r.body.error as { code?: string } | undefined)?.code;
const jobRef = (id: string) => db.doc(`${org}/importJobs/${id}`);
const tasks = async () => (await ctx.queue.pending()).filter((t) => t.path === '/tasks/import');

/** A stored job in org A's test, with these fields over a ready three-page PDF job. */
async function storeJob(id: string, fields: Record<string, unknown> = {}) {
  await jobRef(id).set({
    orgId: SEED.orgA,
    testId,
    filename: 'paper.pdf',
    format: 'pdf',
    contentType: 'application/pdf',
    sizeBytes: 100,
    filePath: `${org}/imports/${id}/source.pdf`,
    status: 'ready',
    progress: { pagesDone: 3, pagesTotal: 3, questionsFound: 0 },
    createdBy: 'uid-1',
    createdAt: NOW,
    ...fields,
  });
}

describe('import retry', () => {
  it('REL-06 IMP-08 a retryable failure is queued again with its audit entry; pages, counter and usage are kept', async () => {
    await storeJob('j1', {
      status: 'failed',
      error: { code: 'LLM_UNAVAILABLE', message: "The AI service didn't answer after 4 tries.", retryable: true },
      failures: 4,
      aiCounted: true,
      progress: { pagesDone: 1, pagesTotal: 3, questionsFound: 2 },
    });
    const res = await call('POST', '/v1/imports/j1/retry', {});
    expect(res).toEqual({ status: 202, body: { id: 'j1', status: 'queued' } });
    const job = (await jobRef('j1').get()).data()!;
    expect(job).toMatchObject({ status: 'queued', failures: 0, aiCounted: true, progress: { pagesDone: 1 } });
    expect(job.error).toBeUndefined();
    const queued = await tasks();
    expect(queued.map((t) => [t.scheduleTime, t.name.includes('j1')])).toEqual([[NOW, true]]);
    const audit = (await db.collection(`${org}/auditLogs`).where('action', '==', 'import.retry').get()).docs;
    expect(audit.map((d) => d.data())).toEqual([
      expect.objectContaining({
        target: { type: 'importJob', id: 'j1' },
        actor: expect.objectContaining({ email: 'admin1@a.test' }),
      }),
    ]);

    // Queued now, it is no longer retryable.
    const again = await call('POST', '/v1/imports/j1/retry', {});
    expect([again.status, code(again)]).toEqual([409, 'IMPORT_NOT_RETRYABLE']);
    expect(await tasks()).toHaveLength(1);
  });

  it('REL-06 ORG-05 a job that is not a retryable failure is refused, and another organization gets 404', async () => {
    await storeJob('ready');
    await storeJob('limit', {
      status: 'failed',
      error: { code: 'TOO_MANY_PAGES', message: 'x', retryable: false },
    });
    await storeJob('waiting', {
      status: 'retrying',
      error: { code: 'LLM_UNAVAILABLE', message: 'x', retryable: true },
    });
    for (const id of ['ready', 'limit', 'waiting']) {
      const res = await call('POST', `/v1/imports/${id}/retry`, {});
      expect([res.status, code(res)], id).toEqual([409, 'IMPORT_NOT_RETRYABLE']);
    }
    await storeJob('j2', { status: 'failed', error: { code: 'LLM_UNAVAILABLE', message: 'x', retryable: true } });
    expect((await call('POST', '/v1/imports/j2/retry', {}, await adminB())).status).toBe(404);
    expect((await jobRef('j2').get()).get('status')).toBe('failed');
    expect(await tasks()).toEqual([]);
  });
});

describe('import source pages', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const follow = async (url: string) => {
    const u = new URL(url);
    return ctx.app.inject({ method: 'GET', url: `${u.pathname}${u.search}` });
  };

  it('IMP-03 DATA-09 a kept page is served through a signed link for 15 minutes, as PNG or one-page PDF', async () => {
    await storeJob('j1');
    await ctx.firebase.bucket.file(`${org}/imports/j1/pages/1.png`).save(PNG, { contentType: 'image/png' });
    const pdf = Buffer.from('%PDF-1.7\n%%EOF\n');
    await ctx.firebase.bucket.file(`${org}/imports/j1/pages/2.pdf`).save(pdf, { contentType: 'application/pdf' });

    const link = await call('GET', '/v1/imports/j1/pages/1');
    expect(link).toEqual({
      status: 200,
      body: {
        url: expect.stringMatching(/\/v1\/imports\/j1\/pages\/1\/file\?/),
        contentType: 'image/png',
        expiresAt: NOW + 900_000,
      },
    });
    const got = await follow(link.body.url as string);
    expect([got.statusCode, got.headers['content-type']]).toEqual([200, 'image/png']);
    expect(got.rawPayload.equals(PNG)).toBe(true);
    expect((await call('GET', '/v1/imports/j1/pages/2')).body.contentType).toBe('application/pdf');

    // A link names its page: changing the page or the signature, or waiting past the expiry, is refused.
    expect((await follow((link.body.url as string).replace('/pages/1/', '/pages/2/'))).statusCode).toBe(403);
    expect((await follow((link.body.url as string).replace(/sig=[0-9a-f]/, 'sig=x'))).statusCode).toBe(403);
    ctx.clock.advance(900_000);
    expect((await follow(link.body.url as string)).statusCode).toBe(403);
  });

  it('IMP-03 ORG-05 no link for a page out of range, not kept, of another format or of another organization', async () => {
    await storeJob('j1');
    await storeJob('json', { format: 'json', progress: { pagesDone: 1, pagesTotal: 1, questionsFound: 0 } });
    await ctx.firebase.bucket.file(`${org}/imports/j1/pages/1.png`).save(PNG, { contentType: 'image/png' });
    for (const url of ['/v1/imports/j1/pages/4', '/v1/imports/j1/pages/3', '/v1/imports/json/pages/1'])
      expect((await call('GET', url)).status, url).toBe(404);
    expect((await call('GET', '/v1/imports/j1/pages/0')).status).toBe(400);
    expect((await call('GET', '/v1/imports/j1/pages/1', undefined, await adminB())).status).toBe(404);
  });
});
