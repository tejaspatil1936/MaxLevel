import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { TEST_SECRET, testApp } from './app';
import { clearEmulators } from './emulators';
import { seedBase, SEED } from './seed';

const { db } = initFirebase();
const org = db.doc(`organizations/${SEED.orgA}`);

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
});

async function seed(body: object) {
  const { app } = await testApp();
  const res = await app.inject({
    method: 'POST',
    url: '/__test/seed/authoring-test',
    headers: { 'x-test-secret': TEST_SECRET },
    payload: { orgId: SEED.orgA, ...body },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { seriesId: string; testId: string; questionIds: string[]; sectionIds: Record<string, string> };
}
const questions = async (testId: string) =>
  (await org.collection(`tests/${testId}/questions`).orderBy('order').get()).docs.map(
    (d) => ({ id: d.id, ...d.data() }) as Record<string, unknown> & { id: string },
  );

describe('authoring-test scenario', () => {
  it('TST-01 TST-04 seeds the basic questions in order in a new default series, in review', async () => {
    const ids = await seed({ invalidQuestion: true });
    const test = (await org.collection('tests').doc(ids.testId).get()).data();
    expect(test).toMatchObject({
      seriesId: ids.seriesId,
      title: 'Quantitative aptitude',
      company: 'TCS',
      scheduledDate: '2026-11-02',
      dayHidden: false,
      overrides: {},
      status: 'in_review',
    });
    expect((await org.collection('series').doc(ids.seriesId).get()).get('title')).toBe('Placement 2026');
    const qs = await questions(ids.testId);
    expect(qs.map((q) => q.id)).toEqual(ids.questionIds);
    expect(qs.map((q) => q.status)).toEqual(['approved', 'approved', 'approved', 'approved', 'draft']);
    expect(qs[1]).toMatchObject({ prompt: 'What is 15% of 200?', correctOptionIds: ['b'], difficulty: 'medium' });
    expect(qs[2]).not.toHaveProperty('explanation');
    expect(ids.sectionIds).toEqual({});
  });

  it('TST-04 no questions is a draft; sectioned with draws and publish is scheduled with its snapshot', async () => {
    const empty = await seed({ questions: 'none', title: 'Reasoning' });
    expect((await org.collection('tests').doc(empty.testId).get()).get('status')).toBe('draft');
    expect(empty.questionIds).toEqual([]);

    const ids = await seed({
      seriesId: empty.seriesId,
      questions: 'sectioned',
      sectionDraws: { Quant: 4 },
      publish: true,
    });
    expect(ids.seriesId).toBe(empty.seriesId);
    const test = (await org.collection('tests').doc(ids.testId).get()).data()!;
    expect(test.sections.map((s: { name: string; order: number }) => [s.name, s.order])).toEqual([
      ['Quant', 1],
      ['Verbal', 2],
    ]);
    expect(test.sections[0]).toMatchObject({ id: ids.sectionIds.Quant, drawCount: 4, forwardOnly: false });
    expect(test).toMatchObject({
      status: 'scheduled',
      approval: { status: 'approved' },
      resolved: { window: { start: Date.UTC(2026, 10, 2, 4, 30), end: Date.UTC(2026, 10, 2, 5, 30) } },
      totalMarks: 8,
    });
    const qs = await questions(ids.testId);
    expect(qs.filter((q) => q.sectionId === ids.sectionIds.Verbal).map((q) => q.prompt)).toEqual([
      'Verbal easy 1',
      'Verbal easy 2',
      'Verbal medium 1',
      'Verbal medium 2',
    ]);
  });
});

describe('exam-test scenario', () => {
  const NOW = Date.UTC(2026, 10, 2, 4, 0); // 2 Nov 2026, 09:30 IST
  const MIN = 60_000;
  async function seedExam(body: object) {
    const { app, clock } = await testApp();
    clock.set(NOW);
    const res = await app.inject({
      method: 'POST',
      url: '/__test/seed/exam-test',
      headers: { 'x-test-secret': TEST_SECRET },
      payload: { orgId: SEED.orgA, ...body },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { seriesId: string; testId: string; window: { start: number; end: number } };
  }

  it('US-ST-03 TST-05 seeds a published live test in a new active series, with hardware proctoring and shuffling off', async () => {
    const ids = await seedExam({});
    expect(ids.window).toEqual({ start: NOW - 2 * MIN, end: NOW + 58 * MIN });
    const series = (await org.collection('series').doc(ids.seriesId).get()).data()!;
    expect(series).toMatchObject({
      title: 'Placement 2026',
      status: 'active',
      dailyWindow: { startMinutes: 600, endMinutes: 660 },
      eligibility: { departmentIds: [], graduationYears: [], include: [], exclude: [] },
    });
    expect(series.startDate <= '2026-11-02' && series.endDate >= '2026-11-02').toBe(true);
    const test = (await org.collection('tests').doc(ids.testId).get()).data()!;
    expect(test).toMatchObject({
      title: 'Quantitative aptitude',
      company: 'TCS',
      scheduledDate: '2026-11-02',
      status: 'scheduled',
      totalMarks: 4,
      resolved: {
        timingMode: 'fixed',
        window: ids.window,
        durationMin: 60,
        lateEntryCutoffMin: 15,
        fullscreenRequired: false,
        cameraRequired: false,
        secondCamera: false,
        shuffleQuestions: false,
        shuffleOptions: false,
        marking: { marks: 1, negativeMarks: 0 },
      },
    });
  });

  it('PERF-06 RES-01 publishing queues the release and pre-warm tasks as Publish test does', async () => {
    const { app, clock, queue } = await testApp();
    clock.set(NOW);
    const res = await app.inject({
      method: 'POST',
      url: '/__test/seed/exam-test',
      headers: { 'x-test-secret': TEST_SECRET },
      payload: { orgId: SEED.orgA, opensInMin: 90 },
    });
    expect(res.statusCode, res.body).toBe(200);
    const { testId, window } = res.json() as { testId: string; window: { start: number; end: number } };
    const tasks = (await queue.pending()).filter((t) => t.name.includes(testId));
    expect(tasks).toEqual(
      expect.arrayContaining([
        {
          name: `prewarm-${SEED.orgA}-${testId}-${window.start}`,
          path: '/tasks/prewarm',
          scheduleTime: window.start - 30 * MIN,
        },
        {
          name: `release-results-${SEED.orgA}-${testId}-${window.end}`,
          path: '/tasks/release-results',
          scheduleTime: window.end,
        },
      ]),
    );
  });

  it('US-ST-03 SER-06 applies timing, overrides, both rule sets, the series status and publish: false', async () => {
    const ids = await seedExam({
      title: 'Verbal ability',
      timingMode: 'flexible',
      opensInMin: -30,
      windowMin: 180,
      durationMin: 45,
      overrides: { maxStrikes: 5 },
      eligibility: { departmentIds: ['dept-org-a-mechanical'] },
      seriesEligibility: { exclude: ['stu-org-a-01'] },
      seriesStatus: 'draft',
    });
    const test = (await org.collection('tests').doc(ids.testId).get()).data()!;
    expect(test.resolved).toMatchObject({ timingMode: 'flexible', durationMin: 45, maxStrikes: 5 });
    expect(test.resolved.window).toEqual({ start: NOW - 30 * MIN, end: NOW + 150 * MIN });
    expect(test.eligibility).toEqual({
      departmentIds: ['dept-org-a-mechanical'],
      graduationYears: [],
      include: [],
      exclude: [],
    });
    const series = (await org.collection('series').doc(ids.seriesId).get()).data()!;
    expect(series).toMatchObject({ status: 'draft', eligibility: { exclude: ['stu-org-a-01'] } });

    const draft = await seedExam({ seriesId: ids.seriesId, publish: false, opensInMin: 2 * 1440 });
    expect(draft.seriesId).toBe(ids.seriesId);
    const stored = (await org.collection('tests').doc(draft.testId).get()).data()!;
    expect(stored).toMatchObject({ status: 'in_review', scheduledDate: '2026-11-04' });
    expect(stored).not.toHaveProperty('resolved');
  });
});

describe('graded-attempts scenario', () => {
  const NOW = Date.UTC(2026, 10, 2, 4, 0); // 2 Nov 2026, 09:30 IST
  async function post(scenario: string, body: object) {
    const { app, clock } = await testApp();
    clock.set(NOW);
    const res = await app.inject({
      method: 'POST',
      url: `/__test/seed/${scenario}`,
      headers: { 'x-test-secret': TEST_SECRET },
      payload: { orgId: SEED.orgA, ...body },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Record<string, unknown>;
  }

  it('US-ST-08 writes finished graded attempts of the test with their index entries, in input order', async () => {
    const t = (await post('exam-test', {})) as {
      testId: string;
      seriesId: string;
      window: { start: number; end: number };
    };
    const { attemptIds } = (await post('graded-attempts', {
      testId: t.testId,
      attempts: [
        { studentId: 'stu-org-a-01', score: 3, timeSec: 600, correct: 3, incorrect: 1 },
        { studentId: 'stu-org-a-02', score: 1, timeSec: 300, status: 'terminated', strikesCount: 3 },
      ],
    })) as { attemptIds: string[] };
    expect(attemptIds).toHaveLength(2);
    const [a, b] = await Promise.all(
      attemptIds.map(async (id) => (await org.collection('attempts').doc(id).get()).data()!),
    );
    expect(a).toMatchObject({
      testId: t.testId,
      seriesId: t.seriesId,
      studentId: 'stu-org-a-01',
      status: 'submitted',
      startedAt: t.window.start,
      submittedAt: t.window.start + 600_000,
      deadlineAt: t.window.end,
      strikesCount: 0,
      result: { score: 3, max: 4, pct: 75, correct: 3, incorrect: 1, unanswered: 0, durationSec: 600, sections: {} },
    });
    expect(a!.draw.questionIds).toHaveLength(4);
    expect(a!.draw.optionOrder[a!.draw.questionIds[0]]).toEqual(['a', 'b', 'c', 'd']);
    expect(b).toMatchObject({ status: 'terminated', terminationReason: 'max_strikes', strikesCount: 3 });
    const index = (await org.collection('attemptIndex').doc(`${t.testId}_stu-org-a-02`).get()).data();
    expect(index).toMatchObject({ activeAttemptId: attemptIds[1] });
    expect((await org.collection('tests').doc(t.testId).get()).get('attemptsStarted')).toBe(true);
  });
});

describe('more-students scenario', () => {
  it('LB-05 adds registered students from 21 made like the base seed, departments cycling', async () => {
    const { app } = await testApp();
    const post = (orgId: string, count: number) =>
      app.inject({
        method: 'POST',
        url: '/__test/seed/more-students',
        headers: { 'x-test-secret': TEST_SECRET },
        payload: { orgId, count },
      });
    const res = await post(SEED.orgA, 3);
    expect(res.json()).toEqual({ studentIds: ['stu-org-a-21', 'stu-org-a-22', 'stu-org-a-23'] });
    const s21 = (await org.collection('students').doc('stu-org-a-21').get()).data();
    expect(s21).toMatchObject({
      email: 'student21@a.test',
      name: 'Student 21',
      prn: '22010121',
      departmentId: 'dept-org-a-computer', // departments[(21 - 1) mod 4]
      graduationYear: 2026,
      status: 'registered',
    });
    expect((await org.collection('students').doc('stu-org-a-22').get()).get('departmentId')).toBe('dept-org-a-it');
    expect((await org.collection('students').doc('stu-org-a-22').get()).get('graduationYear')).toBe(2027);
    const entries = await org.collection('whitelist').where('studentId', '==', 'stu-org-a-23').get();
    expect(entries.docs.map((d) => d.get('status'))).toEqual(['registered']);
    const b = await post(SEED.orgB, 1);
    expect(b.json()).toEqual({ studentIds: ['stu-org-b-21'] });
    const b21 = (await db.doc(`organizations/${SEED.orgB}/students/stu-org-b-21`).get()).data();
    expect(b21).toMatchObject({ email: 'student21@b.test', prn: 'B22010121', departmentId: 'dept-org-b-computer' });
    expect((await post('org-zzz', 1)).statusCode).toBe(404);
  });
});
