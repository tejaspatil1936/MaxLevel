import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import {
  auditFor,
  AUTHORING_NOW,
  BASIC_QUESTIONS,
  correctOptionText,
  questionsOf,
  REASONS,
  SEEDED_TEST,
  storedPrompts,
  writeLegacyQuestionsJson,
  writeQuestionsJson,
} from '../fixtures/authoring';
import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { PNG_1X1 } from '../fixtures/files';
import { accounts, ORG_A, ORG_B } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { INVALID_JSON, QUESTIONS_EMPTY, TestEditorPage } from '../pages/test-editor';
import { expectEmptyState, expectFieldError } from '../pages/ui';

// F-2.05 Question editor and JSON import (Q-01, A11Y-10). Contract: docs/testids/phase-2.md, "Questions tab".

const prompt = (n: 1 | 2 | 3 | 4) => BASIC_QUESTIONS[n - 1]!.prompt;
/** Fragments that tell the basic questions apart in the list (question 3 renders math). */
const FRAGMENT = {
  1: 'A train 240 m long',
  2: 'What is 15% of 200?',
  3: 'what is',
  4: 'Which number comes next',
} as const;
const tmp = (name: string) => join(tmpdir(), `${Date.now()}-${name}`);

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(AUTHORING_NOW);
});

test.describe('F-2.05 question editor and JSON import', () => {
  test('Q-01 A11Y-10 an admin writes a question with a live student view that renders MathML and code, and saves it', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    await expect(editor.status).toHaveText('Draft');
    const questions = await editor.questions();
    const q = await questions.openAdd();

    await q.fill({
      prompt: 'If $x + 3 = 7$, what is $x$?\n\n```js\nconst x = 7 - 3;\n```',
      options: ['3', '4', '5', '7'],
    });

    await expect(q.studentView).toContainText('what is');
    await expect(q.math.first()).toBeAttached();
    await expect(q.texAnnotations.first()).toHaveText(/x \+ 3 = 7/);
    await expect(q.codeBlocks.first()).toContainText('const x = 7 - 3;');
    for (const text of ['3', '4', '5', '7']) await expect(q.studentView).toContainText(text);
    await expect(q.problem(REASONS.noCorrect)).toBeVisible();
    await q.fill({ correct: 'B', explanation: 'Subtract 3 from both sides.', difficulty: 'Easy' });
    await expect(q.problems).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    await q.saveAndClose();

    await expect(editor.notice('Question saved')).toBeVisible();
    await expect(questions.items).toHaveCount(1);
    await expect(questions.item(1)).toContainText('Question 1');
    await expect(questions.item(1)).toContainText('Approved');
    await expect(editor.status, 'a test with questions is in review').toHaveText('In review');
    const [stored] = await questionsOf(emulators, ORG_A.id, testId);
    expect(stored?.data).toMatchObject({
      orgId: ORG_A.id,
      testId,
      status: 'approved',
      difficulty: 'easy',
      explanation: 'Subtract 3 from both sides.',
      source: { kind: 'manual' },
    });
    expect(String(stored?.data.prompt)).toContain('$x + 3 = 7$');
    expect(stored?.data.options).toHaveLength(4);
    expect(correctOptionText(stored!)).toBe('4');
    expect(await auditFor(emulators, ORG_A.id, 'question.create', stored!.id)).toHaveLength(1);
  });

  test('Q-01 an admin edits a saved question and the list and the stored question change', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId, questionIds } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const questions = await editor.questions();
    const q = await questions.openEdit(2);
    await expect(q.prompt).toHaveValue(prompt(2));
    await expect(q.correctRadio('B')).toBeChecked();

    await q.fill({ prompt: 'What is 20% of 150?' });
    await expect(q.studentView).toContainText('What is 20% of 150?');
    await q.saveAndClose();

    await expect(questions.item(2)).toContainText('What is 20% of 150?');
    const stored = (await questionsOf(emulators, ORG_A.id, testId))[1]!;
    expect(stored.id).toBe(questionIds[1]);
    expect(stored.data).toMatchObject({ prompt: 'What is 20% of 150?', status: 'approved' });
    expect(correctOptionText(stored)).toBe('30');
    expect(await auditFor(emulators, ORG_A.id, 'question.update', stored.id)).toHaveLength(1);
  });

  test('Q-01 questions reorder by keyboard and the new order is saved', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const questions = await editor.questions();
    await questions.expectOrder([FRAGMENT[1], FRAGMENT[2], FRAGMENT[3], FRAGMENT[4]]);

    await questions.keyboardMove(1, 2);

    await questions.expectOrder([FRAGMENT[2], FRAGMENT[3], FRAGMENT[1], FRAGMENT[4]]);
    await expect
      .poll(() => storedPrompts(emulators, ORG_A.id, testId))
      .toEqual([prompt(2), prompt(3), prompt(1), prompt(4)]);
    expect(await auditFor(emulators, ORG_A.id, 'question.reorder', testId)).toHaveLength(1);
    await page.reload();
    await editor.expectShown(SEEDED_TEST.heading);
    await (await editor.questions()).expectOrder([FRAGMENT[2], FRAGMENT[3], FRAGMENT[1], FRAGMENT[4]]);
  });

  test('Q-01 questions reorder by dragging the handle and the new order is saved', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const questions = await editor.questions();

    await questions.drag(4, 1);

    await questions.expectOrder([FRAGMENT[4], FRAGMENT[1], FRAGMENT[2], FRAGMENT[3]]);
    await expect
      .poll(() => storedPrompts(emulators, ORG_A.id, testId))
      .toEqual([prompt(4), prompt(1), prompt(2), prompt(3)]);
  });

  test('A11Y-10 a question image without alt text is flagged and saved as a draft until the alt text is written', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const questions = await editor.questions();
    let q = await questions.openAdd();
    await q.fill({ prompt: 'Which shape is shown in the figure?', options: ['Square', 'Circle'], correct: 'A' });

    await q.addImage.setInputFiles({ name: 'shape.png', mimeType: 'image/png', buffer: PNG_1X1 });

    await expect(q.altText(1)).toBeVisible();
    await expect(q.problem(REASONS.noAlt(1))).toBeVisible();
    await q.saveAndClose();
    await expect(questions.item(1)).toContainText('Draft');
    await expect(questions.item(1)).toContainText(REASONS.noAlt(1));
    let [stored] = await questionsOf(emulators, ORG_A.id, testId);
    expect(stored?.data.status).toBe('draft');
    expect(stored?.data.images).toHaveLength(1);

    q = await questions.openEdit(1);
    await q.altText(1).fill('A red square');
    await expect(q.problems).toHaveCount(0);
    await expect(q.image('A red square')).toBeVisible();
    await q.saveAndClose();

    await expect(questions.item(1)).toContainText('Approved');
    await expect(questions.item(1)).not.toContainText(REASONS.noAlt(1));
    [stored] = await questionsOf(emulators, ORG_A.id, testId);
    expect(stored?.data.status).toBe('approved');
    const images = stored?.data.images as Array<{ path: string; alt: string }>;
    expect(images[0]?.alt).toBe('A red square');
    expect(images[0]?.path, 'the image is stored with a path').toBeTruthy();
  });

  test('Q-01 a question without a correct answer is saved as a draft with its reason shown', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const questions = await editor.questions();
    const q = await questions.openAdd();
    await q.fill({ prompt: 'Which of these is a prime number?', options: ['21', '23', '25', '27'] });
    await expect(q.problem(REASONS.noCorrect)).toBeVisible();

    await q.saveAndClose();

    await expect(questions.item(1)).toContainText('Draft');
    await expect(questions.item(1)).toContainText(REASONS.noCorrect);
    const [stored] = await questionsOf(emulators, ORG_A.id, testId);
    expect(stored?.data).toMatchObject({ status: 'draft', correctOptionIds: [] });
  });

  test('Q-01 an admin imports questions from a JSON file, each checked like a written one', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    const file = await writeQuestionsJson(tmp('questions.json'), [
      {
        prompt: 'A shop sells a pen for ₹60 at a 20% profit. What did it cost?',
        options: ['₹45', '₹48', '₹50', '₹52'],
        correct: 'C',
        explanation: 'Cost × 1.2 = 60, so cost = 50.',
        difficulty: 'medium',
        marks: 2,
        negativeMarks: 0.5,
        tags: ['profit and loss'],
      },
      { prompt: 'Find the odd one out.', options: ['Apple', 'Mango', 'Carrot', 'Banana'], correct: 'C' },
      { prompt: 'Which planet is known as the red planet?', options: ['Venus', 'Mars', 'Jupiter'] },
    ]);
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const questions = await editor.questions();
    const dlg = await questions.openImport();

    await dlg.file.setInputFiles(file);

    for (const text of ['Questions found: 3', 'Ready to use: 2', 'Need attention: 1'])
      await expect(dlg.summaryItem(text)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await dlg.submit.click();
    await expect(dlg.dialog).toBeHidden();
    await expect(editor.notice('Imported 3 questions')).toBeVisible();
    await questions.expectOrder(['What did it cost?', 'Find the odd one out.', 'red planet']);
    await expect(questions.item(1)).toContainText('Approved');
    await expect(questions.item(3)).toContainText('Draft');
    await expect(questions.item(3)).toContainText(REASONS.noCorrect);

    const stored = await questionsOf(emulators, ORG_A.id, testId);
    expect(stored.map((s) => s.data.status)).toEqual(['approved', 'approved', 'draft']);
    expect(stored.every((s) => (s.data.source as { kind?: string }).kind === 'json')).toBe(true);
    expect(stored[0]?.data).toMatchObject({
      difficulty: 'medium',
      marks: 2,
      negativeMarks: 0.5,
      tags: ['profit and loss'],
      explanation: 'Cost × 1.2 = 60, so cost = 50.',
    });
    expect(correctOptionText(stored[0]!)).toBe('₹50');
    expect(stored[2]?.data.options).toHaveLength(3);
    const [entry] = await auditFor(emulators, ORG_A.id, 'question.import', testId);
    expect(entry?.data.after).toMatchObject({ count: 3 });
  });

  test('Q-01 an admin imports the legacy JSON question format, mapped to the new question fields', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    const file = await writeLegacyQuestionsJson(tmp('infosys-set.json'), [
      {
        id: 'inf-1',
        text: 'A sum doubles in 5 years at simple interest. What is the rate?',
        options: ['10%', '15%', '20%', '25%'],
        correctIndex: 2,
        explanation: 'Interest equals the principal in 5 years: 100 / 5 = 20%.',
        topic: 'Simple interest',
        source: 'Infosys set 2',
      },
      {
        id: 'inf-2',
        text: 'Choose the word closest in meaning to candid.',
        options: ['Frank', 'Secretive', 'Careful', 'Polite'],
        correctIndex: 0,
        topic: 'Vocabulary',
      },
      {
        id: 'inf-3',
        text: 'Which of these numbers is divisible by 9?',
        options: ['123', '234', '345', '456'],
        correctIndex: 7,
      },
      { id: 'inf-4', text: 'Pick the next letter: A, C, E, G, ?', options: ['H', 'I', 'J', 'K'] },
    ]);
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const questions = await editor.questions();
    const dlg = await questions.openImport();

    await dlg.file.setInputFiles(file);

    for (const text of ['Questions found: 4', 'Ready to use: 2', 'Need attention: 2'])
      await expect(dlg.summaryItem(text)).toBeVisible();
    await dlg.submit.click();
    await expect(dlg.dialog).toBeHidden();
    await expect(editor.notice('Imported 4 questions')).toBeVisible();
    await questions.expectOrder(['What is the rate?', 'closest in meaning', 'divisible by 9', 'Pick the next letter']);
    await expect(questions.item(3)).toContainText(REASONS.noCorrect);
    await expect(questions.item(4)).toContainText(REASONS.noCorrect);

    const stored = await questionsOf(emulators, ORG_A.id, testId);
    expect(stored.map((d) => d.data.prompt)).toEqual([
      'A sum doubles in 5 years at simple interest. What is the rate?',
      'Choose the word closest in meaning to candid.',
      'Which of these numbers is divisible by 9?',
      'Pick the next letter: A, C, E, G, ?',
    ]);
    const optionTexts = (d: (typeof stored)[number]) => (d.data.options as Array<{ text: string }>).map((o) => o.text);
    expect(optionTexts(stored[0]!)).toEqual(['10%', '15%', '20%', '25%']);
    expect(optionTexts(stored[3]!)).toEqual(['H', 'I', 'J', 'K']);
    expect(correctOptionText(stored[0]!)).toBe('20%');
    expect(correctOptionText(stored[1]!)).toBe('Frank');
    expect(stored[0]?.data).toMatchObject({
      status: 'approved',
      explanation: 'Interest equals the principal in 5 years: 100 / 5 = 20%.',
      tags: ['Simple interest'],
      source: { kind: 'json' },
    });
    expect(stored[1]?.data).toMatchObject({ status: 'approved', tags: ['Vocabulary'], source: { kind: 'json' } });
    for (const draft of [stored[2]!, stored[3]!])
      expect(draft.data, 'no correct answer, or one out of range').toMatchObject({
        status: 'draft',
        correctOptionIds: [],
        source: { kind: 'json' },
      });
    const [entry] = await auditFor(emulators, ORG_A.id, 'question.import', testId);
    expect(entry?.data.after).toMatchObject({ count: 4 });
  });

  test('Q-01 a file that is not question JSON is refused next to the file field and adds nothing', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    const file = tmp('broken.json');
    await writeFile(file, '{ "questions": [ { "prompt": "unterminated', 'utf8');
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const questions = await editor.questions();
    const dlg = await questions.openImport();

    await dlg.file.setInputFiles(file);

    await expectFieldError(dlg.dialog, dlg.file, INVALID_JSON);
    await expect(dlg.summary).toHaveCount(0);
    expect(await questionsOf(emulators, ORG_A.id, testId)).toHaveLength(4);
    expect(await auditFor(emulators, ORG_A.id, 'question.import')).toHaveLength(0);
  });

  test('Q-01 a test without questions shows the empty state with one way to add one', async ({
    page,
    signInAs,
    testApi,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);

    const questions = await editor.questions();

    await expectEmptyState(questions.panel, QUESTIONS_EMPTY.sentence, QUESTIONS_EMPTY.action);
    await expect(questions.items).toHaveCount(0);
    await expect(questions.importJson).toBeVisible();
  });

  test('ORG-05 ORG-14 Q-01 org B questions are 404 for an org A admin, students are refused, a super admin adds, edits and reorders them', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const b = await testApi.seedAuthoringTest({ orgId: ORG_B.id });
    const a = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    const body = {
      prompt: 'What is 2 + 2?',
      options: [
        { id: 'a', text: '3' },
        { id: 'b', text: '4' },
      ],
      correctOptionIds: ['b'],
    };
    const adminA = await apiAs(accounts.adminA);
    expect((await adminA.get(`/v1/tests/${b.testId}/questions`)).status).toBe(404);
    expect((await adminA.post(`/v1/tests/${b.testId}/questions`, body)).status).toBe(404);
    expect(
      (await adminA.patch(`/v1/tests/${b.testId}/questions/${b.questionIds[0]}`, { prompt: 'Changed' })).status,
    ).toBe(404);
    expect((await adminA.delete(`/v1/tests/${b.testId}/questions/${b.questionIds[0]}`)).status).toBe(404);
    expect(
      (await adminA.put(`/v1/tests/${b.testId}/questions/order`, { ids: [...b.questionIds].reverse() })).status,
    ).toBe(404);
    expect(await storedPrompts(emulators, ORG_B.id, b.testId)).toEqual(BASIC_QUESTIONS.map((q) => q.prompt));

    const student = await apiAs(accounts.studentA);
    expect((await student.get(`/v1/tests/${a.testId}/questions`)).status).toBe(403);
    expect((await student.post(`/v1/tests/${a.testId}/questions`, body)).status).toBe(403);
    expect((await student.put(`/v1/tests/${a.testId}/questions/order`, { ids: [] })).status).toBe(403);

    const superA = await apiAs(accounts.superAdmin, { orgId: ORG_A.id });
    const created = await superA.post<{ id: string; status: string }>(`/v1/tests/${a.testId}/questions`, body);
    expect([200, 201]).toContain(created.status);
    expect(created.body.status).toBe('approved');
    const [stored] = await questionsOf(emulators, ORG_A.id, a.testId);
    expect(stored?.data).toMatchObject({ prompt: 'What is 2 + 2?', status: 'approved' });
    const [entry] = await auditFor(emulators, ORG_A.id, 'question.create', created.body.id);
    expect(entry?.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });
    const superB = superA.inOrg(ORG_B.id);
    const listB = await superB.get<{ items: unknown[] }>(`/v1/tests/${b.testId}/questions`);
    expect(listB.status).toBe(200);
    expect(listB.body.items).toHaveLength(4);
    expect(
      (await superB.put(`/v1/tests/${b.testId}/questions/order`, { ids: [...b.questionIds].reverse() })).status,
    ).toBe(200);
    expect(await storedPrompts(emulators, ORG_B.id, b.testId)).toEqual(BASIC_QUESTIONS.map((q) => q.prompt).reverse());
    expect(
      (await superB.patch(`/v1/tests/${b.testId}/questions/${b.questionIds[0]}`, { prompt: 'Edited by the platform' }))
        .status,
    ).toBe(200);
    expect((await questionsOf(emulators, ORG_B.id, b.testId)).find((d) => d.id === b.questionIds[0])?.data.prompt).toBe(
      'Edited by the platform',
    );
  });
});
