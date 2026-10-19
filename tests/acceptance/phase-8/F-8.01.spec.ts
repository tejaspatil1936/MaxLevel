import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { expectHeadingOrder, scrollsHorizontally, undersizedTargets } from '../fixtures/layout';
import { readRunbook, runbookSection } from '../fixtures/live';
import { cutOffApi } from '../fixtures/network';
import { accounts } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { AccessibilityPanel } from '../pages/accessibility-panel';
import {
  AccessibilityStatementPage,
  STATEMENT_PATH,
  STATEMENT_SECTIONS,
  type StatementSection,
} from '../pages/accessibility-statement';
import { pathPattern } from '../pages/paths';
import { StudentShell } from '../pages/shell';
import { SignInPage } from '../pages/sign-in-page';

// F-8.01 Public accessibility statement (A11Y-22, with the A11Y-18 real-time exception note). Contract:
// docs/testids/phase-8.md, "Feature F-8.01". Screen-reader passes (A11Y-12) are owner checks (docs/MANUAL_CHECKS.md).

/** Everything the statement must say, checked the same way wherever it is opened from. */
async function expectFullStatement(statement: AccessibilityStatementPage): Promise<void> {
  await statement.expectShown();
  await expect(statement.page).toHaveTitle(/^Accessibility statement/);
  await expect(statement.main).toHaveCount(1);

  // The four sections, each a region named by its level-2 heading, in this order.
  for (const name of STATEMENT_SECTIONS) {
    await expect(statement.section(name), `section ${name}`).toBeVisible();
    await expect(statement.sectionHeading(name), `heading of ${name}`).toBeVisible();
  }
  await expect
    .poll(
      async () =>
        (await statement.sectionHeadings.allInnerTexts())
          .map((t) => t.trim())
          .filter((t): t is StatementSection => (STATEMENT_SECTIONS as readonly string[]).includes(t)),
      { message: 'section order' },
    )
    .toEqual([...STATEMENT_SECTIONS]);

  // The standard.
  await expect(statement.standard).toContainText('WCAG 2.2 level AA');

  // Known gaps: a list naming the Proposed accommodations that are not built (A11Y-19, A11Y-20).
  await expect.poll(() => statement.gapItems.count(), { message: 'known gaps listed' }).toBeGreaterThanOrEqual(2);
  await expect(statement.gapWith('screen reader', 'magnifier', 'strike'), 'assistive-technology gap').not.toHaveCount(
    0,
  );
  await expect(statement.gapWith('camera'), 'camera-requirement gap').not.toHaveCount(0);

  // A11Y-18: the real-time exception and the extra-time alternatives.
  for (const words of [/WCAG/, /real-time/i, /extra time/i, /accommodation/i])
    await expect(statement.timedExams).toContainText(words);

  // A contact for help.
  await statement.expectContactLink();
  await expect(statement.contact).toContainText(/placement cell/i);
}

test.describe('F-8.01 accessibility statement', () => {
  test('A11Y-22 A11Y-18 a signed-out visitor opens the accessibility statement from the sign-in page and finds the standard, known gaps, the timed-exam exception and a contact', async ({
    page,
  }) => {
    const signIn = new SignInPage(page);
    await signIn.goto();
    await expect(signIn.statementLink).toBeVisible();
    await expect(signIn.statementLink).not.toHaveAttribute('target', '_blank');

    await signIn.statementLink.click();
    await expect(page).toHaveURL(pathPattern(STATEMENT_PATH));
    await expectFullStatement(new AccessibilityStatementPage(page));
  });

  test('A11Y-22 the statement still shows in full when the API cannot be reached', async ({ page }) => {
    await cutOffApi(page);
    const statement = new AccessibilityStatementPage(page);
    await statement.goto();
    await expectFullStatement(statement);
    // A reload with the API still down shows it again (nothing depends on a request that failed).
    await page.reload();
    await expectFullStatement(statement);
  });

  test('A11Y-22 a student reaches the statement from the accessibility settings, and admins and super admins open it without being sent to their home', async ({
    page,
    signInAs,
    newSession,
  }) => {
    await signInAs(accounts.studentA);
    const panel = new AccessibilityPanel(page);
    await panel.open(new StudentShell(page).accessibilityButton);
    await expect(panel.statementLink).toBeVisible();
    await panel.statementLink.click();
    await expect(page).toHaveURL(pathPattern(STATEMENT_PATH));
    await expectFullStatement(new AccessibilityStatementPage(page));

    for (const account of [accounts.adminA, accounts.superAdmin]) {
      const other = await newSession(account);
      const statement = new AccessibilityStatementPage(other);
      await other.goto(STATEMENT_PATH);
      await statement.expectShown();
      await expect(statement.contact, `${account.email} sees the contact`).toBeVisible();
      // Still on the statement once the page has settled (no client guard redirect, WEB-03 does not apply).
      await expect(statement.timedExams).toBeVisible();
      await expect(other).toHaveURL(pathPattern(STATEMENT_PATH));
    }
  });

  test('A11Y-15 A11Y-16 A11Y-21 the statement has one main landmark and heading outline, no serious axe issue, large targets and reflows at 320 px', async ({
    page,
  }) => {
    const statement = new AccessibilityStatementPage(page);
    await statement.goto();
    await expect(statement.contact).toBeVisible();
    await expect(statement.main).toHaveCount(1);
    await expectHeadingOrder(page);
    await expectNoSeriousA11yViolations(page);
    expect(await undersizedTargets(page), 'targets under 44 x 44 px').toEqual([]);

    await page.setViewportSize({ width: 320, height: 800 });
    await expect(statement.heading).toBeVisible();
    await expect(statement.contact).toBeVisible();
    expect(await scrollsHorizontally(page), 'horizontal page scroll at 320 px').toBe(false);
  });

  test('A11Y-18 the exam-day runbook points the on-duty team to the public statement', async () => {
    const text = await readRunbook();
    expect(text, 'docs/runbooks/exam-day.md exists').not.toBeNull();
    const timing = runbookSection(text!, 'Timing and accessibility');
    expect(timing, 'section ## Timing and accessibility').not.toBeNull();
    expect(timing!).toContain(STATEMENT_PATH);
    for (const words of [/real-time/i, /WCAG/, /extra time/i, /accommodation/i]) expect(timing!).toMatch(words);
  });
});
