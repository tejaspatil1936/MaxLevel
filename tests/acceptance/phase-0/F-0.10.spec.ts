import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { expectBootstrapped, expectNoRole } from '../fixtures/identity';
import { accounts, ORG_A, ORG_B, type SeedAccount } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { adminHome, platformHome, studentHome, type RoleHome } from '../pages/role-home';
import { SignInPage, UNLISTED_MESSAGE } from '../pages/sign-in-page';
import type { Page } from '@playwright/test';

// F-0.10 Google sign-in and role landing (AUTH-01, AUTH-03, US-ST-01, WEB-03). Contract: docs/testids/phase-0.md.

/** Error codes, HTTP statuses or Firebase error text that must never reach the person signing in (US-ST-01). */
const TECHNICAL_TEXT =
  /FirebaseError|auth\/[a-z-]+|\b(?:400|401|403|404|409|500)\b|\b[A-Z]+_[A-Z_]+\b|\bundefined\b|\bnull\b/;

const HOMES: ReadonlyArray<readonly [string, (page: Page) => RoleHome]> = [
  ['/student/', studentHome],
  ['/admin/', adminHome],
  ['/platform/', platformHome],
];

test.describe('F-0.10 Google sign-in and role landing', () => {
  test('AUTH-01 US-ST-01 a whitelisted student signs in through the Google popup and lands on the student home', async ({
    page,
    emulators,
  }) => {
    const signIn = new SignInPage(page);
    await signIn.goto();
    await signIn.signInWithGooglePopup(accounts.studentA.email, accounts.studentA.name);

    await studentHome(page).expectShown();
    await expect(signIn.unlistedAlert).toHaveCount(0);
    await expectBootstrapped(emulators, accounts.studentA);
    await expectNoSeriousA11yViolations(page);
  });

  test('AUTH-01 a super admin signs in through the Google popup and lands on the platform console', async ({
    page,
    emulators,
  }) => {
    const signIn = new SignInPage(page);
    await signIn.goto();
    await signIn.signInWithGooglePopup(accounts.superAdmin.email, accounts.superAdmin.name);

    await platformHome(page).expectShown();
    await expect(signIn.unlistedAlert).toHaveCount(0);
    await expectBootstrapped(emulators, accounts.superAdmin);
    await expectNoSeriousA11yViolations(page);
  });

  const adminLandings: Array<{ title: string; account: SeedAccount; org: string; otherOrg: string }> = [
    {
      title: 'AUTH-01 an admin of org A signs in and lands on the admin overview of org A',
      account: accounts.adminA,
      org: ORG_A.name,
      otherOrg: ORG_B.name,
    },
    {
      title: 'AUTH-01 an admin of org B signs in and lands on the admin overview of org B',
      account: accounts.adminB,
      org: ORG_B.name,
      otherOrg: ORG_A.name,
    },
  ];
  for (const { title, account, org, otherOrg } of adminLandings) {
    test(title, async ({ page, emulators, signInAs }) => {
      const home = await signInAs(account);

      await expect(home.banner).toContainText(org);
      await expect(home.banner).not.toContainText(otherOrg);
      await expect(new SignInPage(page).unlistedAlert).toHaveCount(0);
      await expectBootstrapped(emulators, account);
      await expectNoSeriousA11yViolations(page);
    });
  }

  test('AUTH-01 US-ST-01 a whitelisted student of org B signs in and lands on the student home', async ({
    page,
    emulators,
    signInAs,
  }) => {
    const home = await signInAs(accounts.studentB);

    await expect(home.heading).toBeVisible();
    await expect(new SignInPage(page).unlistedAlert).toHaveCount(0);
    await expectBootstrapped(emulators, accounts.studentB);
    await expectNoSeriousA11yViolations(page);
  });

  test('AUTH-01 the sign-in page offers Google sign-in to a signed-out visitor', async ({ page }) => {
    const signIn = new SignInPage(page);
    await signIn.goto();

    await expect(signIn.googleButton).toBeEnabled();
    await expect(signIn.unlistedAlert).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test('AUTH-03 US-ST-01 an unlisted Google account sees the contact message and stays on the sign-in page', async ({
    page,
    emulators,
  }) => {
    const signIn = new SignInPage(page);
    await signIn.goto();
    await signIn.signInWithGooglePopup(accounts.unlisted.email, accounts.unlisted.name);

    await expect(signIn.unlistedAlert).toBeVisible();
    await expect(signIn.unlistedAlert).toHaveText(UNLISTED_MESSAGE);
    await signIn.expectShown();
    await expect(signIn.everything).not.toContainText(TECHNICAL_TEXT, { useInnerText: true });
    await expect(studentHome(page).heading).toHaveCount(0);
    await expectNoRole(emulators, accounts.unlisted.email);
    await expectNoSeriousA11yViolations(page);
  });

  for (const [path, home] of HOMES) {
    test(`AUTH-03 WEB-03 an unlisted account that opens ${path} is sent back to sign-in`, async ({
      page,
      emulators,
    }) => {
      const signIn = new SignInPage(page);
      await signIn.goto();
      await signIn.signInWithEmulatorCredential(accounts.unlisted.email, accounts.unlisted.name);
      await expect(signIn.unlistedAlert).toHaveText(UNLISTED_MESSAGE);
      const target = home(page);

      await target.goto();

      await signIn.expectShown();
      await expect(target.heading).toHaveCount(0);
      await expectNoRole(emulators, accounts.unlisted.email);
    });
  }

  const wrongRole: Array<{ who: string; account: SeedAccount; path: string; opens: (page: Page) => RoleHome }> = [
    { who: 'student', account: accounts.studentA, path: '/admin/', opens: adminHome },
    { who: 'student', account: accounts.studentA, path: '/platform/', opens: platformHome },
    { who: 'admin', account: accounts.adminA, path: '/platform/', opens: platformHome },
    { who: 'admin', account: accounts.adminA, path: '/student/', opens: studentHome },
    { who: 'super admin', account: accounts.superAdmin, path: '/student/', opens: studentHome },
  ];
  for (const { who, account, path, opens } of wrongRole) {
    test(`WEB-03 a signed-in ${who} who opens ${path} is sent back to their own home`, async ({ page, signInAs }) => {
      const own = await signInAs(account);
      const target = opens(page);
      expect(target.path).toBe(path);

      await target.goto();

      await own.expectShown();
      await expect(target.heading).toHaveCount(0);
    });
  }

  for (const [path, home] of HOMES) {
    test(`WEB-03 a signed-out visitor who opens ${path} is sent to the sign-in page`, async ({ page }) => {
      const target = home(page);

      await target.goto();

      await new SignInPage(page).expectShown();
      await expect(target.heading).toHaveCount(0);
    });
  }
});
