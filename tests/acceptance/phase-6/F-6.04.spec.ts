import {
  AUTHORING_NOW,
  auditFor,
  correctOptionText,
  questionsOf,
  SEEDED_TEST,
  storedPrompts,
} from '../fixtures/authoring';
import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import {
  fixtureQuestions,
  llmFixture,
  plainPdf,
  PDF_TYPE,
  quantPaperPdf,
  reasoningNotes,
} from '../fixtures/import-files';
import {
  approveDrafts,
  draftByOrder,
  FLAG_TEXTS,
  getJob,
  IMPORT_TEXTS,
  importFile,
  importReady,
  QUANT_PAPER_FLAGGED,
  QUANT_PAPER_FLAGS,
  storedDrafts,
  waitForJob,
  waitForJobState,
} from '../fixtures/imports';
import { accounts, ORG_A, ORG_B } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import {
  ImportDialog,
  ImportNotFound,
  ImportReviewPage,
  QuestionsTabImports,
  REVIEW_SHORTCUTS,
} from '../pages/import-pages';
import { pathPattern } from '../pages/paths';
import { expectShellRules, Shell } from '../pages/shell';
import { TestEditorPage } from '../pages/test-editor';
import { exactly, expectEmptyState } from '../pages/ui';

// F-6.04 Import review screen (IMP-04, IMP-10 to IMP-13, US-AD-06). Contract: docs/testids/phase-6.md,
// "Questions tab additions", "Review page", "Approval" and "Keyboard".

const paper = llmFixture('quant-paper');
const PAPER = 'quant-paper.pdf';
const q = (order: number) => fixtureQuestions(paper)[order - 1]!;
const MIN = 60_000;

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(AUTHORING_NOW);
});

test.describe('F-6.04 import review screen', () => {
  test('US-AD-06 IMP-04 IMP-12 an admin uploads a PDF, watches its progress live, and approves every valid question in one go', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(120_000);
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await testApi.llm.script({ pages: paper.pages, hold: [3] });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const tab = new QuestionsTabImports(page, await editor.openTab('Questions'));
    const dlg = await tab.openImport();
    await dlg.startWith(quantPaperPdf());

    await expect(page).toHaveURL(pathPattern('/admin/imports/review/'));
    const jobId = new URL(page.url()).searchParams.get('id') ?? '';
    expect(jobId).not.toBe('');
    const review = new ImportReviewPage(page);
    await review.expectShown(PAPER);
    await expect(review.back(SEEDED_TEST.heading)).toHaveAttribute('href', TestEditorPage.url(testId));

    // Page 3 is held: two pages done, four questions found so far.
    await expect(review.progressText(IMPORT_TEXTS.pagesProcessed(2, 3))).toBeVisible();
    await expect(review.progressText(IMPORT_TEXTS.questionsFound(4))).toBeVisible();
    await expect(review.progressbar).toHaveAttribute('aria-valuenow', '2');
    await expect(review.progressbar).toHaveAttribute('aria-valuemax', '3');
    await expect(review.leaveNote).toBeVisible();
    await expect(review.status).toHaveText('Processing');
    expect(await storedPrompts(emulators, ORG_A.id, testId), 'nothing added while importing').toHaveLength(4);

    await review.markDocument();
    await testApi.llm.release();
    await expect(review.summary).toBeVisible({ timeout: 15_000 });
    await review.expectSameDocument();
    await expect(review.progress).toHaveCount(0);
    await expect(review.status).toHaveText('Ready for review');
    for (const item of ['Questions found: 9', 'Need fixing: 7', 'Ready to approve: 2', 'Approved: 0', 'Discarded: 0'])
      await expect(review.summaryItem(item)).toBeVisible();

    // Flagged first, then valid; each group in import order.
    await expect(review.groupHeading('Need fixing')).toBeVisible();
    await expect(review.groupHeading('Ready to approve')).toBeVisible();
    await expect(review.group('Approved')).toHaveCount(0);
    await expect(review.group('Discarded')).toHaveCount(0);
    await expect.poll(() => review.orders('Need fixing')).toEqual([...QUANT_PAPER_FLAGGED]);
    await expect.poll(() => review.orders('Ready to approve')).toEqual([1, 5]);
    await expect
      .poll(() => review.orders(), { message: 'flagged questions are grouped at the top' })
      .toEqual([2, 3, 4, 6, 7, 8, 9, 1, 5]);

    const first = review.draftIn('Ready to approve', 1);
    await expect(first.text('Page 1')).toBeVisible();
    await expect(first.article).toContainText(q(1).prompt);
    await expect(first.optionItem('A. Rs. 480')).toBeVisible();
    await expect(first.optionItem('B. Rs. 500')).toBeVisible();
    await expect(first.text('Correct answer: B')).toBeVisible();
    await expect(first.text('Suggested difficulty: Easy')).toBeVisible();
    await expect(first.reasons).toHaveCount(0);
    await expect(review.draftIn('Ready to approve', 5).image(q(5).figure!.alt)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    expect(await storedPrompts(emulators, ORG_A.id, testId), 'nothing added before approval').toHaveLength(4);

    await review.approveAll.click();
    await expect(review.notice(IMPORT_TEXTS.approved(2))).toBeVisible();
    await expect(review.summaryItem('Approved: 2')).toBeVisible();
    await expect(review.summaryItem('Ready to approve: 0')).toBeVisible();
    await expect(review.approveAll).toBeDisabled();
    await expect.poll(() => review.orders('Approved')).toEqual([1, 5]);
    await expect(review.draftIn('Approved', 1).text(IMPORT_TEXTS.addedAs(5))).toBeVisible();
    await expect(review.draftIn('Approved', 5).text(IMPORT_TEXTS.addedAs(6))).toBeVisible();
    await expect(review.draftIn('Approved', 1).approve).toHaveCount(0);
    // Draft 8 repeated draft 1, which is now question 5 of the test.
    await expect(review.draftIn('Need fixing', 8).reasonItems()).toHaveText([FLAG_TEXTS.DUPLICATE_IN_TEST(5)]);

    const questions = await questionsOf(emulators, ORG_A.id, testId);
    expect(questions).toHaveLength(6);
    const [q5, q6] = [questions[4]!, questions[5]!];
    expect(q5.data).toMatchObject({
      prompt: q(1).prompt,
      explanation: q(1).explanation,
      difficulty: 'easy',
      status: 'approved',
      source: { kind: 'ai', jobId, page: 1 },
    });
    expect(correctOptionText(q5)).toBe('Rs. 500');
    expect(q6.data).toMatchObject({ prompt: q(5).prompt, source: { kind: 'ai', jobId, page: 3 } });
    const images = q6.data.images as Array<{ path: string; alt: string }>;
    expect(images).toHaveLength(1);
    expect(images[0]!.path.startsWith(`organizations/${ORG_A.id}/tests/${testId}/images/`)).toBe(true);
    expect(images[0]!.alt).toBe(q(5).figure!.alt);
    const drafts = await storedDrafts(emulators, ORG_A.id, jobId);
    expect(drafts[0]!.data).toMatchObject({ status: 'approved', questionId: q5.id });
    expect(drafts[4]!.data).toMatchObject({ status: 'approved', questionId: q6.id });
    const [entry] = await auditFor(emulators, ORG_A.id, 'question.import', testId);
    expect(entry?.data).toMatchObject({
      actor: { email: accounts.adminA.email, role: 'admin' },
      after: { count: 2, jobId },
    });
    expect(
      (await getJob(await apiAs(accounts.adminA), jobId)).drafts.filter((d) => d.status === 'pending'),
    ).toHaveLength(7);
  });

  test('IMP-04 the import keeps running after the tab is closed, and the admin finds it again from the test', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    test.setTimeout(90_000);
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await testApi.llm.script({ pages: paper.pages, hold: [2] });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const dlg = await new QuestionsTabImports(page, await editor.openTab('Questions')).openImport();
    await dlg.startWith(quantPaperPdf());
    const review = new ImportReviewPage(page);
    await review.expectShown(PAPER);
    await expect(review.progressText(IMPORT_TEXTS.pagesProcessed(1, 3))).toBeVisible();
    await expect(review.progressText(IMPORT_TEXTS.questionsFound(2))).toBeVisible();
    const jobId = new URL(page.url()).searchParams.get('id') ?? '';

    const context = page.context();
    await page.close();
    await testApi.llm.release();
    const admin = await apiAs(accounts.adminA);
    // The worker finishes with no browser open (the held task is in flight, so the queue dispatches on its own).
    const job = await waitForJob(admin, testApi, jobId, ['ready', 'failed'], { runDue: false });
    expect(job.status).toBe('ready');
    expect(job.progress).toEqual({ pagesDone: 3, pagesTotal: 3, questionsFound: 9 });

    const again = await context.newPage();
    const editorAgain = new TestEditorPage(again);
    await editorAgain.goto(testId, SEEDED_TEST.heading);
    const tab = new QuestionsTabImports(again, await editorAgain.openTab('Questions'));
    const item = tab.importItem(PAPER);
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('Ready for review');
    await expect(item).toContainText('20 Oct 2026, 11:30 IST');
    await expect(tab.importLink(PAPER)).toHaveAttribute('href', ImportReviewPage.url(jobId));
    await tab.importLink(PAPER).click();
    const back = new ImportReviewPage(again);
    await back.expectShown(PAPER);
    await expect(back.summaryItem('Questions found: 9')).toBeVisible();
    await expect(back.status).toHaveText('Ready for review');
  });

  test('IMP-10 IMP-12 flagged questions list their reasons in plain words and cannot be approved until they are fixed inline', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    test.setTimeout(120_000);
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await testApi.llm.script({ pages: paper.pages });
    const admin = await apiAs(accounts.adminA);
    const job = await importReady(admin, request, testApi, testId, quantPaperPdf());
    await signInAs(accounts.adminA);
    const review = new ImportReviewPage(page);
    await review.goto(job.id, PAPER);
    await expect(review.summary).toBeVisible();

    for (const n of QUANT_PAPER_FLAGGED) {
      const card = review.draftIn('Need fixing', n);
      await expect(card.reasonItems(), `reasons of question ${n}`).toHaveText(QUANT_PAPER_FLAGS[n]!.map((f) => f.text));
      await expect(card.approve).toBeDisabled();
      await expect(card.approve).toHaveAccessibleDescription(IMPORT_TEXTS.fixFirst);
    }
    await expect(review.draftIn('Ready to approve', 1).reasons).toHaveCount(0);
    await expectShellRules(page, 'import review');

    // The API refuses a flagged draft too, and the whole request with it.
    const refused = await approveDrafts(admin, job.id, [draftByOrder(job, 1).id, draftByOrder(job, 4).id]);
    expect(refused.status).toBe(409);
    expect((refused.body as { error?: { code?: string; details?: { draftIds?: string[] } } }).error).toMatchObject({
      code: 'DRAFTS_FLAGGED',
      details: { draftIds: [draftByOrder(job, 4).id] },
    });
    expect(await storedPrompts(emulators, ORG_A.id, testId)).toHaveLength(4);

    // Question 4 had no answer in the source: the admin sets one inline, and it can be approved.
    const four = review.draftIn('Need fixing', 4);
    await four.edit.click();
    await expect(four.prompt).toHaveValue(q(4).prompt);
    await four.correctRadio('B').check();
    await four.save.click();
    await expect(review.notice(IMPORT_TEXTS.saved(4))).toBeVisible();
    const fixed = review.draftIn('Ready to approve', 4);
    await expect(fixed.article).toBeVisible();
    await expect(fixed.reasons).toHaveCount(0);
    await expect(fixed.text('Correct answer: B')).toBeVisible();
    await expect(review.summaryItem('Need fixing: 6')).toBeVisible();
    await fixed.approve.click();
    await expect(review.notice(IMPORT_TEXTS.approved(1))).toBeVisible();
    await expect(review.draftIn('Approved', 4).text(IMPORT_TEXTS.addedAs(5))).toBeVisible();
    const questions = await questionsOf(emulators, ORG_A.id, testId);
    expect(questions).toHaveLength(5);
    expect(questions[4]!.data).toMatchObject({ prompt: q(4).prompt, status: 'approved' });
    expect(correctOptionText(questions[4]!)).toBe('2 hours');

    // Question 2 repeated a test question: rewording it clears the flag.
    const two = review.draftIn('Need fixing', 2);
    await two.edit.click();
    await two.prompt.fill('What is 20% of 150?');
    await two.save.click();
    await expect(review.notice(IMPORT_TEXTS.saved(2))).toBeVisible();
    await expect(review.draftIn('Ready to approve', 2).reasons).toHaveCount(0);
    const draft2 = (await storedDrafts(emulators, ORG_A.id, job.id))[1]!;
    expect(draft2.data).toMatchObject({ prompt: 'What is 20% of 150?', flags: [], status: 'pending' });

    // Discarding needs no fix.
    await review.draftIn('Need fixing', 9).discard.click();
    await expect(review.notice(IMPORT_TEXTS.discarded(9))).toBeVisible();
    await expect(review.draftIn('Discarded', 9).article).toBeVisible();
    await expect(review.draftIn('Discarded', 9).approve).toHaveCount(0);
    await expect(review.summaryItem('Discarded: 1')).toBeVisible();
    expect((await storedDrafts(emulators, ORG_A.id, job.id))[8]!.data.status).toBe('discarded');
    expect(await storedPrompts(emulators, ORG_A.id, testId), 'a discarded question is not added').toHaveLength(5);
  });

  test('IMP-11 the source page sits beside the current question, with the question highlighted on it', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    request,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await testApi.llm.script({ pages: paper.pages });
    const admin = await apiAs(accounts.adminA);
    const job = await importReady(admin, request, testApi, testId, quantPaperPdf());
    await signInAs(accounts.adminA);
    const review = new ImportReviewPage(page);
    await review.goto(job.id, PAPER);

    // The first pending draft in display order is current: question 2, on page 1.
    const two = review.draft(2);
    await two.expectCurrent();
    await expect(review.current).toHaveCount(1);
    await expect(review.sourceImage(1, PAPER)).toBeVisible();
    await expect(review.highlight).toBeVisible();
    await expectHighlight(review, 1, q(2).box!);

    // Beside, not below: the source page starts right of the current question and both are in view.
    await expect
      .poll(async () => (await review.sourceGapRightOf(two)) ?? Number.NEGATIVE_INFINITY, {
        message: 'source page right of the question',
      })
      .toBeGreaterThanOrEqual(-1);
    await expect(review.sourceImage(1, PAPER)).toBeInViewport();
    await expect(two.heading).toBeInViewport();

    const five = review.draft(5);
    await five.heading.click();
    await five.expectCurrent();
    await expect(review.current).toHaveCount(1);
    await expect(review.sourceImage(3, PAPER)).toBeVisible();
    await expect(review.sourceImage(1, PAPER)).toHaveCount(0);
    await expectHighlight(review, 3, q(5).box!);
    await expect(review.sourceImage(3, PAPER)).toBeInViewport();

    await review.draft(3).heading.click();
    await review.draft(3).expectCurrent();
    await expect(review.sourceImage(2, PAPER)).toBeVisible();
    await expectHighlight(review, 2, q(3).box!);
  });

  test('IMP-13 next, previous, approve, edit and discard each have a key, listed under the question mark', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    test.setTimeout(120_000);
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await testApi.llm.script({ pages: paper.pages });
    const admin = await apiAs(accounts.adminA);
    const job = await importReady(admin, request, testApi, testId, quantPaperPdf());
    await signInAs(accounts.adminA);
    const review = new ImportReviewPage(page);
    await review.goto(job.id, PAPER);
    const shell = new Shell(page);

    await review.draft(2).heading.click();
    await expect(review.draft(2).article).toBeFocused();
    await shell.openShortcuts();
    await expect(review.reviewShortcuts.getByRole('listitem')).toHaveText(
      REVIEW_SHORTCUTS.map(([k, label]) => new RegExp(`^\\s*${k}\\s+${label}\\s*$`)),
    );
    await page.keyboard.press('Escape');
    await expect(shell.shortcuts).toBeHidden();

    await review.draft(2).heading.click();
    await page.keyboard.press('j');
    await review.draft(3).expectCurrent();
    await expect(review.draft(3).article).toBeFocused();
    await page.keyboard.press('j');
    await review.draft(4).expectCurrent();
    await page.keyboard.press('k');
    await review.draft(3).expectCurrent();
    await expect(review.draft(3).article).toBeFocused();

    // A flagged draft is not approved by its key.
    await page.keyboard.press('a');
    await expect(review.notice(IMPORT_TEXTS.fixBeforeApproving)).toBeVisible();
    expect(draftByOrder(await getJob(admin, job.id), 3).status).toBe('pending');

    // Edit by key, fix the answer, approve by key.
    await page.keyboard.press('j');
    await review.draft(4).expectCurrent();
    await page.keyboard.press('e');
    await expect(review.draft(4).prompt).toBeFocused();
    await review.draft(4).correctRadio('B').check();
    await review.draft(4).save.click();
    await expect(review.notice(IMPORT_TEXTS.saved(4))).toBeVisible();
    await expect(review.draftIn('Ready to approve', 4).article).toBeVisible();
    await review.draft(4).heading.click();
    await page.keyboard.press('a');
    await expect(review.notice(IMPORT_TEXTS.approved(1))).toBeVisible();
    await expect(review.draftIn('Approved', 4).article).toBeVisible();
    // The next pending draft after 4 in display order (Ready to approve: 1, 4, 5) becomes current.
    await review.draft(5).expectCurrent();
    await expect(review.draft(5).article).toBeFocused();

    // Discard by key; with no pending draft after it, the previous pending one becomes current.
    await page.keyboard.press('d');
    await expect(review.notice(IMPORT_TEXTS.discarded(5))).toBeVisible();
    await expect(review.draftIn('Discarded', 5).article).toBeVisible();
    await review.draft(1).expectCurrent();

    // From here on, every approve or discard request is recorded.
    const actions = review.recordRequests('POST', /\/v1\/imports\/[^/]+\/(approve|discard)$/);

    // In a text field the keys type: `a`, `d` and `e` reach the field as key presses and act on nothing.
    await page.keyboard.press('e');
    await expect(review.draft(1).prompt).toBeFocused();
    await review.draft(1).prompt.clear();
    await review.draft(1).prompt.pressSequentially('a dead end');
    await expect(review.draft(1).prompt).toHaveValue('a dead end');
    // Escape leaves the edit without saving.
    await page.keyboard.press('Escape');
    await expect(review.draft(1).prompt).toHaveCount(0);
    await expect(review.draft(1).article).toBeFocused();
    await expect(review.draft(1).article).toContainText(q(1).prompt);

    // Outside the drafts the keys do nothing.
    await shell.h1.click();
    await page.keyboard.press('d');
    await page.keyboard.press('a');
    // Back in the list, `d` discards: its request is the first approve or discard request since recording began.
    await review.draft(1).heading.click();
    await review.draft(1).expectCurrent();
    const discarded = review.nextResponse('POST', /\/v1\/imports\/[^/]+\/discard$/);
    await page.keyboard.press('d');
    expect((await discarded).status()).toBe(200);
    await expect(review.notice(IMPORT_TEXTS.discarded(1))).toBeVisible();
    expect(actions, 'no request from keys typed in the field or pressed outside the drafts').toHaveLength(1);
    expect(actions[0]).toMatch(/\/discard$/);
    await expect(review.summaryItem('Discarded: 2')).toBeVisible();

    const stored = await storedDrafts(emulators, ORG_A.id, job.id);
    expect(stored.map((d) => d.data.status)).toEqual([
      'discarded',
      'pending',
      'pending',
      'approved',
      'discarded',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(stored[0]!.data.prompt).toBe(q(1).prompt);
  });

  test('REL-06 IMP-04 the page says when the import will try again, then finishes; a refused file says why', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    request,
  }) => {
    test.setTimeout(120_000);
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await testApi.llm.script({ pages: paper.pages, failures: { '2': 1 } });
    const admin = await apiAs(accounts.adminA);
    const id = await importFile(admin, request, testId, quantPaperPdf());
    await waitForJob(admin, testApi, id, ['retrying', 'ready', 'failed']);

    await signInAs(accounts.adminA);
    const review = new ImportReviewPage(page);
    await review.goto(id, PAPER);
    await expect(review.status).toHaveText('Waiting to retry');
    // 11:30 IST plus one minute.
    await expect(review.progressText(IMPORT_TEXTS.retryAt('11:31'))).toBeVisible();
    await expect(review.progressText(IMPORT_TEXTS.pagesProcessed(1, 3))).toBeVisible();
    await expect(review.failed).toHaveCount(0);

    await review.markDocument();
    await testApi.clock.advance(MIN);
    await waitForJob(admin, testApi, id, ['ready', 'failed']);
    await expect(review.summaryItem('Questions found: 9')).toBeVisible();
    await review.expectSameDocument();
    await expect(review.status).toHaveText('Ready for review');

    // Not retryable: a PDF over the page limit.
    const long = await importFile(admin, request, testId, {
      name: 'long-paper.pdf',
      contentType: PDF_TYPE,
      bytes: plainPdf(101),
    });
    await waitForJob(admin, testApi, long, ['failed', 'ready']);
    await review.goto(long, 'long-paper.pdf');
    await expect(review.failed).toHaveText(exactly(IMPORT_TEXTS.failed(IMPORT_TEXTS.tooManyPages('101'))));
    await expect(review.status).toHaveText('Failed');
    await expect(review.tryAgain).toHaveCount(0);
    await expect(review.summary).toHaveCount(0);
  });

  test('REL-06 a job that gave up after four tries offers Try again, which finishes it', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    test.setTimeout(120_000);
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await testApi.llm.script({ pages: paper.pages, failures: { '1': 4 } });
    const admin = await apiAs(accounts.adminA);
    const id = await importFile(admin, request, testId, quantPaperPdf());
    for (const delay of [MIN, 2 * MIN, 4 * MIN]) {
      const now = await testApi.clock.now();
      await waitForJobState(admin, testApi, id, (j) => j.retryAt === now + delay, `retry ${delay / MIN} min`);
      await testApi.clock.advance(delay);
    }
    await waitForJob(admin, testApi, id, ['failed', 'ready']);

    await signInAs(accounts.adminA);
    const review = new ImportReviewPage(page);
    await review.goto(id, PAPER);
    await expect(review.failed).toHaveText(exactly(IMPORT_TEXTS.failed(IMPORT_TEXTS.llmGaveUp)));
    await expect(review.status).toHaveText('Failed');
    await review.tryAgain.click();
    await expect(review.summaryItem('Questions found: 9')).toBeVisible({ timeout: 15_000 });
    await expect(review.failed).toHaveCount(0);
    expect(await auditFor(emulators, ORG_A.id, 'import.retry', id)).toHaveLength(1);
  });

  test('IMP-12 an import that finds no questions says so and offers another import', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    request,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await testApi.llm.script({ pages: {} });
    const admin = await apiAs(accounts.adminA);
    const job = await importReady(admin, request, testApi, testId, reasoningNotes('txt'));
    expect(job.drafts).toEqual([]);
    await signInAs(accounts.adminA);
    const review = new ImportReviewPage(page);
    await review.goto(job.id, 'reasoning-notes.txt');
    await expectEmptyState(page.getByRole('main'), IMPORT_TEXTS.empty.sentence, IMPORT_TEXTS.empty.action);
    await expect(review.articles).toHaveCount(0);
    await expect(review.approveAll).toHaveCount(0);
    await review.empty.getByRole('button', { name: IMPORT_TEXTS.empty.action, exact: true }).click();
    const dlg = new ImportDialog(page);
    await expect(dlg.dialog).toBeVisible();
    await expect(dlg.formats).toBeVisible();
  });

  test('IMP-12 HTML and script in imported text are shown as text on the review page and never run', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    request,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await testApi.llm.script({ pages: llmFixture('unsafe-markup').pages });
    const admin = await apiAs(accounts.adminA);
    const job = await importReady(admin, request, testApi, testId, reasoningNotes('txt'));
    expect(job.drafts).toHaveLength(1);
    expect(job.drafts[0]!.prompt, 'stored as the source has it').toContain('<script>');

    await signInAs(accounts.adminA);
    const review = new ImportReviewPage(page);
    const dialogs = review.recordDialogs();
    await review.goto(job.id, 'reasoning-notes.txt');
    const card = review.draft(1);
    await expect(card.article).toBeVisible();
    // The markup is visible as literal text, so the draft really rendered.
    await expect(card.article).toContainText('<script>');
    await expect(card.article).toContainText('onerror');
    await expect(card.optionItem(`A. <b onmouseover="alert('option')">bold</b>`)).toBeVisible();
    await expect(card.markupElements()).toHaveCount(0);
    await card.optionItem(`A. <b onmouseover="alert('option')">bold</b>`).hover();
    await card.edit.click();
    await expect(card.prompt).toHaveValue(job.drafts[0]!.prompt);
    await card.cancel.click();
    await expect(card.markupElements()).toHaveCount(0);
    expect(await review.windowFlag('__importXss'), 'no imported script ran').toBeUndefined();
    expect(dialogs, 'no dialog opened from imported markup').toEqual([]);
  });

  test('ORG-05 ORG-14 WEB-03 org B finds no import, a student is sent home, and a super admin reviews and approves in org A', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
    request,
    newSession,
  }) => {
    test.setTimeout(120_000);
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await testApi.llm.script({ pages: paper.pages });
    const admin = await apiAs(accounts.adminA);
    const job = await importReady(admin, request, testApi, testId, quantPaperPdf());

    const orgB = await newSession(accounts.adminB);
    await orgB.goto(ImportReviewPage.url(job.id));
    const notFound = new ImportNotFound(orgB);
    await expect(notFound.heading).toBeVisible();
    await expect(notFound.message(ORG_B.name)).toBeVisible();
    await expect(notFound.back).toHaveAttribute('href', '/admin/series/');
    await expect(new ImportReviewPage(orgB).heading(PAPER)).toHaveCount(0);
    await expect(new ImportReviewPage(orgB).articles).toHaveCount(0);

    const student = await newSession(accounts.studentA);
    await student.goto(ImportReviewPage.url(job.id));
    await expect(student).toHaveURL(pathPattern('/student/'));

    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_A.name);
    const review = new ImportReviewPage(page);
    await review.goto(job.id, PAPER);
    await expect(review.summaryItem('Questions found: 9')).toBeVisible();
    await review.draft(1).approve.click();
    await expect(review.notice(IMPORT_TEXTS.approved(1))).toBeVisible();
    const superUid = (await emulators.authAccount(accounts.superAdmin.email)).localId;
    const [entry] = await auditFor(emulators, ORG_A.id, 'question.import', testId);
    expect(entry?.data).toMatchObject({
      actor: { uid: superUid, role: 'superAdmin' },
      after: { count: 1, jobId: job.id },
    });
    expect(await storedPrompts(emulators, ORG_A.id, testId)).toHaveLength(5);
  });
});

/** IMP-11: the highlight covers the draft's box on the shown page, within 0.02 of each side. */
async function expectHighlight(
  review: ImportReviewPage,
  pageNo: number,
  box: { x: number; y: number; w: number; h: number },
): Promise<void> {
  await expect(review.highlight).toBeVisible();
  await expect
    .poll(
      async () => {
        const got = await review.highlightFraction(pageNo, PAPER);
        if (!got) return Number.POSITIVE_INFINITY;
        return Math.max(...(['x', 'y', 'w', 'h'] as const).map((k) => Math.abs(got[k] - box[k])));
      },
      { message: `highlight over the box on page ${pageNo}` },
    )
    .toBeLessThan(0.02);
}
