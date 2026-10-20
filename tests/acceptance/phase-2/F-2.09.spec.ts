import {
  auditFor,
  AUTHORING_NOW,
  questionsOf,
  SEEDED_SERIES,
  SEEDED_TEST,
  seriesByTitle,
  storedTest,
  testByTitle,
} from '../fixtures/authoring';
import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { accounts, ORG_A, ORG_B } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { AuditPage } from '../pages/admin-pages';
import { pathPattern } from '../pages/paths';
import { NotFoundPage, SeriesListPage, SeriesPage } from '../pages/series-pages';
import { Shell } from '../pages/shell';
import { TestEditorPage } from '../pages/test-editor';

// F-2.09 Super-admin authoring parity (ORG-10, US-SA-07): the same screens as an admin, inside any organization's
// workspace, with every action logged in that organization with the super admin as the actor (ORG-12). Contract:
// docs/testids/phase-2.md and docs/testids/phase-1.md, "Organization switcher".

const superActor = { email: accounts.superAdmin.email, role: 'superAdmin' };

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(AUTHORING_NOW);
});

test.describe('F-2.09 super-admin authoring parity', () => {
  test('ORG-10 US-SA-07 a super admin creates, edits and publishes a series and test in org A, logged with them as actor', async ({
    page,
    signInAs,
    newSession,
    emulators,
  }) => {
    test.setTimeout(150_000);
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_A.name);
    const list = new SeriesListPage(page);
    await list.openFromSidebar();

    const form = await list.startNew();
    await form.fillDetails({
      title: 'Campus drive 2026',
      startDate: '2026-11-01',
      endDate: '2026-11-15',
      dailyStart: '10:00',
      dailyEnd: '11:00',
    });
    let series = await form.submitAndOpen('Campus drive 2026');
    const edit = await series.openEdit();
    await edit.fillDetails({ title: 'Campus drive 2026 (MIT)' });
    series = await edit.submitAndOpen('Campus drive 2026 (MIT)');
    await series.add({ title: 'Logical reasoning', company: 'Wipro', scheduledDate: '2026-11-05' });
    await series.testLink('Logical reasoning').click();
    const editor = new TestEditorPage(page);
    await editor.expectShown('Day 1: Logical reasoning');
    const questions = await editor.questions();
    const q = await questions.openAdd();
    await q.fill({
      prompt: 'All roses are flowers. Some flowers fade quickly. Which statement must be true?',
      options: ['All roses fade quickly', 'Some roses are flowers', 'No rose fades', 'All flowers are roses'],
      correct: 'B',
    });
    await q.saveAndClose();
    const preview = await editor.preview();
    await preview.approveAndConfirm();
    await editor.publishTest();

    await expect(editor.status).toHaveText('Scheduled');
    await expect(shell.workspaceNotice(ORG_A.name)).toBeVisible();
    const storedSeries = await seriesByTitle(emulators, ORG_A.id, 'Campus drive 2026 (MIT)');
    const storedTestDoc = await testByTitle(emulators, ORG_A.id, 'Logical reasoning');
    expect(storedTestDoc.data).toMatchObject({ seriesId: storedSeries.id, status: 'scheduled', company: 'Wipro' });
    const [question] = await questionsOf(emulators, ORG_A.id, storedTestDoc.id);
    for (const [action, target] of [
      ['series.create', storedSeries.id],
      ['series.update', storedSeries.id],
      ['test.create', storedTestDoc.id],
      ['question.create', question!.id],
      ['test.approve', storedTestDoc.id],
      ['test.publish', storedTestDoc.id],
    ] as const) {
      const entries = await auditFor(emulators, ORG_A.id, action, target);
      expect(entries, `${action} in org A`).toHaveLength(1);
      expect(entries[0]!.data.actor, `${action} actor`).toMatchObject(superActor);
    }
    expect(await auditFor(emulators, ORG_B.id, 'series.create'), 'nothing logged in org B').toHaveLength(0);

    const adminPage = await newSession(accounts.adminA);
    const adminList = new SeriesListPage(adminPage);
    await adminList.goto();
    await expect(await adminList.cell('Campus drive 2026 (MIT)', 'Tests')).toHaveText('1');
  });

  test('ORG-10 US-SA-07 in org B a super admin overrides a setting, approves and publishes, and the audit log names them', async ({
    page,
    signInAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(120_000);
    const b = await testApi.seedAuthoringTest({ orgId: ORG_B.id });
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_B.name);
    const series = new SeriesPage(page);
    await series.goto(b.seriesId, SEEDED_SERIES.title);
    await series.testLink(SEEDED_TEST.title).click();
    const editor = new TestEditorPage(page);
    await editor.expectShown(SEEDED_TEST.heading);

    const settings = await editor.settings();
    const strikes = settings.setting('Maximum strikes');
    await strikes.override();
    await strikes.controls.spin('Maximum strikes').fill('6');
    await settings.saveAndConfirm();
    const preview = await editor.preview();
    await preview.approveAndConfirm();
    await editor.publishTest();

    await expect(editor.status).toHaveText('Scheduled');
    const stored = await storedTest(emulators, ORG_B.id, b.testId);
    expect(stored).toMatchObject({ status: 'scheduled', overrides: { maxStrikes: 6 }, resolved: { maxStrikes: 6 } });
    for (const action of ['test.settings.update', 'test.approve', 'test.publish']) {
      const [entry] = await auditFor(emulators, ORG_B.id, action, b.testId);
      expect(entry?.data.actor, `${action} actor`).toMatchObject(superActor);
    }
    expect(await auditFor(emulators, ORG_A.id, 'test.publish'), 'nothing logged in org A').toHaveLength(0);

    const audit = new AuditPage(page);
    await audit.goto();
    await audit.filter({ action: 'test.publish' });
    await expect(audit.rows).toHaveCount(1);
    await expect(audit.rowWith(accounts.superAdmin.email)).toHaveCount(1);
    await expect(shell.workspaceNotice(ORG_B.name)).toBeVisible();
  });

  test('ORG-05 ORG-10 an ID from another organization opens a not-found page, for a super admin in a workspace and for an admin', async ({
    page,
    signInAs,
    testApi,
    newSession,
  }) => {
    const a = await testApi.seedAuthoringTest({ orgId: ORG_A.id, title: 'Secret aptitude' });
    const b = await testApi.seedSeries({ orgId: ORG_B.id, title: 'COEP only series' });
    await signInAs(accounts.superAdmin);
    const shell = new Shell(page);
    await shell.enterOrg(ORG_B.name);

    await page.goto(TestEditorPage.url(a.testId));

    const notFound = new NotFoundPage(page);
    await expect(notFound.heading('test')).toBeVisible();
    await expect(notFound.message('test', ORG_B.name)).toBeVisible();
    await expect(notFound.shell.main).not.toContainText('Secret aptitude');
    await expectNoSeriousA11yViolations(page);
    await notFound.back.click();
    await expect(page).toHaveURL(pathPattern('/admin/series/'));

    const adminPage = await newSession(accounts.adminA);
    await adminPage.goto(SeriesPage.url(b.seriesId));
    const adminNotFound = new NotFoundPage(adminPage);
    await expect(adminNotFound.heading('series')).toBeVisible();
    await expect(adminNotFound.message('series', ORG_A.name)).toBeVisible();
    await expect(adminNotFound.shell.main).not.toContainText('COEP only series');
  });
});
