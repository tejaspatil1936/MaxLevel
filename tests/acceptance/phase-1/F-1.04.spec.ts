import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { box } from '../fixtures/layout';
import { accounts, ORG_A, ORG_B } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { pathPattern } from '../pages/paths';
import { adminHome, platformHome } from '../pages/role-home';
import { ADMIN_LINKS, ARCHIVED_WORKSPACE_NOTICE, Shell } from '../pages/shell';

// F-1.04 Organization switcher and workspace banner (ORG-09, ORG-12). Contract: docs/testids/phase-1.md,
// "Organization switcher". That actions in the workspace are logged with the super admin as the actor (ORG-12) is
// shown on each admin screen's own feature file (departments, whitelist, students, settings, audit log).

test.describe('F-1.04 organization switcher and workspace banner', () => {
  test('ORG-09 ORG-12 a super admin enters org A from the sidebar switcher and gets the admin workspace with a banner naming the org', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    const [switcher, nav] = [await box(shell.switcher), await box(shell.nav)];
    expect(switcher.y + switcher.height, 'switcher above the Main navigation').toBeLessThanOrEqual(nav.y + 1);
    await expect(shell.switcherInsideNav, 'switcher outside the Main navigation').toHaveCount(0);
    await shell.switcher.click();
    for (const choice of ['Platform', ORG_A.name, ORG_B.name]) await expect(shell.switchChoice(choice)).toBeVisible();
    await shell.switchChoice(ORG_A.name).click();

    await adminHome(page).expectShown();
    await expect(shell.workspaceNotice(ORG_A.name)).toBeVisible();
    await expect(shell.banner).toContainText(ORG_A.name);
    await expect(shell.workspaceNotice(ORG_B.name)).toHaveCount(0);
    for (const [name, path] of Object.entries(ADMIN_LINKS))
      await expect(shell.navLink(name), `admin screen ${name}`).toHaveAttribute('href', new RegExp(`${path}$`));
    await expect(shell.navLink('Organizations')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    await page.reload();

    await adminHome(page).expectShown();
    await expect(shell.workspaceNotice(ORG_A.name)).toBeVisible();
  });

  test('ORG-09 ORG-12 switching to org B moves the banner to org B, and Platform returns to the console', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_A.name);

    await shell.switchTo(ORG_B.name);

    await expect(page).toHaveURL(pathPattern('/admin/'));
    await expect(shell.workspaceNotice(ORG_B.name)).toBeVisible();
    await expect(shell.workspaceNotice(ORG_A.name)).toHaveCount(0);
    await expect(shell.banner).not.toContainText(ORG_A.name);

    await shell.switchTo('Platform');

    await platformHome(page).expectShown();
    await expect(shell.anyWorkspaceNotice).toHaveCount(0);
  });

  test('ORG-07 ORG-12 the workspace of an archived organization says it is read-only', async ({
    page,
    signInAs,
    apiAs,
  }) => {
    const superApi = await apiAs(accounts.superAdmin);
    expect((await superApi.patch(`/v1/platform/orgs/${ORG_B.id}`, { status: 'archived' })).status).toBe(200);
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);

    await shell.enterOrg(ORG_B.name);

    await expect(shell.archivedNotice).toHaveText(ARCHIVED_WORKSPACE_NOTICE);
    await shell.switchTo(ORG_A.name);
    await expect(shell.workspaceNotice(ORG_A.name)).toBeVisible();
    await expect(shell.archivedNotice).toHaveCount(0);
  });

  test('ORG-09 a super admin who opens /admin/ without choosing an organization lands on the platform console', async ({
    page,
    signInAs,
  }) => {
    await signInAs(accounts.superAdmin);

    await page.goto('/admin/');

    await platformHome(page).expectShown();
    const shell = new Shell(page);
    await expect(shell.anyWorkspaceNotice).toHaveCount(0);
    await expect(shell.switcher, 'the switcher offers the way in').toBeVisible();
  });

  test('ORG-09 ORG-12 admins have no organization switcher and no workspace banner, unlike super admins', async ({
    page,
    signInAs,
    newSession,
  }) => {
    const superShell = new Shell(await newSession(accounts.superAdmin));
    await expect(superShell.switcher).toBeVisible();
    const home = await signInAs(accounts.adminA);
    const shell = new Shell(page);

    await expect(home.banner).toContainText(ORG_A.name);
    await expect(shell.navLink('Overview')).toBeVisible();
    await expect(shell.switcher).toHaveCount(0);
    await expect(shell.anyWorkspaceNotice).toHaveCount(0);
  });
});
