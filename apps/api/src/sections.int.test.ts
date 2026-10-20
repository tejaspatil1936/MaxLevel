import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// Sections, pools and the draw checks of PATCH /v1/tests/{id} (Q-03, Q-05, US-AD-07).

const { db, auth } = initFirebase();
const orgA = SEED.orgA;
const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: orgA });
const testDoc = () => db.doc(`organizations/${orgA}/tests/t1`);
const questionDoc = (id: string) => db.doc(`organizations/${orgA}/tests/t1/questions/${id}`);

/** Quant: 3 easy, 1 hard and a draft; Verbal: 2 medium; one question in no section. */
const QUESTIONS: Array<[string, string | null, string, string]> = [
  ['q1', 'quant', 'easy', 'approved'],
  ['q2', 'quant', 'easy', 'approved'],
  ['q3', 'quant', 'easy', 'approved'],
  ['q4', 'quant', 'hard', 'approved'],
  ['q5', 'quant', 'hard', 'draft'],
  ['q6', 'verbal', 'medium', 'approved'],
  ['q7', 'verbal', 'medium', 'approved'],
  ['q8', null, 'easy', 'approved'],
];
const QUANT = { id: 'quant', name: 'Quant', order: 1, forwardOnly: false };
const VERBAL = { id: 'verbal', name: 'Verbal', order: 2, forwardOnly: false };

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
    overrides: {},
    eligibility: { departmentIds: [], graduationYears: [], include: [], exclude: [] },
    sections: [QUANT, VERBAL],
    status: 'in_review',
    questionSetVersion: 1,
    totalMarks: 0,
    attemptsStarted: false,
    createdAt: 0,
    updatedAt: 0,
  });
  await Promise.all(
    QUESTIONS.map(([id, sectionId, difficulty, status], i) =>
      questionDoc(id).set({
        orgId: orgA,
        testId: 't1',
        type: 'single',
        order: i + 1,
        prompt: `Question ${id}`,
        options: [
          { id: 'a', text: 'One' },
          { id: 'b', text: 'Two' },
        ],
        correctOptionIds: ['a'],
        ...(sectionId ? { sectionId } : {}),
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
const patch = async (app: App, payload: object) =>
  app.inject({ method: 'PATCH', url: '/v1/tests/t1', headers: await admin(), payload });

describe('sections and draw checks', () => {
  it('US-AD-07 Q-05 a section draw or mix its approved questions cannot satisfy is refused and nothing is stored', async () => {
    const { app } = await testApp();
    const cases: Array<[object, string, string, Record<string, unknown>]> = [
      [
        { drawCount: 5 },
        'DRAW_TOO_LARGE',
        "This section has 4 approved questions, so it can't draw 5.",
        { field: 'drawCount', sectionId: 'quant', available: 4 },
      ],
      [
        { difficultyMix: { easy: 1, medium: 0, hard: 2 } },
        'MIX_UNSATISFIABLE',
        "This section has 1 hard question, so the mix can't take 2.",
        { field: 'difficultyMix.hard', sectionId: 'quant', wanted: 2, available: 1 },
      ],
      [
        { drawCount: 3, difficultyMix: { easy: 2, medium: 0, hard: 0 } },
        'MIX_UNSATISFIABLE',
        'The mix adds up to 2 questions. Set Questions to draw to 2 or leave it empty.',
        { field: 'drawCount', problem: 'MIX_DRAW_MISMATCH', mixTotal: 2 },
      ],
    ];
    for (const [config, code, message, details] of cases) {
      const res = await patch(app, { sections: [{ ...QUANT, ...config }, VERBAL] });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({ code, message, details });
    }
    expect((await testDoc().get()).data()?.sections).toEqual([QUANT, VERBAL]);

    const ok = await patch(app, {
      sections: [
        { ...QUANT, drawCount: 3, difficultyMix: { easy: 2, medium: 0, hard: 1 } },
        { ...VERBAL, drawCount: 2 },
      ],
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().sections[0]).toMatchObject({ drawCount: 3, difficultyMix: { easy: 2, medium: 0, hard: 1 } });
  });

  it('US-AD-07 a whole-test draw is checked against every approved question, and null removes it', async () => {
    const { app } = await testApp();
    await testDoc().update({ sections: [] });
    const refused = await patch(app, { drawCount: 8 });
    expect(refused.json().error).toMatchObject({
      code: 'DRAW_TOO_LARGE',
      message: "This test has 7 approved questions, so it can't draw 8.",
      details: { field: 'drawCount', sectionId: null },
    });
    expect((await patch(app, { drawCount: 7 })).json().drawCount).toBe(7);
    expect((await patch(app, { drawCount: null })).json()).not.toHaveProperty('drawCount');
    expect((await testDoc().get()).data()).not.toHaveProperty('drawCount');
  });

  it('Q-03 US-AD-07 a pool the change leaves alone is not judged again, so a stale draw does not block a reorder', async () => {
    const { app } = await testApp();
    await testDoc().update({ sections: [{ ...QUANT, drawCount: 9 }, VERBAL] });
    const res = await patch(app, { sections: [VERBAL, { ...QUANT, drawCount: 9 }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().sections.map((s: { id: string; order: number }) => [s.id, s.order])).toEqual([
      ['verbal', 1],
      ['quant', 2],
    ]);
  });

  it('Q-03 deleting a section moves its questions to no section in the same change, and new sections get IDs', async () => {
    const { app } = await testApp();
    const res = await patch(app, { sections: [VERBAL, { name: 'Reasoning', order: 9, forwardOnly: true }] });
    expect(res.statusCode).toBe(200);
    const [verbal, reasoning] = res.json().sections as Array<{ id: string; name: string; order: number }>;
    expect(verbal).toMatchObject({ id: 'verbal', order: 1 });
    expect(reasoning).toMatchObject({ name: 'Reasoning', order: 2, forwardOnly: true });
    expect(typeof reasoning?.id).toBe('string');
    for (const id of ['q1', 'q4', 'q5']) expect((await questionDoc(id).get()).data()).not.toHaveProperty('sectionId');
    expect((await questionDoc('q6').get()).data()?.sectionId).toBe('verbal');
    expect((await testDoc().get()).data()?.questionSetVersion).toBe(2);
  });
});
