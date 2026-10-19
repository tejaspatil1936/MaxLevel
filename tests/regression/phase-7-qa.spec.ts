import { AUTHORING_NOW } from '../acceptance/fixtures/authoring';
import { reportReady, requestReport, setReportEntitlements, STATUS_WORDS } from '../acceptance/fixtures/reports';
import { accounts, ORG_A } from '../acceptance/fixtures/seed';
import { expect, test } from '../acceptance/fixtures/test';
import { ReportsPage } from '../acceptance/pages/reports-page';

// Bugs found by the phase 7 QA pass. Each test failed before its fix.

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(AUTHORING_NOW);
});

test('US-AD-15 EXP-06 the Generate dialog offers only the series the API accepts, never a draft one', async ({
  page,
  signInAs,
  apiAs,
  testApi,
}) => {
  await setReportEntitlements(await apiAs(accounts.superAdmin), ORG_A.id);
  await testApi.seedSeries({ orgId: ORG_A.id, title: 'AAA Draft series', status: 'draft' });
  await testApi.seedSeries({ orgId: ORG_A.id, title: 'AAB Archived series', status: 'archived' });
  await testApi.seedSeries({ orgId: ORG_A.id, title: 'AAC Active series', status: 'active' });
  await signInAs(accounts.adminA);
  const reports = new ReportsPage(page);
  await reports.goto();
  const dlg = await reports.openGenerate();
  await dlg.aSeries.check();
  // The active series appears once the list has loaded; only then is the draft one's absence meaningful.
  await expect(dlg.series.getByRole('option', { name: 'AAC Active series', exact: true })).toHaveCount(1);
  await expect(dlg.series.getByRole('option', { name: 'AAB Archived series', exact: true })).toHaveCount(1);
  await expect(dlg.series.getByRole('option', { name: 'AAA Draft series', exact: true })).toHaveCount(0);
});

test('US-AD-15 a long unbroken report title wraps, so the Status and Files columns stay on screen', async ({
  page,
  signInAs,
  apiAs,
  testApi,
}) => {
  await setReportEntitlements(await apiAs(accounts.superAdmin), ORG_A.id);
  const word = 'W'.repeat(120);
  const { testId } = await testApi.seedExamTest({ orgId: ORG_A.id, title: word });
  await testApi.seedGradedAttempts(ORG_A.id, testId, [{ studentId: `stu-${ORG_A.id}-01`, score: 1, timeSec: 600 }]);
  const admin = await apiAs(accounts.adminA);
  await reportReady(admin, testApi, await requestReport(admin, { scope: 'test', refId: testId }));
  await signInAs(accounts.adminA);
  const reports = new ReportsPage(page);
  await reports.goto();
  const row = reports.rows.filter({ hasText: word });
  const status = await reports.cell(row, 'Status');
  await expect(status).toHaveText(STATUS_WORDS.ready);
  const width = page.viewportSize()!.width;
  for (const [name, cell] of [
    ['Status', status],
    ['Download PDF', reports.download(row, 'PDF')],
  ] as const) {
    const box = (await cell.boundingBox())!;
    expect(box.x + box.width, `${name} ends inside the window`).toBeLessThanOrEqual(width);
  }
  const region = reports.table.locator('xpath=..');
  expect(await region.evaluate((el) => el.scrollWidth - el.clientWidth), 'the table does not scroll sideways').toBe(0);
});

test('A11Y-03 all four arrow keys move and check the choice in a horizontal radio group', async ({
  page,
  signInAs,
  apiAs,
}) => {
  await setReportEntitlements(await apiAs(accounts.superAdmin), ORG_A.id);
  await signInAs(accounts.adminA);
  const reports = new ReportsPage(page);
  await reports.goto();
  const dlg = await reports.openGenerate();
  await expect(dlg.kind).toHaveAttribute('aria-orientation', 'horizontal');
  await dlg.aTest.check();
  await dlg.aTest.focus();
  for (const [key, checked] of [
    ['ArrowDown', dlg.aSeries],
    ['ArrowUp', dlg.aTest],
    ['ArrowRight', dlg.aSeries],
    ['ArrowLeft', dlg.aTest],
  ] as const) {
    await page.keyboard.press(key);
    await expect(checked, key).toBeChecked();
    await expect(checked, key).toBeFocused();
  }
  await page.keyboard.press('End');
  await expect(dlg.aSeries, 'End moves to the last choice').toBeFocused();
  await page.keyboard.press('Home');
  await expect(dlg.aTest, 'Home moves to the first choice').toBeFocused();
});
