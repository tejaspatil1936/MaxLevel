import { AUTHORING_NOW } from '../acceptance/fixtures/authoring';
import { setReportEntitlements } from '../acceptance/fixtures/reports';
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
