import { test as base } from '@playwright/test';
import { homeFor, type RoleHome } from '../pages/role-home';
import { SignInPage } from '../pages/sign-in-page';
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
}

export const test = base.extend<Fixtures>({
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
});
