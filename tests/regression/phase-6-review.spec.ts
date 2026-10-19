import { AUTHORING_NOW } from '../acceptance/fixtures/authoring';
import { llmFixture, questionsJson, quantPaperPdf } from '../acceptance/fixtures/import-files';
import { IMPORT_TEXTS, importFile, importReady, waitForJob, waitForJobState } from '../acceptance/fixtures/imports';
import { apiRequest, holdApiRequests, recordApiCalls } from '../acceptance/fixtures/network';
import { accounts, ORG_A } from '../acceptance/fixtures/seed';
import { expect, test } from '../acceptance/fixtures/test';
import { ImportNotFound, ImportReviewPage, QuestionsTabImports } from '../acceptance/pages/import-pages';
import { TestEditorPage } from '../acceptance/pages/test-editor';
import { exactly } from '../acceptance/pages/ui';

// Bugs found by the phase 6 review. Each test failed before its fix.

const MIN = 60_000;

test.describe('phase 6 review', () => {
  test.beforeEach(async ({ testApi }) => {
    await testApi.clock.set(AUTHORING_NOW);
  });

  test('IMP-12 a double click on Approve all valid questions sends one approve and says it once', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    request,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    const admin = await apiAs(accounts.adminA);
    const job = await importReady(admin, request, testApi, testId, questionsJson());
    await signInAs(accounts.adminA);
    const review = new ImportReviewPage(page);
    await review.goto(job.id, job.filename);

    const calls = recordApiCalls(page);
    const approved = review.nextResponse('POST', /\/approve$/);
    await review.approveAll.dblclick();
    expect((await approved).status()).toBe(200);
    await expect(review.notice(IMPORT_TEXTS.approved(2))).toBeVisible();
    await expect(review.summaryItem('Approved: 2')).toBeVisible();
    expect(
      calls().filter((c) => c.endsWith('/approve')),
      'one approve was sent',
    ).toHaveLength(1);
    await expect(page.getByRole('alert'), 'no error was shown').toHaveCount(0);
  });

  test('REL-06 Try again moves focus to the import status, so it is not lost with the button', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    request,
  }) => {
    test.setTimeout(120_000);
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    const paper = llmFixture('quant-paper');
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
    await review.goto(id, 'quant-paper.pdf');
    await expect(review.failed).toHaveText(exactly(IMPORT_TEXTS.failed(IMPORT_TEXTS.llmGaveUp)));
    await review.tryAgain.focus();
    await page.keyboard.press('Enter');
    await expect(review.status, 'focus moves to the status').toBeFocused();
    await expect(review.summaryItem('Questions found: 9')).toBeVisible({ timeout: 15_000 });
    await expect(review.status, 'and stays there once the import is ready').toBeFocused();
  });

  test('IMP-04 an ID the API refuses shows Import not found and stops asking for it', async ({ page, signInAs }) => {
    await signInAs(accounts.adminA);
    const notFound = new ImportNotFound(page);
    await page.clock.install();
    for (const id of ['../../x', 'a'.repeat(300)]) {
      const calls = recordApiCalls(page);
      const asked = () => calls().filter((c) => c.startsWith('GET /v1/imports/')).length;
      await page.goto(ImportReviewPage.url(id));
      await expect(notFound.heading).toBeVisible();
      await expect(notFound.message(ORG_A.name)).toBeVisible();
      const before = asked();
      expect(before, 'the job was asked for').toBeGreaterThan(0);
      await page.clock.runFor(10_000);
      expect(asked(), 'no polling after the refusal').toBe(before);
    }
  });

  test('IMP-01 closing the dialog during the upload stops it, and the page stays where it is', async ({
    page,
    signInAs,
    testApi,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await signInAs(accounts.adminA);
    await page.goto(TestEditorPage.url(testId));
    const editor = new TestEditorPage(page);
    const imports = new QuestionsTabImports(page, await editor.openTab('Questions'));
    const dlg = await imports.openImport();
    const held = await holdApiRequests(page, apiRequest('PUT', /\/upload$/));
    const calls = recordApiCalls(page);
    await dlg.choose(questionsJson());
    await dlg.submit.click();
    await held.waitUntilHeld();
    const stopped = page.waitForEvent('requestfailed', {
      predicate: (r) => r.method() === 'PUT' && /\/upload$/.test(new URL(r.url()).pathname),
      timeout: 10_000,
    });
    await page.keyboard.press('Escape');
    await expect(dlg.dialog).toBeHidden();
    await stopped;
    held.release();
    expect(new URL(page.url()).pathname).toBe(new URL(TestEditorPage.url(testId), page.url()).pathname);
    expect(
      calls().filter((c) => c.endsWith('/start')),
      'the import was not started',
    ).toEqual([]);
  });
});
