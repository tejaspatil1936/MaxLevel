import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The Auth emulator's Google account chooser (/emulator/auth/handler) that signInWithPopup opens on the emulator.
 * Its markup belongs to firebase-tools, so some fields are found by their fixed element IDs.
 */
export class GoogleEmulatorPopup {
  readonly addAccount: Locator;
  readonly email: Locator;
  readonly displayName: Locator;
  readonly signIn: Locator;

  constructor(readonly popup: Page) {
    this.addAccount = popup.getByRole('button', { name: 'Add new account' });
    this.email = popup.locator('#email-input');
    this.displayName = popup.locator('#display-name-input');
    this.signIn = popup.getByRole('button', { name: /^Sign in with Google/ });
  }

  /** Adds a new Google account on the emulator and signs in with it; resolves once the popup has closed. */
  async addAccountAndSignIn(email: string, name: string): Promise<void> {
    const closed = this.popup.waitForEvent('close');
    await this.addAccount.click();
    await this.email.fill(email);
    await this.displayName.fill(name);
    await expect(this.signIn).toBeEnabled();
    await this.signIn.click();
    await closed;
  }
}
