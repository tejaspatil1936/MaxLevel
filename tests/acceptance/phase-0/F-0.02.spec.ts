import { maxDurationMs, nonInstantMotion } from '../fixtures/motion';
import { accounts } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { SignInPage } from '../pages/sign-in-page';

// F-0.02 Core components: reduced motion (UI-12). The other F-0.02 REQs are unit, static or manual checks.
// Contract: docs/testids/phase-0.md, "Reduced motion". The motion preference may be read once before first paint, so
// every measurement follows a load made with the emulated preference already in place.

test.describe('F-0.02 reduced motion', () => {
  test('UI-12 with reduced motion emulated every transition on the sign-in page computes to 0s', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const signIn = new SignInPage(page);
    await signIn.goto();

    expect(maxDurationMs(await signIn.googleButtonTransitionDuration())).toBe(0);
    expect(await nonInstantMotion(page)).toEqual([]);
  });

  test('UI-12 the sign-in button transition is instant only while reduced motion is on', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const signIn = new SignInPage(page);
    await signIn.goto();
    expect(maxDurationMs(await signIn.googleButtonTransitionDuration())).toBeGreaterThan(0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn.goto();

    expect(maxDurationMs(await signIn.googleButtonTransitionDuration())).toBe(0);
    expect(await nonInstantMotion(page)).toEqual([]);
  });

  for (const account of [accounts.studentA, accounts.adminA, accounts.superAdmin]) {
    test(`UI-12 with reduced motion emulated every transition on the ${account.role} home computes to 0s`, async ({
      page,
      signInAs,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const home = await signInAs(account);

      await home.goto();
      await home.expectShown();

      expect(await nonInstantMotion(page)).toEqual([]);
    });
  }
});
