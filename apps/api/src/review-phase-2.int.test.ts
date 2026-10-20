import { resolveSettings } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// Regressions for the phase 2 mid-phase review (PROGRESS.md).
const { db, auth } = initFirebase();
const orgA = SEED.orgA;
const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: orgA });

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
    defaults: { timingMode: 'fixed', resultDetail: 'sections', resultRelease: 'after_close' },
    eligibility: { departmentIds: [], graduationYears: [], include: [], exclude: [] },
    createdAt: 0,
    updatedAt: 0,
  });
});

describe('a series edit cannot make one of its tests leak answers', () => {
  it('SER-09 DATA-05 changing the defaults to a flexible window is refused when a test would then release a full review on submit', async () => {
    const { app } = await testApp();
    const headers = await admin();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/tests',
      headers,
      payload: { seriesId: 's1', title: 'Aptitude', scheduledDate: '2026-11-02' },
    });
    const testId = (created.json() as { id: string }).id;
    const override = await app.inject({
      method: 'PATCH',
      url: `/v1/tests/${testId}`,
      headers,
      payload: { overrides: { resultDetail: 'full', resultRelease: 'immediate' } },
    });
    expect(override.statusCode).toBe(200);
    const series = await app.inject({
      method: 'PATCH',
      url: '/v1/series/s1',
      headers,
      payload: { defaults: { timingMode: 'flexible', resultDetail: 'sections', resultRelease: 'after_close' } },
    });
    expect([series.statusCode, series.json().error?.code]).toEqual([400, 'FULL_REVIEW_BEFORE_CLOSE']);
    expect((await db.doc(`organizations/${orgA}/series/s1`).get()).get('defaults.timingMode')).toBe('fixed');
  });
});

describe('a published snapshot never takes the leaky combination', () => {
  it('SER-09 DATA-05 TST-05 a release override on a published flexible test is checked against its snapshot', async () => {
    const { app } = await testApp();
    const headers = await admin();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/tests',
      headers,
      payload: { seriesId: 's1', title: 'Aptitude', scheduledDate: '2026-11-02' },
    });
    const testId = (created.json() as { id: string }).id;
    // Published while the series was flexible; the series has since gone back to a fixed slot.
    await db.doc(`organizations/${orgA}/tests/${testId}`).update({
      status: 'scheduled',
      resolved: resolveSettings({
        series: {
          defaults: { timingMode: 'flexible', resultDetail: 'sections', resultRelease: 'after_close' },
          dailyWindow: { startMinutes: 600, endMinutes: 840 },
        },
        test: { overrides: {}, scheduledDate: '2026-11-02' },
        timezone: 'Asia/Kolkata',
      }),
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/tests/${testId}`,
      headers,
      payload: { overrides: { resultDetail: 'full', resultRelease: 'immediate' } },
    });
    expect([res.statusCode, res.json().error?.code]).toEqual([400, 'FULL_REVIEW_BEFORE_CLOSE']);
    const stored = (await db.doc(`organizations/${orgA}/tests/${testId}`).get()).get('resolved');
    expect(stored).toMatchObject({ resultDetail: 'sections', resultRelease: 'after_close' });
  });
});

describe('publishing re-checks the settings', () => {
  it('Q-14 US-AD-09 TST-05 a series change after approval that breaks the settings blocks publishing', async () => {
    const { app } = await testApp();
    const headers = await admin();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/tests',
      headers,
      payload: { seriesId: 's1', title: 'Aptitude', scheduledDate: '2026-11-02' },
    });
    const testId = (created.json() as { id: string }).id;
    const question = await app.inject({
      method: 'POST',
      url: `/v1/tests/${testId}/questions`,
      headers,
      payload: {
        prompt: 'What is 2 + 2?',
        options: [
          { id: 'a', text: '4' },
          { id: 'b', text: '5' },
        ],
        correctOptionIds: ['a'],
      },
    });
    expect(question.statusCode).toBe(201);
    const approve = await app.inject({ method: 'POST', url: `/v1/tests/${testId}/approve`, headers, payload: {} });
    expect(approve.statusCode).toBe(200);
    // A 120-minute flexible test in a 60-minute daily window can never be started.
    const series = await app.inject({
      method: 'PATCH',
      url: '/v1/series/s1',
      headers,
      payload: {
        defaults: { timingMode: 'flexible', durationMin: 120, resultDetail: 'sections', resultRelease: 'after_close' },
      },
    });
    expect(series.statusCode).toBe(200);
    const publish = await app.inject({ method: 'POST', url: `/v1/tests/${testId}/publish`, headers, payload: {} });
    expect([publish.statusCode, publish.json().error?.code]).toEqual([409, 'CHECKLIST_FAILED']);
    expect((await db.doc(`organizations/${orgA}/tests/${testId}`).get()).get('status')).toBe('approved');
  });
});
