import { resolveSettings } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

const { db, auth } = initFirebase();
const orgA = SEED.orgA;
const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: orgA });
const seriesDoc = () => db.doc(`organizations/${orgA}/series/s1`);
const testDoc = (id: string) => db.doc(`organizations/${orgA}/tests/${id}`);
/** 10:00 IST on 2 Nov 2026 (04:30 UTC) and 11:00 IST. */
const START = Date.UTC(2026, 10, 2, 4, 30);
const END = Date.UTC(2026, 10, 2, 5, 30);
const SERIES = {
  orgId: orgA,
  title: 'Placement 2026',
  status: 'draft',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  dailyWindow: { startMinutes: 600, endMinutes: 660 },
  defaults: { maxStrikes: 4, marking: { marks: 2, negativeMarks: 0.5, preset: 'custom' as const } },
  eligibility: { departmentIds: [], graduationYears: [], include: [], exclude: [] },
  createdAt: 0,
  updatedAt: 0,
};

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
  await seriesDoc().set(SERIES);
});

type App = Awaited<ReturnType<typeof testApp>>['app'];
const call = async (app: App, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  app.inject({ method, url, headers: await admin(), ...(payload ? { payload } : {}) });
const question = (prompt: string) => ({
  prompt,
  options: [
    { id: 'a', text: 'One' },
    { id: 'b', text: 'Two' },
  ],
  correctOptionIds: ['a'],
});
/** A test with `n` valid questions, made through the API. */
async function testWith(app: App, n: number) {
  const created = await call(app, 'POST', '/v1/tests', {
    seriesId: 's1',
    title: 'Aptitude',
    scheduledDate: '2026-11-02',
  });
  const id = (created.json() as { id: string }).id;
  for (let i = 1; i <= n; i++)
    expect((await call(app, 'POST', `/v1/tests/${id}/questions`, question(`Question ${i}`))).statusCode).toBe(201);
  return id;
}
const audit = async (action: string) =>
  (await db.collection(`organizations/${orgA}/auditLogs`).where('action', '==', action).get()).docs.map((d) =>
    d.data(),
  );

describe('approval and publishing', () => {
  it('TST-04 Q-14 a test moves draft, in review, approved, scheduled, then shows live and closed from the Clock', async () => {
    const { app, clock } = await testApp();
    clock.set(START - 3_600_000);
    const id = await testWith(app, 0);
    expect((await testDoc(id).get()).get('status')).toBe('draft');
    await call(app, 'POST', `/v1/tests/${id}/questions`, question('Question 1'));
    await call(app, 'POST', `/v1/tests/${id}/questions`, question('Question 2'));
    expect((await testDoc(id).get()).get('status')).toBe('in_review');

    const approved = await call(app, 'POST', `/v1/tests/${id}/approve`, {});
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toEqual({ status: 'approved', totalMarks: 4 });
    const uid = (await auth.getUserByEmail('admin1@a.test')).uid;
    expect((await testDoc(id).get()).data()).toMatchObject({
      status: 'approved',
      totalMarks: 4,
      approval: { status: 'approved', approvedBy: uid, approvedAt: START - 3_600_000 },
    });
    expect((await testDoc(id).get()).get('resolved')).toBeUndefined();
    expect(await audit('test.approve')).toEqual([
      expect.objectContaining({ target: { type: 'test', id }, after: { status: 'approved', totalMarks: 4 } }),
    ]);
    expect((await call(app, 'POST', `/v1/tests/${id}/approve`, {})).json().error.code).toBe('TEST_ALREADY_APPROVED');

    const published = await call(app, 'POST', `/v1/tests/${id}/publish`);
    expect([published.statusCode, published.json()]).toEqual([200, { status: 'scheduled' }]);
    const status = async () => ((await call(app, 'GET', `/v1/tests/${id}`)).json() as { status: string }).status;
    expect(await status()).toBe('scheduled');
    clock.set(START);
    expect(await status()).toBe('live');
    clock.set(END);
    expect(await status()).toBe('closed');
    expect((await testDoc(id).get()).get('status')).toBe('scheduled');
    // Status is never set through PATCH.
    expect((await call(app, 'PATCH', `/v1/tests/${id}`, { status: 'draft' })).statusCode).toBe(400);
  });

  it('TST-04 US-AD-09 publishing a draft or in-review test is 409 TEST_NOT_APPROVED and stores nothing', async () => {
    const { app } = await testApp();
    const draft = await testWith(app, 0);
    const inReview = await testWith(app, 1);
    for (const id of [draft, inReview]) {
      const before = (await testDoc(id).get()).data();
      const res = await call(app, 'POST', `/v1/tests/${id}/publish`, {});
      expect([res.statusCode, res.json().error.code]).toEqual([409, 'TEST_NOT_APPROVED']);
      expect((await testDoc(id).get()).data()).toEqual(before);
    }
    expect(await audit('test.publish')).toEqual([]);
  });

  it('Q-14 a failed checklist is 409 CHECKLIST_FAILED with the failed texts, and nothing changes', async () => {
    const { app } = await testApp();
    const empty = await testWith(app, 0);
    const res = await call(app, 'POST', `/v1/tests/${empty}/approve`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: 'CHECKLIST_FAILED',
      details: { failed: ['Failed: The test has no questions'] },
    });
    const id = await testWith(app, 2);
    await call(app, 'POST', `/v1/tests/${id}/questions`, { ...question('No answer'), correctOptionIds: [] });
    expect((await call(app, 'PATCH', `/v1/tests/${id}`, { drawCount: 2 })).statusCode).toBe(200);
    const before = (await testDoc(id).get()).data();
    const failed = await call(app, 'POST', `/v1/tests/${id}/approve`, {});
    expect(failed.json().error.details.failed).toEqual(['Failed: 1 question needs attention']);
    expect((await testDoc(id).get()).data()).toEqual(before);
    expect(await audit('test.approve')).toEqual([]);
  });

  it('SER-09 Q-14 a flexible test with a full review on submit can neither be approved nor published', async () => {
    const { app } = await testApp();
    const id = await testWith(app, 1);
    const leaky = { timingMode: 'flexible', durationMin: 30, resultDetail: 'full', resultRelease: 'immediate' };
    await seriesDoc().update({ defaults: leaky });
    const refused = await call(app, 'POST', `/v1/tests/${id}/approve`, {});
    expect(refused.json().error.details.failed).toEqual([
      'Failed: A full review released on submit would show the answers before the flexible window closes',
    ]);
    await seriesDoc().update({ defaults: {} });
    expect((await call(app, 'POST', `/v1/tests/${id}/approve`, {})).statusCode).toBe(200);
    // The series changes after approval: publish refuses, and the test stays approved without a snapshot.
    await seriesDoc().update({ defaults: leaky });
    const publish = await call(app, 'POST', `/v1/tests/${id}/publish`, {});
    expect([publish.statusCode, publish.json().error.code]).toEqual([409, 'FULL_REVIEW_BEFORE_CLOSE']);
    expect((await testDoc(id).get()).data()).toMatchObject({ status: 'approved' });
    expect((await testDoc(id).get()).get('resolved')).toBeUndefined();
  });

  it('TST-05 publish stores resolveSettings of the series, the test and the org timezone with the status and audit', async () => {
    const { app, clock } = await testApp();
    clock.set(1_800_000_000_000);
    const id = await testWith(app, 3);
    const overrides = { maxStrikes: 6, shuffleOptions: false };
    expect((await call(app, 'PATCH', `/v1/tests/${id}`, { overrides })).statusCode).toBe(200);
    expect((await call(app, 'POST', `/v1/tests/${id}/approve`, {})).json().totalMarks).toBe(6);
    clock.set(1_800_000_060_000);
    expect((await call(app, 'POST', `/v1/tests/${id}/publish`, {})).statusCode).toBe(200);

    const expected = resolveSettings({
      series: SERIES,
      test: { overrides, scheduledDate: '2026-11-02' },
      timezone: 'Asia/Kolkata',
    });
    const stored = (await testDoc(id).get()).data()!;
    expect(stored.resolved).toEqual(expected);
    expect(stored.resolved).toMatchObject({
      window: { start: START, end: END },
      maxStrikes: 6,
      marking: SERIES.defaults.marking,
    });
    expect(stored).toMatchObject({ status: 'scheduled', updatedAt: 1_800_000_060_000 });
    const [entry] = await audit('test.publish');
    expect(entry).toMatchObject({
      target: { type: 'test', id },
      actor: { email: 'admin1@a.test', role: 'admin' },
      before: { status: 'approved' },
      after: { status: 'scheduled', resolved: expected },
      createdAt: 1_800_000_060_000,
    });
    expect((await call(app, 'GET', `/v1/tests/${id}`)).json().effective).toEqual(expected);
  });
});
