import { expect, type Locator, type Page } from '@playwright/test';
import { GoogleEmulatorPopup } from './google-emulator-popup';
import { pathPattern } from './paths';

/** AUTH-03: the exact message for a Google account on no organization's list. */
export const UNLISTED_MESSAGE =
  "This Google account isn't on any organization's list. Ask your placement cell to add it.";

type E2eWindow = Window & { __e2e?: { signIn(email: string, name?: string): Promise<unknown> } };

/** The sign-in page at / (docs/testids/phase-0.md). */
export class SignInPage {
  static readonly path = '/';
  readonly main: Locator;
  readonly heading: Locator;
  readonly googleButton: Locator;
  readonly unlistedAlert: Locator;
  /** Phase 8 (A11Y-22): the link to the public accessibility statement. */
  readonly statementLink: Locator;
  /** Everything the page shows, for checks that no technical error text leaks (US-ST-01). */
  readonly everything: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1, name: 'Sign in', exact: true });
    this.googleButton = page.getByRole('button', { name: 'Sign in with Google', exact: true });
    this.unlistedAlert = page.getByRole('alert').filter({ hasText: UNLISTED_MESSAGE });
    this.statementLink = page.getByRole('link', { name: 'Accessibility statement', exact: true });
    this.everything = page.locator('body');
  }

  async goto(): Promise<void> {
    await this.page.goto(SignInPage.path);
    await this.expectShown();
  }

  /** The sign-in page is on screen, at /, with its heading and the Google button. */
  async expectShown(): Promise<void> {
    await expect(this.page).toHaveURL(pathPattern(SignInPage.path));
    await expect(this.heading).toBeVisible();
    await expect(this.googleButton).toBeVisible();
  }

  /** AUTH-01: the real flow, through the Google button and the Auth emulator's account chooser popup. */
  async signInWithGooglePopup(email: string, name: string): Promise<void> {
    // The chooser loads its styling from public CDNs; tests stay offline and it works without them.
    await this.page
      .context()
      .route(/^https:\/\/(unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (r) => r.abort());
    const popupOpened = this.page.waitForEvent('popup');
    await this.googleButton.click();
    await new GoogleEmulatorPopup(await popupOpened).addAccountAndSignIn(email, name);
  }

  /** Faster sign-in through the emulator-only helper (docs/TEST_ENV.md); the page then bootstraps as usual. */
  async signInWithEmulatorCredential(email: string, name?: string): Promise<void> {
    await this.page.waitForFunction(() => typeof (window as E2eWindow).__e2e?.signIn === 'function');
    // Not awaited inside the page: a successful sign-in navigates away and would destroy the evaluation context.
    await this.page.evaluate(
      ([e, n]) => {
        void (window as E2eWindow).__e2e!.signIn(e!, n).catch(() => undefined);
      },
      [email, name] as const,
    );
  }

  /** Computed transition-duration of the Google button (UI-10, UI-12). */
  async googleButtonTransitionDuration(): Promise<string> {
    return this.googleButton.evaluate((el) => getComputedStyle(el).transitionDuration);
  }
}
