import type { StudentDashboard, StudentTestPage } from '@mitaoe/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { TEST_SECRET, testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// GET /v1/student/dashboard and GET /v1/student/tests/{id} (US-ST-03, UX-11, SER-02, SER-04 to SER-06, DATA-05).

const { db, auth } = initFirebase();
const NOW = Date.UTC(2026, 10, 2, 4, 0); // 2 Nov 2026, 09:30 IST
const MIN = 60_000;
let app: Awaited<ReturnType<typeof testApp>>['app'];
let clock: Awaited<ReturnType<typeof testApp>>['clock'];

const student = (n = 1) =>
  asClaims(auth, `student0${n}@a.test`, { role: 'student', orgId: SEED.orgA, studentId: `stu-org-a-0${n}` });

async function seed(scenario: string, body: object) {
  const res = await app.inject({
    method: 'POST',
    url: `/__test/seed/${scenario}`,
    headers: { 'x-test-secret': TEST_SECRET },
    payload: { orgId: SEED.orgA, ...body },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { seriesId: string; testId: string; attemptId?: string };
}
const examTest = (body: object = {}) => seed('exam-test', body);

async function get<T>(url: string, headers: Record<string, string>) {
  const res = await app.inject({ method: 'GET', url, headers });
  return { status: res.statusCode, body: res.json() as T, raw: res.body };
}
const dashboard = async (n = 1) => {
  const res = await get<StudentDashboard>('/v1/student/dashboard', await student(n));
  expect(res.status, res.raw).toBe(200);
  return res;
};

beforeAll(async () => {
  ({ app, clock } = await testApp());
});

beforeEach(async () => {
  await clearEmulators();
  clock.set(NOW);
  await seedBase(db, NOW);
});

describe('student dashboard', () => {
  it('US-ST-03 UX-11 DATA-05 groups live, upcoming and completed tests in order with windows, last starts and the timezone', async () => {
    const quant = await examTest({ opensInMin: -10 });
    const verbal = await examTest({
      title: 'Verbal ability',
      timingMode: 'flexible',
      opensInMin: -30,
      windowMin: 180,
      durationMin: 45,
    });
    const logic = await examTest({ title: 'Logical reasoning', company: 'Wipro', opensInMin: 2 * 1440 + 210 });
    const later = await examTest({ title: 'Later reasoning', opensInMin: 3 * 1440 });
    const done = await seed('student-attempts', { studentId: 'stu-org-a-01' });

    const { body, raw } = await dashboard();
    expect(body.timezone).toBe('Asia/Kolkata');
    expect(body.live).toEqual([
      {
        testId: quant.testId,
        title: 'Quantitative aptitude',
        dayLabel: 'Day 1',
        company: 'TCS',
        window: { start: NOW - 10 * MIN, end: NOW + 50 * MIN },
        durationMin: 60,
        lastStartAt: NOW + 5 * MIN,
      },
      expect.objectContaining({ testId: verbal.testId, durationMin: 45, lastStartAt: NOW + 105 * MIN }),
    ]);
    expect(body.upcoming.map((t) => t.testId)).toEqual([logic.testId, later.testId]);
    expect(body.upcoming[0]).toMatchObject({ company: 'Wipro', window: { start: NOW + (2 * 1440 + 210) * MIN } });
    expect(body.completed).toEqual([
      {
        testId: done.testId,
        title: 'Day 1: Aptitude',
        dayLabel: 'Day 1',
        attemptId: done.attemptId,
        status: 'submitted',
        finishedAt: NOW - 120_000,
      },
    ]);
    expect(raw).not.toContain('correctOptionIds');
    expect(raw).not.toContain('explanation');
  });

  it('US-ST-03 SER-02 SER-04 SER-06 hides ineligible, draft-series, unpublished, missed and other-org tests', async () => {
    const open = await examTest({ title: 'Open aptitude' });
    const mech = await examTest({ eligibility: { departmentIds: ['dept-org-a-mechanical'] } });
    const hidden = [
      mech,
      await examTest({ seriesEligibility: { exclude: ['stu-org-a-01'] } }),
      await examTest({ seriesStatus: 'draft' }),
      await examTest({ seriesStatus: 'archived' }),
      await examTest({ publish: false }),
      await examTest({ opensInMin: -180 }),
      await examTest({ opensInMin: -20 }), // past the 15-minute late entry cutoff
      await seed('exam-test', { orgId: SEED.orgB }),
    ];
    const { raw, body } = await dashboard();
    expect(body.live.map((t) => t.testId)).toEqual([open.testId]);
    for (const t of hidden) expect(raw).not.toContain(t.testId);
    // The department rule is per student: student 04 is in Mechanical.
    expect((await dashboard(4)).body.live.map((t) => t.testId)).toContain(mech.testId);
  });

  it('US-ST-03 an attempt in progress stays live to resume after the last start; a finished one moves to completed', async () => {
    const running = await examTest({ title: 'Running' });
    const finished = await examTest({ title: 'Finished' });
    const attempt = (id: string, testId: string, seriesId: string, status: string) =>
      db.doc(`organizations/${SEED.orgA}/attempts/${id}`).set({
        orgId: SEED.orgA,
        testId,
        seriesId,
        studentId: 'stu-org-a-01',
        status,
        startedAt: NOW,
        ...(status === 'in_progress' ? {} : { submittedAt: NOW + 5 * MIN }),
      });
    await attempt('att-run', running.testId, running.seriesId, 'in_progress');
    await attempt('att-done', finished.testId, finished.seriesId, 'terminated');
    clock.set(NOW + 30 * MIN);
    const { body } = await dashboard();
    expect(body.live).toEqual([expect.objectContaining({ testId: running.testId, attemptId: 'att-run' })]);
    expect(body.completed).toEqual([
      expect.objectContaining({ testId: finished.testId, attemptId: 'att-done', status: 'terminated' }),
    ]);
    expect((await dashboard(2)).body.live).toEqual([]);
  });

  it('US-ST-03 staff tokens get 403', async () => {
    const admin = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
    const sa = await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' });
    expect((await get('/v1/student/dashboard', admin)).status).toBe(403);
    expect((await get('/v1/student/dashboard', { ...sa, 'x-org-id': SEED.orgA })).status).toBe(403);
    const t = await examTest();
    expect((await get(`/v1/student/tests/${t.testId}`, admin)).status).toBe(403);
  });
});

describe('student test page', () => {
  const page = async (testId: string, n = 1) => get<StudentTestPage>(`/v1/student/tests/${testId}`, await student(n));

  it('US-ST-03 UX-11 DATA-05 shows the details, draw size, sections, marking and strikes of a listed test', async () => {
    const live = await examTest({
      opensInMin: -10,
      overrides: { marking: { marks: 4, negativeMarks: 1, preset: 'p4_m1' }, maxStrikes: 5 },
    });
    const res = await page(live.testId);
    expect(res.status, res.raw).toBe(200);
    expect(res.body).toEqual({
      testId: live.testId,
      title: 'Quantitative aptitude',
      dayLabel: 'Day 1',
      company: 'TCS',
      window: { start: NOW - 10 * MIN, end: NOW + 50 * MIN },
      durationMin: 60,
      lastStartAt: NOW + 5 * MIN,
      timezone: 'Asia/Kolkata',
      state: 'live',
      questionCount: 4,
      sections: [],
      marking: { marks: 4, negativeMarks: 1, preset: 'p4_m1' },
      maxStrikes: 5,
      exam: {
        timingMode: 'fixed',
        windowEndPolicy: 'full_duration',
        fullscreenRequired: false,
        cameraRequired: false,
        secondCamera: false,
        audioProctoring: false,
      },
    });
    expect(res.raw).not.toContain('correctOptionIds');
    expect(res.raw).not.toContain('explanation');

    const sectioned = await examTest({ questions: 'sectioned', sectionDraws: { Quant: 3, Verbal: 2 }, opensInMin: 60 });
    expect((await page(sectioned.testId)).body).toMatchObject({
      state: 'upcoming',
      questionCount: 5,
      sections: [
        { name: 'Quant', questionCount: 3 },
        { name: 'Verbal', questionCount: 2 },
      ],
    });
  });

  it('EX-01 EX-02 carries the timing mode and proctoring switches the preflight and rules screens need', async () => {
    const flexible = await examTest({
      timingMode: 'flexible',
      overrides: { windowEndPolicy: 'hard_close', fullscreenRequired: true, cameraRequired: true },
    });
    const res = await page(flexible.testId);
    expect(res.status, res.raw).toBe(200);
    expect(res.body.exam).toEqual({
      timingMode: 'flexible',
      windowEndPolicy: 'hard_close',
      fullscreenRequired: true,
      cameraRequired: true,
      secondCamera: false,
      audioProctoring: false,
    });
  });

  it("OPS-07 A11Y-17 carries the student's standing accommodation for the series in whole minutes, and none for others", async () => {
    const t = await examTest({ timingMode: 'flexible', durationMin: 45, windowMin: 120 });
    const other = await examTest({ title: 'Logical reasoning' });
    expect((await page(t.testId)).body.extraMin).toBeUndefined();
    await db
      .doc(`organizations/${SEED.orgA}/students/stu-org-a-01`)
      .update({ [`accommodations.${t.seriesId}`]: { extraPct: 30 } });
    expect((await page(t.testId)).body.extraMin).toBe(14); // 45 × 30% = 13.5, rounded
    expect((await page(other.testId)).body.extraMin).toBeUndefined();
    expect((await page(t.testId, 2)).body.extraMin).toBeUndefined();
  });

  it('US-ST-03 a test the dashboard would not list is 404, and a finished one says so', async () => {
    const mech = await examTest({ eligibility: { departmentIds: ['dept-org-a-mechanical'] } });
    const draft = await examTest({ publish: false });
    const other = await seed('exam-test', { orgId: SEED.orgB });
    for (const id of [mech.testId, draft.testId, other.testId, 'no-such-test'])
      expect((await page(id)).status, id).toBe(404);
    expect((await page(mech.testId, 4)).status).toBe(200);

    const sat = await examTest();
    await db.doc(`organizations/${SEED.orgA}/attempts/att-1`).set({
      orgId: SEED.orgA,
      testId: sat.testId,
      seriesId: sat.seriesId,
      studentId: 'stu-org-a-01',
      status: 'submitted',
      startedAt: NOW,
      submittedAt: NOW + MIN,
    });
    expect((await page(sat.testId)).body).toMatchObject({ state: 'finished', testId: sat.testId });
    clock.set(NOW + 2 * 1440 * MIN);
    expect((await page(sat.testId)).body).toMatchObject({ state: 'finished' });
  });
});
