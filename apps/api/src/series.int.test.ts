import { NO_RESTRICTION } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

const { db, auth } = initFirebase();
const orgA = SEED.orgA;
const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: orgA });
const body = {
  title: 'Placement 2026',
  description: 'Daily tests.',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  dailyWindow: { startMinutes: 600, endMinutes: 660 },
  defaults: { maxStrikes: 5, resultDetail: 'full' },
  eligibility: { ...NO_RESTRICTION, departmentIds: ['dept-org-a-computer'] },
};
const audit = async (action: string) =>
  (await db.collection(`organizations/${orgA}/auditLogs`).where('action', '==', action).get()).docs.map((d) =>
    d.data(),
  );

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
});

async function create(app: Awaited<ReturnType<typeof testApp>>['app'], payload: object = body) {
  return app.inject({ method: 'POST', url: '/v1/series', headers: await admin(), payload });
}

describe('series routes', () => {
  it('SER-01 a series is created as a draft with its dates, defaults and eligibility, and audit-logged', async () => {
    const { app, clock } = await testApp();
    clock.set(1_800_000_000_000);
    const res = await create(app);
    expect(res.statusCode).toBe(201);
    const { id } = res.json() as { id: string };
    expect((await db.doc(`organizations/${orgA}/series/${id}`).get()).data()).toEqual({
      orgId: orgA,
      ...body,
      status: 'draft',
      createdAt: 1_800_000_000_000,
      updatedAt: 1_800_000_000_000,
    });
    const [entry] = await audit('series.create');
    expect(entry).toMatchObject({ target: { type: 'series', id }, actor: { email: 'admin1@a.test', role: 'admin' } });
    await db.doc(`organizations/${orgA}/tests/t1`).set({ orgId: orgA, seriesId: id });
    const list = await app.inject({ method: 'GET', url: '/v1/series', headers: await admin() });
    expect(list.json()).toMatchObject({ items: [{ id, title: 'Placement 2026', testCount: 1 }], nextCursor: null });
    const one = await app.inject({ method: 'GET', url: `/v1/series/${id}`, headers: await admin() });
    expect(one.json()).toMatchObject({ id, status: 'draft', dailyWindow: body.dailyWindow, testCount: 1 });
  });

  it('SER-09 a flexible window with a full review released on submit is refused on create and on edit', async () => {
    const { app } = await testApp();
    const leaky = { timingMode: 'flexible', resultDetail: 'full', resultRelease: 'immediate' };
    const refused = await create(app, { ...body, defaults: leaky });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatchObject({
      code: 'FULL_REVIEW_BEFORE_CLOSE',
      details: { field: 'resultRelease' },
    });
    expect((await db.collection(`organizations/${orgA}/series`).get()).size).toBe(0);

    const { id } = (await create(app)).json() as { id: string };
    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/series/${id}`,
      headers: await admin(),
      payload: { defaults: leaky },
    });
    expect(patch.json().error.code).toBe('FULL_REVIEW_BEFORE_CLOSE');
    const manual = await app.inject({
      method: 'PATCH',
      url: `/v1/series/${id}`,
      headers: await admin(),
      payload: { defaults: { ...leaky, resultRelease: 'manual' } },
    });
    expect(manual.statusCode).toBe(200);
  });

  it('SER-02 PATCH moves a series between draft, active and archived, and each change is audit-logged', async () => {
    const { app } = await testApp();
    const { id } = (await create(app)).json() as { id: string };
    const setStatus = async (status: string) =>
      app.inject({ method: 'PATCH', url: `/v1/series/${id}`, headers: await admin(), payload: { status } });

    expect((await setStatus('active')).json()).toMatchObject({ id, status: 'active' });
    expect((await setStatus('archived')).json()).toMatchObject({ status: 'archived' });
    expect((await setStatus('active')).json()).toMatchObject({ status: 'active' });
    expect((await setStatus('draft')).json()).toMatchObject({ status: 'draft' });
    expect((await setStatus('paused')).statusCode).toBe(400);

    expect((await audit('series.activate')).map((e) => [e.before, e.after])).toEqual([
      [{ status: 'draft' }, { status: 'active' }],
      [{ status: 'archived' }, { status: 'active' }],
    ]);
    expect(await audit('series.archive')).toEqual([
      expect.objectContaining({ before: { status: 'active' }, after: { status: 'archived' } }),
    ]);
    expect(await audit('series.update')).toEqual([
      expect.objectContaining({ before: { status: 'active' }, after: { status: 'draft' } }),
    ]);
    expect((await db.doc(`organizations/${orgA}/series/${id}`).get()).get('status')).toBe('draft');
  });

  it('SER-01 an edit that puts the end date before the stored start date is refused', async () => {
    const { app } = await testApp();
    const { id } = (await create(app)).json() as { id: string };
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/series/${id}`,
      headers: await admin(),
      payload: { endDate: '2026-10-31' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toEqual({ field: 'endDate' });
    expect(await audit('series.update')).toEqual([]);
  });

  it('SER-07 the preview counts and lists the matching students, for a new series or a saved one', async () => {
    const { app } = await testApp();
    const { id } = (await create(app)).json() as { id: string };
    for (const target of ['new', id]) {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/series/${target}/eligibility/preview`,
        headers: await admin(),
        payload: { eligibility: { ...NO_RESTRICTION, graduationYears: [2027], exclude: ['stu-org-a-02'] } },
      });
      expect(res.statusCode).toBe(200);
      const { count, students } = res.json() as { count: number; students: Array<{ id: string }> };
      expect(count).toBe(9);
      expect(students).toHaveLength(9);
      expect(students.map((s) => s.id)).not.toContain('stu-org-a-02');
    }
    const other = await app.inject({
      method: 'POST',
      url: '/v1/series/missing/eligibility/preview',
      headers: await admin(),
      payload: { eligibility: NO_RESTRICTION },
    });
    expect(other.statusCode).toBe(404);
  });
});
