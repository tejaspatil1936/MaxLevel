import { accounts, ORG_A } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { SettingsPage } from '../pages/admin-pages';
import { FEATURE_LABELS, LIMIT_LABELS, ORG_ERRORS, OrgDetailPage, type UsageMeasure } from '../pages/platform';
import { adminHome } from '../pages/role-home';
import { NOT_INCLUDED } from '../pages/shell';
import { cellIn, count, expectFieldError } from '../pages/ui';

// F-1.03 Entitlements, locked features and usage (FF-03, US-SA-03, US-SA-04; FF-05 and ORG-13 are proved by
// integration tests). Contract: docs/testids/phase-1.md, "Organization detail" and "Settings".

async function usage(detail: OrgDetailPage, measure: UsageMeasure, column: 'Used' | 'Limit') {
  return cellIn(detail.usage, detail.usageRow(measure), column);
}

test.describe('F-1.03 entitlements, locked features and usage', () => {
  test("US-SA-03 FF-03 a super admin turns a feature off, the org's admins see it locked, and the change is audit-logged", async ({
    page,
    signInAs,
    newSession,
    emulators,
  }) => {
    const adminPage = await newSession(accounts.adminA);
    const settings = new SettingsPage(adminPage);
    await settings.goto();
    await expect(settings.section('Plan and features')).toBeVisible();
    await expect(settings.feature(FEATURE_LABELS.results_export)).toContainText('Included');
    await signInAs(accounts.superAdmin);
    const detail = new OrgDetailPage(page);
    await detail.goto(ORG_A.id, ORG_A.name);
    await expect(detail.feature(FEATURE_LABELS.results_export)).toBeChecked();

    await detail.feature(FEATURE_LABELS.results_export).click();
    await detail.saveEntitlements.click();

    await expect(detail.entitlementsSaved).toBeVisible();
    await expect(detail.feature(FEATURE_LABELS.results_export)).not.toBeChecked();
    const org = await emulators.doc(`organizations/${ORG_A.id}`);
    expect(org!.data.featureOverrides).toMatchObject({ results_export: false });
    const entries = await emulators.audit(ORG_A.id, 'org.entitlements.update');
    expect(entries, 'org.entitlements.update audit entry').toHaveLength(1);
    expect(entries[0]!.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });
    expect(JSON.stringify(entries[0]!.data.after)).toContain('"results_export":false');
    expect(JSON.stringify(entries[0]!.data.before ?? {})).not.toContain('"results_export":false');

    await settings.goto();
    await expect(settings.feature(FEATURE_LABELS.results_export)).toContainText(NOT_INCLUDED);
    await expect(settings.feature(FEATURE_LABELS.question_pools)).toContainText('Included');
  });

  test('FF-03 US-SA-03 a premium feature that is off shows locked, not missing, until the super admin enables it', async ({
    page,
    signInAs,
    newSession,
    emulators,
  }) => {
    const adminPage = await newSession(accounts.adminA);
    const settings = new SettingsPage(adminPage);
    await settings.goto();
    await expect(settings.feature(FEATURE_LABELS.analytics_reports)).toContainText(NOT_INCLUDED);

    await signInAs(accounts.superAdmin);
    const detail = new OrgDetailPage(page);
    await detail.goto(ORG_A.id, ORG_A.name);
    await expect(detail.feature(FEATURE_LABELS.analytics_reports)).not.toBeChecked();
    await detail.feature(FEATURE_LABELS.analytics_reports).click();
    await detail.saveEntitlements.click();
    await expect(detail.entitlementsSaved).toBeVisible();

    expect((await emulators.doc(`organizations/${ORG_A.id}`))!.data.featureOverrides).toMatchObject({
      analytics_reports: true,
    });
    await settings.goto();
    await expect(settings.feature(FEATURE_LABELS.analytics_reports)).toContainText('Included');
    await expect(settings.feature(FEATURE_LABELS.analytics_reports)).not.toContainText(NOT_INCLUDED);
  });

  test('US-SA-04 the organization detail shows usage against limits, and a new limit shows at once', async ({
    page,
    signInAs,
    emulators,
  }) => {
    const whitelisted = await emulators.count(`organizations/${ORG_A.id}`, 'whitelist');
    const admins = (await emulators.list(`organizations/${ORG_A.id}`, 'admins')).filter(
      (a) => a.data.status === 'active',
    ).length;
    await signInAs(accounts.superAdmin);
    const detail = new OrgDetailPage(page);
    await detail.goto(ORG_A.id, ORG_A.name);
    await expect(detail.section('Usage')).toBeVisible();

    await expect(await usage(detail, 'Students', 'Used')).toHaveText(count(whitelisted));
    await expect(await usage(detail, 'Students', 'Limit')).toHaveText('2,000');
    await expect(await usage(detail, 'Admins', 'Used')).toHaveText(count(admins));
    await expect(await usage(detail, 'Admins', 'Limit')).toHaveText('10');
    await expect(await usage(detail, 'Tests run this month', 'Used')).toHaveText('0');
    await expect(await usage(detail, 'AI imports this month', 'Used')).toHaveText('0');
    await expect(await usage(detail, 'AI imports this month', 'Limit')).toHaveText('50');
    await expect(await usage(detail, 'Analytics reports this month', 'Used')).toHaveText('0');
    await expect(await usage(detail, 'Analytics reports this month', 'Limit')).toHaveText('20');
    await expect(await usage(detail, 'Storage', 'Limit')).toHaveText('10 GB');

    await detail.limit(LIMIT_LABELS.max_students).fill('1500');
    await detail.saveEntitlements.click();

    await expect(detail.entitlementsSaved).toBeVisible();
    await expect(await usage(detail, 'Students', 'Limit')).toHaveText('1,500');
    expect((await emulators.doc(`organizations/${ORG_A.id}`))!.data.limitOverrides).toMatchObject({
      max_students: 1500,
    });
  });

  test('US-SA-03 UX-09 A11Y-11 a limit below zero is refused next to the field and nothing is saved', async ({
    page,
    signInAs,
    emulators,
  }) => {
    await signInAs(accounts.superAdmin);
    const detail = new OrgDetailPage(page);
    await detail.goto(ORG_A.id, ORG_A.name);
    const maxStudents = detail.limit(LIMIT_LABELS.max_students);
    await expect(maxStudents).toBeVisible();

    await maxStudents.fill('-1');
    await detail.saveEntitlements.click();

    await expectFieldError(page, maxStudents, ORG_ERRORS.badLimit);
    await expect(detail.entitlementsSaved).toHaveCount(0);
    const org = await emulators.doc(`organizations/${ORG_A.id}`);
    expect((org!.data.limitOverrides as Record<string, unknown> | undefined)?.max_students).toBeUndefined();
    expect(await emulators.audit(ORG_A.id, 'org.entitlements.update')).toHaveLength(0);
  });

  test('US-SA-03 an admin cannot change entitlements or open the organization detail', async ({
    page,
    signInAs,
    apiAs,
    emulators,
  }) => {
    await signInAs(accounts.adminA);
    const api = await apiAs(accounts.adminA);

    const res = await api.put(`/v1/platform/orgs/${ORG_A.id}/entitlements`, {
      featureOverrides: { analytics_reports: true },
      limitOverrides: {},
    });

    expect(res.status).toBe(403);
    const org = await emulators.doc(`organizations/${ORG_A.id}`);
    expect((org!.data.featureOverrides as Record<string, unknown> | undefined)?.analytics_reports).toBeUndefined();
    await page.goto(`/platform/org/?id=${ORG_A.id}`);
    await adminHome(page).expectShown();
    await expect(new OrgDetailPage(page).saveEntitlements).toHaveCount(0);
  });
});
