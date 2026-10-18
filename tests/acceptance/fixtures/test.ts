import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { homeFor, type RoleHome } from '../pages/role-home';
import { SignInPage } from '../pages/sign-in-page';
import { signInToApi, type ApiClient } from './api';
import { Emulators } from './emulators';
import type { SeedAccount } from './seed';
import { TestApi } from './test-api';

export { expect } from '@playwright/test';

interface Fixtures {
  /** Test-only API: reset, scenario seeds, clock and task control (docs/TEST_ENV.md). */
  testApi: TestApi;
  /** Read-only views of the Auth and Firestore emulators, for checking stored state. */
  emulators: Emulators;
  /** Runs before every test: emulators cleared, clock on real time, `base` seed loaded (orgs A and B). */
  baseSeed: void;
  /**
   * Signs in a seeded account through the emulator credential helper and waits for that role's home screen.
   * Use the Google popup (SignInPage.signInWithGooglePopup) where the test is about sign-in itself (AUTH-01).
   */
  signInAs: (account: SeedAccount) => Promise<RoleHome>;
  /**
   * Starts an emulator-credential sign-in on / and returns without waiting for any landing page: for accounts that
   * land on the org chooser, the consent notice or profile completion, or that are refused.
   */
  startSignIn: (account: SeedAccount, page?: Page) => Promise<SignInPage>;
  /**
   * Opens a second, separate browser (its own context and storage), signs the account in there and waits for its
   * role home. Closed at the end of the test.
   */
  newSession: (account: SeedAccount) => Promise<Page>;
  /** A fresh browser context with nobody signed in. Closed at the end of the test. */
  newBrowser: () => Promise<Page>;
  /**
   * API client for the account with a real ID token (bootstrap done, claims refreshed). Pass `orgId` for a super
   * admin acting inside an organization (X-Org-Id). Sign the account in the browser first when a test uses both.
   */
  apiAs: (account: SeedAccount, opts?: { orgId?: string }) => Promise<ApiClient>;
}

export const test = base.extend<Fixtures>({
  // A missing element fails an action within 15 s instead of using up the whole test timeout.
  actionTimeout: 15_000,
  testApi: async ({ request }, provide) => {
    await provide(new TestApi(request));
  },
  emulators: async ({ request }, provide) => {
    await provide(new Emulators(request));
  },
  baseSeed: [
    async ({ testApi }, provide) => {
      await testApi.reset('base');
      await provide();
    },
    { auto: true },
  ],
  signInAs: async ({ page }, provide) => {
    await provide(async (account) => {
      if (!account.role) throw new Error(`${account.email} has no role; it cannot land on a home screen`);
      const signIn = new SignInPage(page);
      await signIn.goto();
      await signIn.signInWithEmulatorCredential(account.email, account.name);
      const home = homeFor(page, account.role);
      await home.expectShown();
      return home;
    });
  },
  startSignIn: async ({ page }, provide) => {
    await provide(async (account, onPage) => {
      const signIn = new SignInPage(onPage ?? page);
      await signIn.goto();
      await signIn.signInWithEmulatorCredential(account.email, account.name);
      return signIn;
    });
  },
  newBrowser: async ({ browser }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async () => {
      const context = await browser.newContext();
      contexts.push(context);
      return context.newPage();
    });
    for (const c of contexts) await c.close();
  },
  newSession: async ({ newBrowser }, provide) => {
    await provide(async (account) => {
      if (!account.role) throw new Error(`${account.email} has no role; it cannot land on a home screen`);
      const page = await newBrowser();
      const signIn = new SignInPage(page);
      await signIn.goto();
      await signIn.signInWithEmulatorCredential(account.email, account.name);
      await homeFor(page, account.role).expectShown();
      return page;
    });
  },
  apiAs: async ({ request, emulators }, provide) => {
    await provide((account, opts) => signInToApi(request, emulators, account, opts));
  },
});
