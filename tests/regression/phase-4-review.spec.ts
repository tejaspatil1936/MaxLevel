import type { Page } from '@playwright/test';
import { anyMutation, apiRequest, holdApiRequests, recordApiCalls } from '../acceptance/fixtures/network';
import { runLeaderboardTask, setFeature, studentFacts } from '../acceptance/fixtures/results';
import { accounts, ORG_A } from '../acceptance/fixtures/seed';
import { expect, test } from '../acceptance/fixtures/test';
import { SettingsPage } from '../acceptance/pages/admin-pages';
import { AdminSeriesResults, AdminTestResults, headerTexts } from '../acceptance/pages/results-pages';
import { Shell } from '../acceptance/pages/shell';
import { table } from '../acceptance/pages/ui';

// Bugs found while verifying phase 4. Each test failed before its fix.

const id = (n: number) => studentFacts(ORG_A, n).id;

/**
 * Opens `url` with the leaderboard request held, checks the page heading stays hidden while the page's own record has
 * loaded, then releases the board and checks its header row is there the moment the heading shows.
 */
async function headingWaitsForBoard(page: Page, url: string, own: RegExp, columns: string[]) {
  const held = await holdApiRequests(page, apiRequest('GET', /^\/v1\/leaderboards\//));
  const loaded = page.waitForResponse((r) => r.request().method() === 'GET' && own.test(new URL(r.url()).pathname));
  await page.goto(url);
  await held.waitUntilHeld();
  expect((await loaded).ok(), 'the page record loaded').toBe(true);
  const heading = page.getByRole('heading', { level: 1, name: /^Results for / });
  await expect(heading, 'no heading while the board is still loading').toBeHidden();
  held.release();
  await expect(heading).toBeVisible();
  expect(await headerTexts(table(page.getByRole('main'), 'Leaderboard')), 'board shown with the heading').toEqual(
    columns,
  );
}

test.describe('phase 4 review', () => {
  test('LB-05 the admin results pages show their heading and the Leaderboard table together', async ({
    page,
    signInAs,
    request,
    testApi,
  }) => {
    const t = await testApi.seedExamTest({
      orgId: ORG_A.id,
      overrides: { resultRelease: 'immediate', testLeaderboard: true },
    });
    await testApi.seedGradedAttempts(ORG_A.id, t.testId, [
      { studentId: id(1), score: 3, timeSec: 600 },
      { studentId: id(2), score: 2, timeSec: 600 },
    ]);
    await runLeaderboardTask(request, { orgId: ORG_A.id, testId: t.testId, seriesId: t.seriesId });
    await signInAs(accounts.adminA);

    await headingWaitsForBoard(page, AdminTestResults.url(t.testId), new RegExp(`^/v1/tests/${t.testId}/release$`), [
      'Rank',
      'Name',
      'Department',
      'Score',
      'Time taken',
    ]);
    await headingWaitsForBoard(page, AdminSeriesResults.url(t.seriesId), new RegExp(`^/v1/series/${t.seriesId}$`), [
      'Rank',
      'Name',
      'Department',
      'Total',
    ]);
  });

  test('FF-03 RES-01 EXP-01 with public leaderboards off the admin results pages show the plan notice and work', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, overrides: { resultRelease: 'manual' } });
    await setFeature(await apiAs(accounts.superAdmin), ORG_A.id, 'public_leaderboards', false);
    await signInAs(accounts.adminA);
    const calls = recordApiCalls(page);
    const boardCalls = () => calls().filter((c) => c.startsWith('GET /v1/leaderboards/')).length;

    const heading = page.getByRole('heading', { level: 1, name: /^Results for / });
    const notice = page.getByRole('main').getByText("Not included in your organization's plan", { exact: true });
    await page.goto(AdminTestResults.url(t.testId));
    const results = new AdminTestResults(page);
    await expect(heading).toBeVisible();
    await expect(results.leaderboardHeading).toBeVisible();
    await expect(notice).toBeVisible();
    await results.release.releaseAndConfirm();
    await expect(results.release.withdraw).toBeVisible();
    expect(boardCalls(), 'the test board is asked for once, not in a loop').toBeLessThanOrEqual(2);

    const before = boardCalls();
    await page.goto(AdminSeriesResults.url(t.seriesId));
    const series = new AdminSeriesResults(page);
    await expect(heading).toBeVisible();
    await expect(notice).toBeVisible();
    const started = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/exports'));
    await series.exports.csv.click();
    expect((await started).status(), 'the export starts').toBe(202);
    expect(boardCalls() - before, 'the series board is asked for once, not in a loop').toBeLessThanOrEqual(2);
  });

  test('STU-03 UX-07 ORG-12 a profile lock still in flight when the page reloads is saved, not lost', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_A.name);
    await shell.goToAdmin('Settings');
    const settings = new SettingsPage(page);
    const held = await holdApiRequests(page, anyMutation);

    await settings.profileLock.click();
    await held.waitUntilHeld();
    await expect(settings.profileLock).toBeChecked();
    // The reload replaces the page while the save has not reached the API yet (a slow network or a busy server).
    await page.reload({ waitUntil: 'commit' });
    held.release();

    await expect
      .poll(async () => (await emulators.doc(`organizations/${ORG_A.id}`))!.data.profileLocked ?? false, {
        message: 'the lock reached the API',
      })
      .toBe(true);
    await page.reload();
    await expect(settings.profileLock).toBeChecked();
    const entries = await emulators.audit(ORG_A.id, 'org.settings.update');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });
  });
});
