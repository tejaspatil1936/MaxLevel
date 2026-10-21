import { accounts } from '../acceptance/fixtures/seed';
import { expect, test } from '../acceptance/fixtures/test';
import { adminHome, platformHome, studentHome } from '../acceptance/pages/role-home';
import { SignInPage } from '../acceptance/pages/sign-in-page';

// Bugs found by the phase 0 QA pass (PROGRESS.md). Each test failed before its fix.

test('AUTH-01 US-ST-01 signing in again with the same account after a failed attempt finishes sign-in', async ({
  page,
}) => {
  const signIn = new SignInPage(page);
  await signIn.goto();
  // The API is unreachable for the first attempt, as on a flaky campus connection.
  await page.route('http://localhost:4000/**', (r) => r.abort());
  await signIn.signInWithEmulatorCredential(accounts.studentA.email, accounts.studentA.name);
  await expect(page.getByRole('alert').filter({ hasText: 'Sign-in did not finish' })).toBeVisible();

  await page.unroute('http://localhost:4000/**');
  await signIn.signInWithEmulatorCredential(accounts.studentA.email, accounts.studentA.name);
  await studentHome(page).expectShown();
});

test('A11Y-07 every page has its own document title', async ({ page, signInAs }) => {
  await new SignInPage(page).goto();
  await expect(page).toHaveTitle('Sign in – MaxLevel');
  await signInAs(accounts.studentA);
  await expect(page).toHaveTitle('Your tests – MaxLevel');
});

test('A11Y-07 admin and platform homes are titled too', async ({ page, signInAs, browser }) => {
  await signInAs(accounts.adminA);
  await expect(adminHome(page).heading).toBeVisible();
  await expect(page).toHaveTitle('Overview – MaxLevel');
  const other = await browser.newPage();
  const sa = new SignInPage(other);
  await sa.goto();
  await sa.signInWithEmulatorCredential(accounts.superAdmin.email, accounts.superAdmin.name);
  await platformHome(other).expectShown();
  await expect(other).toHaveTitle('Organizations – MaxLevel');
  await other.close();
});
