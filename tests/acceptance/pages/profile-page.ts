import { expect, type Locator, type Page } from '@playwright/test';
import { pathPattern } from './paths';
import { field } from './ui';

// The org chooser on /, the consent notice and the profile form on /profile/ (docs/testids/phase-1.md, "Student
// sign-in, organization choice, consent and profile").

export const PROFILE_ERRORS = {
  nameMissing: 'Enter your full name.',
  prnTaken: 'This PRN is already registered. Check it, or ask your placement cell for help.',
} as const;
export const PROFILE_LOCKED_NOTE = 'Your profile is locked. Ask your placement cell to make changes.';
export const DPDP = 'Digital Personal Data Protection Act, 2023';

export class OrgChooser {
  readonly main: Locator;
  readonly heading: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1, name: 'Choose your organization', exact: true });
  }

  /** The group holding one button per organization offered (other buttons, such as Sign out, sit outside it). */
  get group(): Locator {
    return this.main.getByRole('group', { name: 'Your organizations', exact: true });
  }

  /** Buttons for every organization offered. */
  get choices(): Locator {
    return this.group.getByRole('button');
  }

  choice(orgName: string): Locator {
    return this.group.getByRole('button', { name: orgName, exact: true });
  }

  async expectShown(): Promise<void> {
    await expect(this.page).toHaveURL(pathPattern('/'));
    await expect(this.heading).toBeVisible();
  }
}

export class ConsentNotice {
  readonly main: Locator;
  readonly heading: Locator;
  readonly agree: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1, name: 'Your data and privacy', exact: true });
    this.agree = this.main.getByRole('button', { name: 'I agree and continue', exact: true });
  }

  async expectShown(): Promise<void> {
    await expect(this.page).toHaveURL(pathPattern('/profile/'));
    await expect(this.heading).toBeVisible();
    await expect(this.agree).toBeVisible();
  }
}

export class ProfileForm {
  readonly main: Locator;
  readonly completeHeading: Locator;
  readonly profileHeading: Locator;
  readonly fullName: Locator;
  readonly prn: Locator;
  readonly department: Locator;
  readonly graduationYear: Locator;
  readonly saveAndContinue: Locator;
  readonly saveChanges: Locator;
  readonly lockedNote: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.completeHeading = this.main.getByRole('heading', { level: 1, name: 'Complete your profile', exact: true });
    this.profileHeading = this.main.getByRole('heading', { level: 1, name: 'Your profile', exact: true });
    this.fullName = field(this.main, 'Full name (required)');
    this.prn = field(this.main, 'PRN (required)');
    this.department = field(this.main, 'Department (required)');
    this.graduationYear = field(this.main, 'Graduation year (required)');
    this.saveAndContinue = this.main.getByRole('button', { name: 'Save and continue', exact: true });
    this.saveChanges = this.main.getByRole('button', { name: 'Save changes', exact: true });
    this.lockedNote = this.main.getByText(PROFILE_LOCKED_NOTE, { exact: true });
  }

  async goto(): Promise<void> {
    await this.page.goto('/profile/');
  }

  async expectCompletionShown(): Promise<void> {
    await expect(this.page).toHaveURL(pathPattern('/profile/'));
    await expect(this.completeHeading).toBeVisible();
  }

  /** Labels of the Department options other than an empty placeholder. */
  async departmentOptions(): Promise<string[]> {
    const labels = await this.department.locator('option').allInnerTexts();
    return labels.map((l) => l.trim()).filter((l) => l !== '' && !/^(choose|select)/i.test(l));
  }

  async fill(input: { name?: string; prn?: string; department?: string; graduationYear?: number }): Promise<void> {
    if (input.name !== undefined) await this.fullName.fill(input.name);
    if (input.prn !== undefined) await this.prn.fill(input.prn);
    if (input.department) await this.department.selectOption({ label: input.department });
    if (input.graduationYear) await this.graduationYear.selectOption({ label: String(input.graduationYear) });
  }
}
