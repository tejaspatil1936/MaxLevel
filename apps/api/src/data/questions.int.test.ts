import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { createData } from '.';
import type { QuestionInput } from './questions';

const { db } = initFirebase();
const data = createData(db);
const base: QuestionInput = {
  order: 1,
  prompt: 'What is 15% of 200?',
  images: [],
  options: [
    { id: 'a', text: '25' },
    { id: 'b', text: '30' },
  ],
  correctOptionIds: ['b'],
  tags: [],
  source: { kind: 'manual' },
  status: 'approved',
};

beforeEach(async () => {
  await clearEmulators();
});

async function add(orgId: string, testId: string, extra: Partial<QuestionInput>, now = 1000) {
  const batch = db.batch();
  const id = data.questions.createQuestion(orgId, batch, testId, { ...base, ...extra }, now);
  await batch.commit();
  return id;
}

describe('questions data access', () => {
  it('Q-01 ORG-01 a question is stored under its test in its org, with orgId and no undefined fields', async () => {
    const id = await add('org-a', 't1', { explanation: undefined, difficulty: 'medium' });
    expect((await db.doc(`organizations/org-a/tests/t1/questions/${id}`).get()).data()).toEqual({
      orgId: 'org-a',
      testId: 't1',
      type: 'single',
      ...base,
      difficulty: 'medium',
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(await data.questions.getQuestion('org-a', 't1', id)).toMatchObject({ id, prompt: base.prompt });
    expect(await data.questions.getQuestion('org-b', 't1', id)).toBeNull();
    expect(await data.questions.listQuestions('org-b', 't1')).toEqual([]);
  });

  it('Q-01 questions list in order, and setOrder stores the new sequence', async () => {
    const first = await add('org-a', 't1', { order: 1, prompt: 'One' });
    const third = await add('org-a', 't1', { order: 3, prompt: 'Three' });
    const second = await add('org-a', 't1', { order: 2, prompt: 'Two' });
    expect((await data.questions.listQuestions('org-a', 't1')).map((q) => q.id)).toEqual([first, second, third]);
    const batch = db.batch();
    data.questions.setOrder('org-a', batch, 't1', [third, first, second], 2000);
    await batch.commit();
    const list = await data.questions.listQuestions('org-a', 't1');
    expect(list.map((q) => [q.prompt, q.order])).toEqual([
      ['Three', 1],
      ['One', 2],
      ['Two', 3],
    ]);
  });

  it('Q-01 an update changes fields, null removes an optional one, and delete removes the question', async () => {
    const id = await add('org-a', 't1', { explanation: 'Because.', marks: 2 });
    const batch = db.batch();
    data.questions.updateQuestion('org-a', batch, 't1', id, {
      prompt: 'What is 20% of 150?',
      explanation: null,
      marks: 3,
      status: 'draft',
      updatedAt: 2000,
    });
    await batch.commit();
    const stored = (await db.doc(`organizations/org-a/tests/t1/questions/${id}`).get()).data();
    expect(stored).toMatchObject({ prompt: 'What is 20% of 150?', marks: 3, status: 'draft', updatedAt: 2000 });
    expect(stored).not.toHaveProperty('explanation');
    const del = db.batch();
    data.questions.deleteQuestion('org-a', del, 't1', id);
    await del.commit();
    expect(await data.questions.getQuestion('org-a', 't1', id)).toBeNull();
  });

  it('TST-04 PERF-01 a question change bumps the question set version and can move the test to review', async () => {
    const batch = db.batch();
    const testId = data.tests.createTest(
      'org-a',
      batch,
      { seriesId: 's1', title: 'Aptitude', dayHidden: false, scheduledDate: '2026-11-03' },
      1000,
    );
    await batch.commit();
    const change = db.batch();
    data.tests.questionsChanged('org-a', change, testId, 2000, 'in_review');
    await change.commit();
    expect(await data.tests.getTest('org-a', testId)).toMatchObject({
      status: 'in_review',
      questionSetVersion: 2,
      updatedAt: 2000,
    });
  });

  it('Q-03 clearSection moves questions to no section and leaves the others in theirs', async () => {
    const moved = await add('org-a', 't1', { sectionId: 'gone' });
    const kept = await add('org-a', 't1', { sectionId: 'quant' });
    const batch = db.batch();
    data.questions.clearSection('org-a', batch, 't1', [moved], 2000);
    await batch.commit();
    const [a, b] = await Promise.all([
      data.questions.getQuestion('org-a', 't1', moved),
      data.questions.getQuestion('org-a', 't1', kept),
    ]);
    expect(a).not.toHaveProperty('sectionId');
    expect(a?.updatedAt).toBe(2000);
    expect(b).toMatchObject({ sectionId: 'quant', updatedAt: 1000 });
  });
});
