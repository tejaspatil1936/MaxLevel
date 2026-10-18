import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

const { db, auth } = initFirebase();
const orgA = SEED.orgA;
const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: orgA });
/** 10:00 IST on 2 Nov 2026 (04:30 UTC) and 11:00 IST. */
const START = Date.UTC(2026, 10, 2, 4, 30);
const END = Date.UTC(2026, 10, 2, 5, 30);

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
  await db.doc(`organizations/${orgA}/series/s1`).set({
    orgId: orgA,
    title: 'Placement 2026',
    status: 'draft',
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    dailyWindow: { startMinutes: 600, endMinutes: 660 },
    defaults: { maxStrikes: 4 },
    eligibility: { departmentIds: [], graduationYears: [], include: [], exclude: [] },
    createdAt: 0,
    updatedAt: 0,
  });
});

type App = Awaited<ReturnType<typeof testApp>>['app'];
const call = async (app: App, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  app.inject({ method, url, headers: await admin(), ...(payload ? { payload } : {}) });
const add = async (app: App, body: object) => {
  const res = await call(app, 'POST', '/v1/tests', { seriesId: 's1', title: 'Aptitude', ...body });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
};
const audit = async (action: string) =>
  (await db.collection(`organizations/${orgA}/auditLogs`).where('action', '==', action).get()).docs.map((d) =>
    d.data(),
  );

describe('test routes', () => {
  it('TST-01 TST-02 SER-03 tests are added as drafts, audit-logged and listed in schedule order with day labels', async () => {
    const { app } = await testApp();
    const second = await add(app, { title: 'Aptitude', company: 'TCS', scheduledDate: '2026-11-03' });
    const first = await add(app, { title: 'Reasoning', scheduledDate: '2026-11-02', dayNumber: '' });
    const third = await add(app, { title: 'Verbal', scheduledDate: '2026-11-04', dayHidden: true });
    const stored = (await db.doc(`organizations/${orgA}/tests/${first}`).get()).data();
    expect(stored).toMatchObject({ seriesId: 's1', status: 'draft', overrides: {}, dayHidden: false });
    expect(stored).not.toHaveProperty('dayNumber');
    expect(stored).not.toHaveProperty('company');
    const [entry] = await audit('test.create');
    expect(entry).toMatchObject({ target: { type: 'test' }, actor: { email: 'admin1@a.test', role: 'admin' } });

    const list = await call(app, 'GET', '/v1/tests?seriesId=s1');
    expect(list.statusCode).toBe(200);
    const items = (list.json() as { items: Array<{ id: string; dayLabel: string | null; status: string }> }).items;
    expect(items.map((t) => [t.id, t.dayLabel, t.status])).toEqual([
      [first, 'Day 1', 'draft'],
      [second, 'Day 2', 'draft'],
      [third, null, 'draft'],
    ]);
    expect((await call(app, 'GET', '/v1/tests?seriesId=missing')).statusCode).toBe(404);
  });

  it('TST-01 a date outside the series or a series of another org is refused and nothing is stored', async () => {
    const { app } = await testApp();
    const outside = await call(app, 'POST', '/v1/tests', { seriesId: 's1', title: 'A', scheduledDate: '2026-12-05' });
    expect(outside.statusCode).toBe(400);
    expect(outside.json().error).toMatchObject({
      code: 'DATE_OUTSIDE_SERIES',
      message: 'Choose a date from 1 Nov 2026 to 30 Nov 2026, the series dates.',
      details: { field: 'scheduledDate' },
    });
    await db.doc(`organizations/${SEED.orgB}/series/sb`).set({ orgId: SEED.orgB, title: 'B', status: 'draft' });
    const foreign = await call(app, 'POST', '/v1/tests', { seriesId: 'sb', title: 'A', scheduledDate: '2026-11-03' });
    expect(foreign.statusCode).toBe(404);
    expect((await call(app, 'GET', '/v1/tests?seriesId=sb')).statusCode).toBe(404);
    expect((await db.collectionGroup('tests').get()).size).toBe(0);
  });

  it('TST-07 TST-04 GET returns the effective settings with the window in UTC ms and a status from the Clock', async () => {
    const { app, clock } = await testApp();
    clock.set(START - 60_000);
    const id = await add(app, { scheduledDate: '2026-11-02' });
    const res = await call(app, 'GET', `/v1/tests/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id,
      status: 'draft',
      dayLabel: 'Day 1',
      effective: { window: { start: START, end: END }, maxStrikes: 4, durationMin: 60, timingMode: 'fixed' },
    });

    // A scheduled test reads its snapshot; live and closed follow the window and the Clock.
    const resolved = res.json().effective;
    await db.doc(`organizations/${orgA}/tests/${id}`).update({ status: 'scheduled', resolved });
    const status = async () => ((await call(app, 'GET', `/v1/tests/${id}`)).json() as { status: string }).status;
    expect(await status()).toBe('scheduled');
    clock.set(START);
    expect(await status()).toBe('live');
    expect((await call(app, 'GET', '/v1/tests?seriesId=s1')).json().items[0].status).toBe('live');
    clock.set(END);
    expect(await status()).toBe('closed');
    expect((await db.doc(`organizations/${orgA}/tests/${id}`).get()).get('status')).toBe('scheduled');
  });

  it('TST-02 TST-04 PATCH renames or hides the day label and changes details, but never the status', async () => {
    const { app } = await testApp();
    const id = await add(app, { company: 'TCS', scheduledDate: '2026-11-02' });
    const renamed = await call(app, 'PATCH', `/v1/tests/${id}`, { dayNumber: 'Mock 1', company: '' });
    expect(renamed.json()).toMatchObject({ dayNumber: 'Mock 1', dayLabel: 'Mock 1' });
    expect(renamed.json()).not.toHaveProperty('company');
    expect((await call(app, 'PATCH', `/v1/tests/${id}`, { dayHidden: true })).json().dayLabel).toBeNull();
    expect(await audit('test.update')).toHaveLength(2);

    for (const payload of [{ status: 'scheduled' }, { title: 'X', status: 'live' }]) {
      const res = await call(app, 'PATCH', `/v1/tests/${id}`, payload);
      expect(res.statusCode).toBe(400);
    }
    const outside = await call(app, 'PATCH', `/v1/tests/${id}`, { scheduledDate: '2026-10-31' });
    expect(outside.json().error.code).toBe('DATE_OUTSIDE_SERIES');
    const stored = (await db.doc(`organizations/${orgA}/tests/${id}`).get()).data();
    expect(stored).toMatchObject({ status: 'draft', title: 'Aptitude', scheduledDate: '2026-11-02' });
    expect(await audit('test.update')).toHaveLength(2);
  });

  it('SER-09 TST-03 PATCH overrides are checked on the resolved settings and logged as test.settings.update', async () => {
    const { app } = await testApp();
    const id = await add(app, { scheduledDate: '2026-11-02' });
    const leaky = { timingMode: 'flexible', resultDetail: 'full', resultRelease: 'immediate' };
    const refused = await call(app, 'PATCH', `/v1/tests/${id}`, { overrides: leaky });
    expect(refused.json().error).toMatchObject({ code: 'FULL_REVIEW_BEFORE_CLOSE' });
    const ok = await call(app, 'PATCH', `/v1/tests/${id}`, { overrides: { maxStrikes: 2 } });
    expect(ok.json()).toMatchObject({ overrides: { maxStrikes: 2 }, effective: { maxStrikes: 2 } });
    expect(await audit('test.settings.update')).toEqual([
      expect.objectContaining({ before: {}, after: { maxStrikes: 2 } }),
    ]);
    expect(await audit('test.update')).toEqual([]);
  });
});
