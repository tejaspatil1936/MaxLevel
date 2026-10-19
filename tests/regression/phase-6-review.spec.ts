import { AUTHORING_NOW } from '../acceptance/fixtures/authoring';
import { questionsJson } from '../acceptance/fixtures/import-files';
import { IMPORT_TEXTS, importReady } from '../acceptance/fixtures/imports';
import { recordApiCalls } from '../acceptance/fixtures/network';
import { accounts, ORG_A } from '../acceptance/fixtures/seed';
import { expect, test } from '../acceptance/fixtures/test';
import { ImportReviewPage } from '../acceptance/pages/import-pages';

// Bugs found by the phase 6 review. Each test failed before its fix.

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
});
