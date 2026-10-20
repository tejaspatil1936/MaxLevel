import { expect, type Locator, type Page } from '@playwright/test';
import { AGREEMENT, PRIVACY_NOTE, type CheckName } from '../fixtures/exam';
import { pathPattern } from './paths';
import { button, exactly } from './ui';

// Preflight, rules (with phone pairing) and the submitted screen (docs/testids/phase-3.md, "Preflight", "Rules",
// "Submit").

export type CheckStatus = 'Checking' | 'Passed' | 'Failed';

export class PreflightPage {
  readonly main: Locator;
  readonly heading: Locator;
  readonly checks: Locator;
  readonly checkAgain: Locator;
  readonly continueToRules: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1, name: 'Check your device', exact: true });
    this.checks = this.main.getByRole('list', { name: 'Device checks', exact: true });
    this.checkAgain = button(this.main, 'Check again');
    this.continueToRules = this.main
      .getByRole('link', { name: 'Continue to rules', exact: true })
      .or(this.main.getByRole('button', { name: 'Continue to rules', exact: true }));
  }

  static url(testId: string): string {
    return `/exam/preflight/?test=${encodeURIComponent(testId)}`;
  }

  async goto(testId: string): Promise<void> {
    await this.page.goto(PreflightPage.url(testId));
    await expect(this.heading).toBeVisible();
  }

  /** The list item of one check (its text starts with the check name). */
  check(name: CheckName): Locator {
    return this.checks.getByRole('listitem').filter({ hasText: new RegExp(`^\\s*${name}\\b`) });
  }

  async expectCheck(name: CheckName, status: CheckStatus, timeout = 30_000): Promise<void> {
    const item = this.check(name);
    await expect(item, `${name} check`).toHaveCount(1);
    await expect(item, `${name} check`).toContainText(status, { timeout });
  }

  /** Waits for every listed check to pass, then goes on to the rules. */
  async passAndContinue(names: CheckName[]): Promise<RulesPage> {
    await expect(this.checks.getByRole('listitem')).toHaveCount(names.length);
    for (const n of names) await this.expectCheck(n, 'Passed');
    await expect(this.continueToRules).toBeEnabled();
    await this.continueToRules.click();
    const rules = new RulesPage(this.page);
    await expect(this.page).toHaveURL(pathPattern('/exam/rules/'));
    await expect(rules.heading).toBeVisible();
    return rules;
  }
}

/** Checks a test shows when it needs no fullscreen and no camera. */
export const BASIC_CHECKS: CheckName[] = ['Screen width', 'Connection', 'Clock', 'Browser'];
/** Every check, for a test that needs fullscreen and the laptop camera. */
export const ALL_CHECKS: CheckName[] = [
  'Screen width',
  'Fullscreen',
  'Camera',
  'Face detection',
  'Connection',
  'Clock',
  'Browser',
];
/** Checks for a test that needs the laptop camera but not fullscreen. */
export const CAMERA_CHECKS: CheckName[] = [
  'Screen width',
  'Camera',
  'Face detection',
  'Connection',
  'Clock',
  'Browser',
];

export class PairingRegion {
  readonly region: Locator;
  readonly qr: Locator;
  readonly link: Locator;
  readonly status: Locator;
  readonly newCode: Locator;

  constructor(scope: Locator) {
    this.region = scope;
    this.qr = scope.getByRole('img', { name: 'QR code to pair your phone', exact: true });
    this.link = scope.getByTestId('pairing-link');
    this.status = scope.getByRole('status');
    this.newCode = button(scope, 'New code');
  }

  /** The pairing link shown as text. */
  async url(): Promise<string> {
    await expect(this.link).toBeVisible();
    return (await this.link.innerText()).trim();
  }
}

export class RulesPage {
  readonly main: Locator;
  readonly heading: Locator;
  readonly rules: Locator;
  readonly privacyNote: Locator;
  readonly agreement: Locator;
  readonly start: Locator;
  readonly checkDevice: Locator;
  readonly pairing: PairingRegion;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1, name: 'Exam rules', exact: true });
    this.rules = this.main.getByRole('list', { name: 'Rules for this test', exact: true });
    this.privacyNote = this.main.getByText(PRIVACY_NOTE, { exact: true });
    this.agreement = this.main.getByRole('checkbox', { name: AGREEMENT, exact: true });
    this.start = button(this.main, 'Start test');
    this.checkDevice = this.main.getByRole('link', { name: 'Check your device', exact: true });
    this.pairing = new PairingRegion(this.main.getByRole('region', { name: 'Pair your phone', exact: true }));
  }

  static url(testId: string): string {
    return `/exam/rules/?test=${encodeURIComponent(testId)}`;
  }

  async goto(testId: string): Promise<void> {
    await this.page.goto(RulesPage.url(testId));
    await expect(this.heading).toBeVisible();
  }

  rule(text: string): Locator {
    return this.rules.getByRole('listitem').filter({ hasText: exactly(text) });
  }

  /** Disabled means the `disabled` attribute or `aria-disabled="true"` (Playwright's toBeDisabled checks both). */
  async expectStartDisabled(reason?: string): Promise<void> {
    await expect(this.start).toBeVisible();
    await expect(this.start).toBeDisabled();
    if (reason) await expect(this.start).toHaveAccessibleDescription(reason);
  }

  async expectStartEnabled(): Promise<void> {
    await expect(this.start).toBeEnabled();
  }

  /** Ticks the agreement, presses Start test and waits for the exam screen. Returns the attempt ID. */
  async agreeAndStart(): Promise<string> {
    await this.agreement.check();
    await this.expectStartEnabled();
    await this.start.click();
    await expect(this.page).toHaveURL(/\/exam\/\?attempt=/);
    await expect(
      this.page.getByRole('main').getByRole('heading', { level: 2, name: /^Question \d+ of \d+$/ }),
    ).toBeVisible();
    return new URL(this.page.url()).searchParams.get('attempt')!;
  }
}

export class SubmittedPage {
  readonly main: Locator;
  readonly back: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.back = this.main.getByRole('link', { name: 'Back to your tests', exact: true });
  }

  heading(name: string): Locator {
    return this.main.getByRole('heading', { level: 1, name, exact: true });
  }

  text(t: string): Locator {
    return this.main.getByText(t, { exact: true });
  }

  async expectShown(attemptId: string, heading: string): Promise<void> {
    await expect(this.page).toHaveURL(pathPattern('/exam/submitted/'));
    expect(new URL(this.page.url()).searchParams.get('attempt')).toBe(attemptId);
    await expect(this.heading(heading)).toBeVisible();
  }
}
