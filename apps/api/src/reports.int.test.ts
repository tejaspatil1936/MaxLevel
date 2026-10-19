import { computeSeriesMetrics } from '@mitaoe/shared';
import { FieldValue } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, MIN, NOW } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// POST /v1/reports, GET /v1/reports and GET /v1/reports/{id} on the emulators (EXP-06, EXP-07, API-02, FF-02, ORG-05,
// ORG-14). The worker's part (metrics, summary, files) is in apps/worker/src/tasks/report.int.test.ts.

const { db, auth } = initFirebase();
const org = `organizations/${SEED.orgA}`;
const MONTH = '2026-11';
let ctx: Awaited<ReturnType<typeof testApp>>;
let api: ReturnType<typeof attemptClient>;

async function fresh(features: Record<string, boolean> = { analytics_reports: true }) {
  await db.doc(org).update({ featureOverrides: features });
  await db.doc(`organizations/${SEED.orgB}`).update({ featureOverrides: { analytics_reports: true } });
  ctx = await testApp();
  api = attemptClient(ctx.app);
  ctx.clock.set(NOW);
}

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, NOW);
  await fresh();
});

type Res = { status: number; body: Record<string, unknown> };
const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
const call = async (method: 'GET' | 'POST', url: string, headers: Record<string, string>, payload?: object) => {
  const res = await ctx.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() as Record<string, unknown>, res };
};
const post = async (payload: object, key: string | null = crypto.randomUUID(), headers?: Record<string, string>) =>
  call('POST', '/v1/reports', { ...(headers ?? (await admin())), ...(key ? { 'idempotency-key': key } : {}) }, payload);
const get = async (url: string, headers?: Record<string, string>) => call('GET', url, headers ?? (await admin()));
const code = (r: Res) => (r.body.error as { code?: string } | undefined)?.code;
const reports = async () => (await db.collection(`${org}/reports`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const used = async () => ((await db.doc(`${org}/usage/${MONTH}`).get()).get('aiReports') as number | undefined) ?? 0;

/** A finished attempt of the test, enough for a report request. */
const finished = (testId: string, status = 'submitted', id = `att-${testId}`) =>
  db.doc(`${org}/attempts/${id}`).set({ orgId: SEED.orgA, testId, studentId: 'stu-org-a-01', status });

describe('reports API', () => {
  it('EXP-06 EXP-07 API-02 stores the queued report, its count and its audit entry, and only queues the task', async () => {
    const t = await api.examTest();
    await finished(t.testId);
    const key = crypto.randomUUID();
    const first = await post({ scope: 'test', refId: t.testId }, key);
    expect([first.status, first.body]).toEqual([202, { id: expect.any(String), status: 'queued' }]);
    const id = first.body.id as string;
    const again = await post({ scope: 'test', refId: t.testId }, key);
    expect([again.status, again.body], 'a repeated key replays the first answer').toEqual([202, first.body]);

    expect(await reports()).toEqual([
      {
        id,
        orgId: SEED.orgA,
        scope: 'test',
        refId: t.testId,
        title: 'Day 1: Quantitative aptitude',
        status: 'queued',
        includeXlsx: false,
        createdBy: expect.any(String),
        createdByName: 'Admin 1',
        createdAt: NOW,
      },
    ]);
    expect(await used(), 'counted once, never again for the replayed key').toBe(1);
    const audit = (await db.collection(`${org}/auditLogs`).where('action', '==', 'report.create').get()).docs;
    expect(audit.map((d) => d.data())).toEqual([
      expect.objectContaining({
        target: { type: 'report', id },
        after: { scope: 'test', refId: t.testId, includeXlsx: false },
        actor: expect.objectContaining({ email: 'admin1@a.test', role: 'admin' }),
      }),
    ]);
    const tasks = (await ctx.queue.pending()).filter((x) => x.path === '/tasks/report');
    expect(tasks).toEqual([{ name: `report-${id}`, path: '/tasks/report', scheduleTime: NOW }]);
    const objects = await ctx.firebase.bucket.getFiles({ prefix: `${org}/reports/` });
    expect(objects[0], 'the API process builds nothing').toEqual([]);

    const view = await get(`/v1/reports/${id}`);
    expect(view.body).toEqual({
      id,
      scope: 'test',
      refId: t.testId,
      title: 'Day 1: Quantitative aptitude',
      status: 'queued',
      includeXlsx: false,
      createdAt: NOW,
      createdBy: { uid: expect.any(String), name: 'Admin 1' },
    });
  });

  it('EXP-06 a ready report gets fresh signed links to its files that expire 15 minutes after the request', async () => {
    const t = await api.examTest();
    await finished(t.testId);
    const id = (await post({ scope: 'series', refId: t.seriesId, includeXlsx: true })).body.id as string;
    const metrics = computeSeriesMetrics({ title: 'Placement 2026', eligible: 0, departments: [], tests: [] });
    const paths = { pdfPath: `${org}/reports/${id}/report.pdf`, xlsxPath: `${org}/reports/${id}/metrics.xlsx` };
    await ctx.firebase.bucket
      .file(paths.pdfPath)
      .save(Buffer.from('%PDF-1.4 test'), { contentType: 'application/pdf' });
    await ctx.firebase.bucket.file(paths.xlsxPath).save(Buffer.from('PK'), { contentType: 'application/zip' });
    await db.doc(`${org}/reports/${id}`).update({
      ...paths,
      status: 'ready',
      metrics,
      summary: null,
      recommendations: [],
      summaryStatus: 'rejected',
      provider: 'mock',
      model: 'mock-model',
      error: null,
      retryAt: null,
    });
    ctx.clock.advance(MIN);
    const ready = await get(`/v1/reports/${id}`);
    expect(ready.body).toMatchObject({
      status: 'ready',
      title: 'Placement 2026',
      metrics,
      summary: null,
      recommendations: [],
      summaryStatus: 'rejected',
      pdf: { expiresAt: NOW + 16 * MIN, filename: `report-${id}.pdf` },
      xlsx: { expiresAt: NOW + 16 * MIN, filename: `report-${id}-metrics.xlsx` },
    });
    expect(ready.body.error).toBeUndefined();
    const pdf = ready.body.pdf as { url: string };
    const xlsx = ready.body.xlsx as { url: string };
    expect(pdf.url).toMatch(new RegExp(`^http://localhost(:\\d+)?/v1/reports/${id}/files/pdf\\?org=org-a&`));
    const path = (url: string) => url.replace(/^https?:\/\/[^/]+/, '');

    const file = await ctx.app.inject({ method: 'GET', url: path(pdf.url) });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toBe(`attachment; filename="report-${id}.pdf"`);
    expect(file.body).toBe('%PDF-1.4 test');
    const sheet = await ctx.app.inject({ method: 'GET', url: path(xlsx.url) });
    expect(sheet.headers['content-disposition']).toBe(`attachment; filename="report-${id}-metrics.xlsx"`);
    const swapped = await ctx.app.inject({ method: 'GET', url: path(pdf.url).replace('/files/pdf', '/files/xlsx') });
    expect([swapped.statusCode, swapped.json().error.code], 'a link names one file').toEqual([403, 'LINK_INVALID']);

    ctx.clock.advance(15 * MIN - 1);
    expect((await ctx.app.inject({ method: 'GET', url: path(pdf.url) })).statusCode).toBe(200);
    ctx.clock.advance(1);
    const expired = await ctx.app.inject({ method: 'GET', url: path(pdf.url) });
    expect([expired.statusCode, expired.json().error.code]).toEqual([403, 'LINK_EXPIRED']);
  });

  it('API-02 FF-02 ORG-05 EXP-07 refusals, in order, store and count nothing', async () => {
    const t = await api.examTest();
    const body = { scope: 'test', refId: t.testId };
    expect(code(await post(body, null))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(code(await post({ ...body, scope: 'course' }))).toBe('VALIDATION');
    expect((await post({ ...body, refId: 'no-such-test' })).status).toBe(404);
    expect((await post({ scope: 'series', refId: 'nope' })).status).toBe(404);
    const draft = await api.examTest({ title: 'Draft' });
    await db.doc(`${org}/tests/${draft.testId}`).update({ resolved: FieldValue.delete(), status: 'draft' });
    await finished(draft.testId);
    expect((await post({ ...body, refId: draft.testId })).status, 'an unpublished test').toBe(404);
    await db.doc(`${org}/series/${t.seriesId}`).update({ status: 'draft' });
    expect((await post({ scope: 'series', refId: t.seriesId })).status, 'a draft series').toBe(404);
    await db.doc(`${org}/series/${t.seriesId}`).update({ status: 'active' });

    await finished(t.testId, 'in_progress', 'att-1');
    await finished(t.testId, 'reset', 'att-2');
    const none = await post(body);
    expect([none.status, code(none), (none.body.error as { message: string }).message]).toEqual([
      409,
      'NO_FINISHED_ATTEMPTS',
      'This test has no finished attempts yet, so there is nothing to report.',
    ]);
    expect(code(await post({ scope: 'series', refId: t.seriesId })), 'only published tests count').toBe(
      'NO_FINISHED_ATTEMPTS',
    );

    await finished(t.testId, 'auto_submitted', 'att-3');
    const adminB = await asClaims(auth, 'admin1@b.test', { role: 'admin', orgId: SEED.orgB });
    expect((await post(body, 'k-b', adminB)).status, "another org's test").toBe(404);
    const student = await asClaims(auth, 'student01@a.test', {
      role: 'student',
      orgId: SEED.orgA,
      studentId: 'stu-org-a-01',
    });
    expect((await post(body, 'k-s', student)).status).toBe(403);
    expect((await get('/v1/reports', student)).status).toBe(403);

    await db.doc(`${org}/usage/${MONTH}`).set({ orgId: SEED.orgA, month: MONTH, aiReports: 20 });
    const limit = await post(body);
    expect([limit.status, limit.body.error]).toEqual([
      409,
      {
        code: 'LIMIT_REACHED',
        message: "This month's analytics report limit (20) is used up.",
        details: { limit: 'ai_reports_per_month', max: 20 },
      },
    ]);
    expect(await used()).toBe(20);

    await fresh({ analytics_reports: false });
    for (const r of [await post(body), await get('/v1/reports'), await get('/v1/reports/any')])
      expect([r.status, code(r)]).toEqual([403, 'FEATURE_DISABLED']);
    expect(await reports()).toEqual([]);
    expect(await db.collection(`${org}/auditLogs`).where('action', '==', 'report.create').get()).toHaveProperty(
      'empty',
      true,
    );
    await fresh();
    expect((await get('/v1/reports/no-such-report')).status).toBe(404);
  });

  it('EXP-07 FF-04 FF-02 the usage counts this month in the organization timezone against the effective limit', async () => {
    const t = await api.examTest();
    await finished(t.testId);
    expect((await get('/v1/reports/usage')).body).toEqual({ month: MONTH, used: 0, limit: 20 });
    await db.doc(org).update({ 'limitOverrides.ai_reports_per_month': 3 });
    await fresh();
    expect((await post({ scope: 'test', refId: t.testId })).status).toBe(202);
    expect((await get('/v1/reports/usage')).body).toEqual({ month: MONTH, used: 1, limit: 3 });

    // 30 Nov 23:59 IST is still November; 1 Dec 00:00 IST starts December from 0.
    ctx.clock.set(Date.UTC(2026, 10, 30, 18, 29));
    expect((await get('/v1/reports/usage')).body).toMatchObject({ month: MONTH, used: 1 });
    ctx.clock.set(Date.UTC(2026, 10, 30, 18, 30));
    expect((await get('/v1/reports/usage')).body).toEqual({ month: '2026-12', used: 0, limit: 3 });

    const student = await asClaims(auth, 'student01@a.test', {
      role: 'student',
      orgId: SEED.orgA,
      studentId: 'stu-org-a-01',
    });
    expect((await get('/v1/reports/usage', student)).status).toBe(403);
    await fresh({ analytics_reports: false });
    const off = await get('/v1/reports/usage');
    expect([off.status, code(off)]).toEqual([403, 'FEATURE_DISABLED']);
  });

  it('EXP-06 ORG-14 lists every report newest first in pages; a super admin with X-Org-Id makes and sees them', async () => {
    const t = await api.examTest();
    await finished(t.testId);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await post({ scope: 'test', refId: t.testId })).body.id as string);
      ctx.clock.advance(MIN);
    }
    const first = await get('/v1/reports?limit=2');
    const items = first.body.items as Array<Record<string, unknown>>;
    expect(items.map((r) => r.id)).toEqual([ids[2], ids[1]]);
    expect(items[0]).not.toHaveProperty('metrics');
    const second = await get(`/v1/reports?limit=2&cursor=${String(first.body.nextCursor)}`);
    expect([(second.body.items as Array<{ id: string }>).map((r) => r.id), second.body.nextCursor]).toEqual([
      [ids[0]],
      null,
    ]);
    expect((await get('/v1/reports?limit=201')).status).toBe(400);

    const superAdmin = { ...(await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' })), 'x-org-id': SEED.orgA };
    const made = await post({ scope: 'series', refId: t.seriesId }, 'k-super', superAdmin);
    expect(made.status).toBe(202);
    const theirs = await get(`/v1/reports/${String(made.body.id)}`);
    expect(theirs.body.createdBy).toEqual({ uid: expect.any(String), name: SEED.superAdmin });
    expect((await get('/v1/reports', superAdmin)).body.items).toHaveLength(4);
    const audit = (await db.collection(`${org}/auditLogs`).where('target.id', '==', made.body.id).get()).docs;
    expect(audit.map((d) => d.get('actor.role'))).toEqual(['superAdmin']);
    const adminB = await asClaims(auth, 'admin1@b.test', { role: 'admin', orgId: SEED.orgB });
    expect((await get(`/v1/reports/${ids[0]}`, adminB)).status).toBe(404);
    expect(await used()).toBe(4);
  });

  it('REL-04 EXP-06 a report whose task could not be queued is queued again once it has waited a minute', async () => {
    const t = await api.examTest();
    await finished(t.testId);
    const enqueue = ctx.queue.enqueue;
    ctx.queue.enqueue = () => Promise.reject(new Error('the queue is down'));
    const first = await post({ scope: 'test', refId: t.testId });
    const second = await post({ scope: 'test', refId: t.testId });
    ctx.queue.enqueue = enqueue;
    expect([first.status, second.status], 'stored and counted, so accepted').toEqual([202, 202]);
    const [a, b] = [first.body.id as string, second.body.id as string];
    const queued = async () => (await ctx.queue.pending()).filter((x) => x.path === '/tasks/report').map((x) => x.name);
    expect(await queued()).toEqual([]);

    ctx.clock.advance(MIN);
    await get(`/v1/reports/${a}`);
    await get('/v1/reports');
    expect(await queued(), 'not before a minute has passed').toEqual([]);
    ctx.clock.advance(1);
    expect((await get(`/v1/reports/${a}`)).body.status).toBe('queued');
    expect(await queued(), 'opening the report queues it').toEqual([`report-${a}`]);
    expect((await get('/v1/reports')).status).toBe(200);
    expect((await queued()).sort(), 'the list queues every stale one').toEqual([`report-${a}`, `report-${b}`].sort());
    expect(await used()).toBe(2);
  });
});
