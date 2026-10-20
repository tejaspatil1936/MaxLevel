import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// GET /v1/tests/{id}/preview: a fresh draw as a student would get it, with the answer key, and nothing stored
// (Q-13, US-AD-08). Access per role and organization is covered by the route-table tests.

const { db, auth } = initFirebase();
const orgA = SEED.orgA;
const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: orgA });
const testDoc = () => db.doc(`organizations/${orgA}/tests/t1`);
const QUANT = { id: 'quant', name: 'Quant', order: 1, instructions: 'No calculators.', forwardOnly: false };
const VERBAL = { id: 'verbal', name: 'Verbal', order: 2, forwardOnly: false };
const OPTIONS = ['a', 'b', 'c', 'd'];

/** Quant: 3 easy, 2 hard and a draft; Verbal: 3 medium. */
const QUESTIONS: Array<[string, string, string, string]> = [
  ['q1', 'quant', 'easy', 'approved'],
  ['q2', 'quant', 'easy', 'approved'],
  ['q3', 'quant', 'easy', 'approved'],
  ['q4', 'quant', 'hard', 'approved'],
  ['q5', 'quant', 'hard', 'approved'],
  ['q6', 'quant', 'hard', 'draft'],
  ['q7', 'verbal', 'medium', 'approved'],
  ['q8', 'verbal', 'medium', 'approved'],
  ['q9', 'verbal', 'medium', 'approved'],
];

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
    defaults: {},
    eligibility: { departmentIds: [], graduationYears: [], include: [], exclude: [] },
    createdAt: 0,
    updatedAt: 0,
  });
  await testDoc().set({
    orgId: orgA,
    seriesId: 's1',
    title: 'Aptitude',
    dayHidden: false,
    scheduledDate: '2026-11-02',
    overrides: { shuffleQuestions: false, shuffleOptions: false },
    eligibility: { departmentIds: [], graduationYears: [], include: [], exclude: [] },
    sections: [
      { ...QUANT, difficultyMix: { easy: 2, medium: 0, hard: 1 } },
      { ...VERBAL, drawCount: 2 },
    ],
    status: 'in_review',
    questionSetVersion: 1,
    totalMarks: 0,
    attemptsStarted: false,
    createdAt: 0,
    updatedAt: 0,
  });
  await Promise.all(
    QUESTIONS.map(([id, sectionId, difficulty, status], i) =>
      db.doc(`organizations/${orgA}/tests/t1/questions/${id}`).set({
        orgId: orgA,
        testId: 't1',
        type: 'single',
        order: i + 1,
        prompt: `Question ${id}`,
        options: OPTIONS.map((o) => ({ id: o, text: `Option ${o}` })),
        correctOptionIds: ['b'],
        explanation: `Because ${id}.`,
        sectionId,
        difficulty,
        tags: [],
        images: [],
        source: { kind: 'manual' },
        status,
        createdAt: i,
        updatedAt: 0,
      }),
    ),
  );
});

type App = Awaited<ReturnType<typeof testApp>>['app'];
interface Preview {
  test: { title: string; dayLabel: string | null };
  sections: Array<{ id: string; name: string }>;
  questions: Array<{ id: string; sectionId?: string; options: Array<{ id: string }>; correctOptionIds: string[] }>;
}
const preview = async (app: App) => {
  const res = await app.inject({ method: 'GET', url: '/v1/tests/t1/preview', headers: await admin() });
  expect(res.statusCode).toBe(200);
  return res.json() as Preview & { questions: Array<{ explanation?: string }> };
};
const difficultyOf = (id: string) => QUESTIONS.find((q) => q[0] === id)![2];

describe('exam preview', () => {
  it('Q-13 US-AD-08 draws approved questions section by section with the mix and draw counts, answer key included', async () => {
    const { app } = await testApp();
    const body = await preview(app);
    expect(body.test).toEqual({ id: 't1', title: 'Aptitude', dayLabel: 'Day 1' });
    expect(body.sections.map((s) => s.name)).toEqual(['Quant', 'Verbal']);
    const sections = body.questions.map((q) => q.sectionId);
    expect(sections).toEqual(['quant', 'quant', 'quant', 'verbal', 'verbal']);
    const quant = body.questions.slice(0, 3).map((q) => difficultyOf(q.id));
    expect(quant.sort()).toEqual(['easy', 'easy', 'hard']);
    expect(body.questions.map((q) => q.id)).not.toContain('q6');
    expect(body.questions[0]).toMatchObject({
      correctOptionIds: ['b'],
      explanation: `Because ${body.questions[0]!.id}.`,
    });
    expect(
      body.questions[0]!.options.map((o) => o.id),
      'shuffle options off keeps the stored order',
    ).toEqual(OPTIONS);
  });

  it('US-AD-08 each preview is a fresh draw, shuffled when the settings shuffle, and nothing is stored', async () => {
    const { app } = await testApp();
    await testDoc().update({ overrides: {}, sections: [QUANT, VERBAL] });
    const draws = [];
    for (let i = 0; i < 5; i++) draws.push(await preview(app));
    const orders = draws.map((d) => d.questions.map((q) => q.id));
    for (const order of orders) {
      expect(order).toHaveLength(8);
      expect(order.slice(0, 5).sort(), 'Quant questions come first').toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
    }
    expect(new Set(orders.map((o) => o.join())).size, 'question order differs between previews').toBeGreaterThan(1);
    const optionOrders = draws.map((d) => d.questions.map((q) => q.options.map((o) => o.id).join()).join('|'));
    expect(new Set(optionOrders).size, 'option order differs between previews').toBeGreaterThan(1);
    expect((await db.collection(`organizations/${orgA}/attempts`).get()).size).toBe(0);
    expect((await db.collection(`organizations/${orgA}/attemptIndex`).get()).size).toBe(0);
  });
});
