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
