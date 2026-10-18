import { errorCode } from '../fixtures/api';
import { auditFor, AUTHORING_NOW, questionsOf, SEEDED_TEST, storedTest } from '../fixtures/authoring';
import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { accounts, ORG_A, ORG_B } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { MARKING_ERRORS, SECTION_ERRORS, SECTIONS_EMPTY, TestEditorPage } from '../pages/test-editor';
import { expectEmptyState, expectFieldError } from '../pages/ui';

// F-2.06 Sections, pools, difficulty mix, marking and timers (Q-03, Q-05, Q-08, Q-10, US-AD-07). Contract:
// docs/testids/phase-2.md, "Sections tab" and "Marking and timers tab".

interface StoredSection {
  id: string;
  name: string;
  order: number;
  instructions?: string;
  durationMin?: number;
  drawCount?: number;
  difficultyMix?: { easy: number; medium: number; hard: number };
  forwardOnly: boolean;
}

const sectionsOf = async (data: Record<string, unknown>) =>
  [...((data.sections as StoredSection[] | undefined) ?? [])].sort((a, b) => a.order - b.order);

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(AUTHORING_NOW);
});

test.describe('F-2.06 sections, pools, difficulty mix, marking and timers', () => {
  test('Q-03 an admin adds sections with name, instructions, duration and forward-only navigation, and reorders them', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const sections = await editor.sections();

    let dlg = await sections.openAdd();
    await dlg.fill({
      name: 'Quant',
      instructions: 'Answer every question. Calculators are not allowed.',
      durationMin: '20',
      forwardOnly: true,
    });
    await expectNoSeriousA11yViolations(page);
    await dlg.saveAndClose();
    dlg = await sections.openAdd();
    await dlg.fill({ name: 'Verbal' });
    await dlg.saveAndClose();

    expect(await sections.names()).toEqual(['Quant', 'Verbal']);
    await expect(await sections.cell('Quant', 'Order')).toHaveText('1');
    await expect(await sections.cell('Quant', 'Duration')).toHaveText('20 minutes');
    await expect(await sections.cell('Quant', 'Navigation')).toHaveText('Forward only');
    await expect(await sections.cell('Quant', 'Draw')).toHaveText('All');
    await expect(await sections.cell('Quant', 'Difficulty mix')).toHaveText('None');
    await expect(await sections.cell('Verbal', 'Duration')).toHaveText('Test timer');
    await expect(await sections.cell('Verbal', 'Navigation')).toHaveText('Free');
    await expect(sections.wholeTestHeading, 'no whole-test draw once sections exist').toHaveCount(0);

    await sections.choose('Verbal', 'Move up');

    await expect.poll(() => sections.names()).toEqual(['Verbal', 'Quant']);
    await expect
      .poll(async () => (await sectionsOf(await storedTest(emulators, ORG_A.id, testId))).map((s) => s.name))
      .toEqual(['Verbal', 'Quant']);
    const stored = await sectionsOf(await storedTest(emulators, ORG_A.id, testId));
    expect(stored[1]).toMatchObject({
      name: 'Quant',
      order: 2,
      instructions: 'Answer every question. Calculators are not allowed.',
      durationMin: 20,
      forwardOnly: true,
    });
    expect(stored[0]).toMatchObject({ name: 'Verbal', order: 1, forwardOnly: false });
    expect(typeof stored[0]?.id, 'sections get IDs').toBe('string');
    expect((await auditFor(emulators, ORG_A.id, 'test.update', testId)).length).toBeGreaterThanOrEqual(3);
  });

  test('Q-05 US-AD-07 a difficulty mix is saved only when the section pool can satisfy it', async ({
    page,
    signInAs,
    testApi,
    apiAs,
    emulators,
  }) => {
    const { testId, sectionIds } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'sectioned' });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const sections = await editor.sections();
    await expect(await sections.cell('Quant', 'Questions')).toHaveText('6');
    const dlg = await sections.openEdit('Quant');

    await dlg.fill({ mix: { easy: '2', medium: '2', hard: '2' } });
    await dlg.save.click();

    await expect(dlg.dialog).toBeVisible();
    await expectFieldError(dlg.dialog, dlg.mixField('Hard'), SECTION_ERRORS.mixTooLarge(1, 'hard', 2));
    expect((await sectionsOf(await storedTest(emulators, ORG_A.id, testId)))[0]?.difficultyMix).toBeUndefined();

    await dlg.fill({ mix: { hard: '1' } });
    await dlg.saveAndClose();

    await expect(await sections.cell('Quant', 'Difficulty mix')).toHaveText('2 easy, 2 medium, 1 hard');
    expect((await sectionsOf(await storedTest(emulators, ORG_A.id, testId)))[0]?.difficultyMix).toEqual({
      easy: 2,
      medium: 2,
      hard: 1,
    });

    const api = await apiAs(accounts.adminA);
    const refused = await api.patch(`/v1/tests/${testId}`, {
      sections: [
        {
          id: sectionIds.Quant,
          name: 'Quant',
          order: 1,
          forwardOnly: false,
          difficultyMix: { easy: 4, medium: 0, hard: 0 },
        },
        { id: sectionIds.Verbal, name: 'Verbal', order: 2, forwardOnly: false },
      ],
    });
    expect(refused.status).toBe(400);
    expect(errorCode(refused)).toBe('MIX_UNSATISFIABLE');
    expect((await sectionsOf(await storedTest(emulators, ORG_A.id, testId)))[0]?.difficultyMix).toEqual({
      easy: 2,
      medium: 2,
      hard: 1,
    });
  });

  test('US-AD-07 a section or whole-test draw larger than its pool is refused, and one that fits is saved', async ({
    page,
    signInAs,
    testApi,
    apiAs,
    emulators,
  }) => {
    const sectioned = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'sectioned' });
    const plain = await testApi.seedAuthoringTest({
      orgId: ORG_A.id,
      seriesId: sectioned.seriesId,
      title: 'Data interpretation',
      scheduledDate: '2026-11-03',
    });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(sectioned.testId, SEEDED_TEST.heading);
    let sections = await editor.sections();
    const dlg = await sections.openEdit('Verbal');

    await dlg.fill({ drawCount: '6' });
    await dlg.save.click();
    await expectFieldError(dlg.dialog, dlg.draw, SECTION_ERRORS.drawTooLarge(4, 6));
    await dlg.fill({ drawCount: '3' });
    await dlg.saveAndClose();
    await expect(await sections.cell('Verbal', 'Draw')).toHaveText('3');
    expect((await sectionsOf(await storedTest(emulators, ORG_A.id, sectioned.testId)))[1]?.drawCount).toBe(3);

    await editor.goto(plain.testId, 'Day 2: Data interpretation');
    sections = await editor.sections();
    await sections.wholeTestDraw.fill('8');
    await sections.saveDraw.click();
    await expectFieldError(sections.panel, sections.wholeTestDraw, SECTION_ERRORS.testDrawTooLarge(4, 8));
    expect((await storedTest(emulators, ORG_A.id, plain.testId)).drawCount ?? null).toBeNull();
    await sections.wholeTestDraw.fill('3');
    await sections.saveDraw.click();
    await expect(editor.notice('Draw saved')).toBeVisible();
    await expect.poll(async () => (await storedTest(emulators, ORG_A.id, plain.testId)).drawCount).toBe(3);

    const api = await apiAs(accounts.adminA);
    const refused = await api.patch(`/v1/tests/${plain.testId}`, { drawCount: 9 });
    expect(refused.status).toBe(400);
    expect(errorCode(refused)).toBe('DRAW_TOO_LARGE');
    expect((await storedTest(emulators, ORG_A.id, plain.testId)).drawCount).toBe(3);
  });

  test('Q-08 marking presets fill values that stay editable, and an edited value becomes Custom', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    let marking = await editor.marking();
    await expect(marking.preset('p1_0')).toBeChecked();
    await expect(marking.marks).toHaveValue('1');
    await expect(marking.negative).toHaveValue('0');
    await expectNoSeriousA11yViolations(page);

    await marking.preset('p1_m025').check();
    await expect(marking.marks).toHaveValue('1');
    await expect(marking.negative).toHaveValue('0.25');
    await marking.preset('p4_m1').check();
    await expect(marking.marks).toHaveValue('4');
    await expect(marking.negative).toHaveValue('1');
    await marking.saveAndConfirm();
    await expect
      .poll(async () => ((await storedTest(emulators, ORG_A.id, testId)).overrides as Record<string, unknown>).marking)
      .toEqual({ marks: 4, negativeMarks: 1, preset: 'p4_m1' });

    await marking.marks.fill('5');
    await expect(marking.preset('custom')).toBeChecked();
    await expect(marking.negative, 'the other value is kept').toHaveValue('1');
    await marking.saveAndConfirm();

    await expect
      .poll(async () => ((await storedTest(emulators, ORG_A.id, testId)).overrides as Record<string, unknown>).marking)
      .toEqual({ marks: 5, negativeMarks: 1, preset: 'custom' });
    await page.reload();
    await editor.expectShown(SEEDED_TEST.heading);
    marking = await editor.marking();
    await expect(marking.preset('custom')).toBeChecked();
    await expect(marking.marks).toHaveValue('5');
  });

  test('Q-08 marks of 0 or a negative deduction below 0 are refused next to the field', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const marking = await editor.marking();

    await marking.marks.fill('0');
    await marking.negative.fill('-1');
    await marking.save.click();

    await expectFieldError(marking.panel, marking.marks, MARKING_ERRORS.marks);
    await expectFieldError(marking.panel, marking.negative, MARKING_ERRORS.negative);
    expect((await storedTest(emulators, ORG_A.id, testId)).overrides).toEqual({});
  });

  test('Q-10 a time limit is set for every question at once, or on each question in the editor', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    const { testId, questionIds } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    let questions = await editor.questions();
    let q = await questions.openEdit(1);
    await expect(q.timeLimit, 'no per-question field while there is no time limit').toHaveCount(0);
    await page.keyboard.press('Escape');
    let marking = await editor.marking();
    await expect(marking.limit('No time limit')).toBeChecked();

    await marking.limit('Same limit for every question').check();
    await marking.seconds.fill('0');
    await marking.save.click();
    await expectFieldError(marking.panel, marking.seconds, MARKING_ERRORS.seconds);
    await marking.seconds.fill('90');
    await marking.saveAndConfirm();
    await expect
      .poll(
        async () =>
          ((await storedTest(emulators, ORG_A.id, testId)).overrides as Record<string, unknown>).questionTimeLimitSec,
      )
      .toBe(90);

    await marking.limit('Set on each question').check();
    await expect(marking.seconds).toHaveCount(0);
    await marking.saveAndConfirm();
    await expect
      .poll(
        async () =>
          ((await storedTest(emulators, ORG_A.id, testId)).overrides as Record<string, unknown>).questionTimeLimitSec,
      )
      .toBeUndefined();
    questions = await editor.questions();
    q = await questions.openEdit(1);
    await q.fill({ timeLimit: '45' });
    await q.saveAndClose();

    await expect
      .poll(
        async () =>
          (await questionsOf(emulators, ORG_A.id, testId)).find((d) => d.id === questionIds[0])?.data.timeLimitSec,
      )
      .toBe(45);
    await page.reload();
    await editor.expectShown(SEEDED_TEST.heading);
    marking = await editor.marking();
    await expect(marking.limit('Set on each question')).toBeChecked();
  });

  test('Q-03 a test without sections shows the empty state and the whole-test draw', async ({
    page,
    signInAs,
    testApi,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);

    const sections = await editor.sections();

    await expectEmptyState(sections.panel, SECTIONS_EMPTY.sentence, SECTIONS_EMPTY.action);
    await expect(sections.list).toHaveCount(0);
    await expect(sections.wholeTestHeading).toBeVisible();
    await expect(sections.wholeTestDraw).toHaveValue('');
  });

  test('ORG-05 ORG-14 Q-03 org B sections are 404 for an org A admin, refused for students, and set by a super admin', async ({
    testApi,
    apiAs,
    emulators,
  }) => {
    const b = await testApi.seedAuthoringTest({ orgId: ORG_B.id });
    const a = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    const sections = [{ name: 'Quant', order: 1, forwardOnly: false }];

    expect((await (await apiAs(accounts.adminA)).patch(`/v1/tests/${b.testId}`, { sections })).status).toBe(404);
    expect((await storedTest(emulators, ORG_B.id, b.testId)).sections ?? []).toEqual([]);
    expect((await (await apiAs(accounts.studentA)).patch(`/v1/tests/${a.testId}`, { sections })).status).toBe(403);

    const superB = await apiAs(accounts.superAdmin, { orgId: ORG_B.id });
    expect((await superB.patch(`/v1/tests/${b.testId}`, { sections })).status).toBe(200);
    expect(await sectionsOf(await storedTest(emulators, ORG_B.id, b.testId))).toMatchObject([
      { name: 'Quant', order: 1, forwardOnly: false },
    ]);
    const [entry] = await auditFor(emulators, ORG_B.id, 'test.update', b.testId);
    expect(entry?.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });
    expect((await superB.inOrg(ORG_A.id).patch(`/v1/tests/${a.testId}`, { drawCount: 2 })).status).toBe(200);
    expect((await storedTest(emulators, ORG_A.id, a.testId)).drawCount).toBe(2);
  });
});
