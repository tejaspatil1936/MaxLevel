import { expect, type Locator, type Page } from '@playwright/test';
import type { Role } from '../fixtures/seed';
import { pathPattern } from './paths';

/** A role's landing screen after sign-in (docs/testids/phase-0.md, "Role homes"). */
export class RoleHome {
  readonly main: Locator;
  readonly heading: Locator;
  /** The shell's top bar; in the admin workspace it names the organization being worked in. */
  readonly banner: Locator;

  constructor(
    readonly page: Page,
    readonly path: string,
    readonly headingName: string,
  ) {
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1, name: headingName, exact: true });
    this.banner = page.getByRole('banner');
  }

  async goto(): Promise<void> {
    await this.page.goto(this.path);
  }

  /** The browser is on this home's path and its level-1 heading is visible inside the main landmark. */
  async expectShown(): Promise<void> {
    await expect(this.page).toHaveURL(pathPattern(this.path));
    await expect(this.heading).toBeVisible();
  }
}

export const platformHome = (page: Page) => new RoleHome(page, '/platform/', 'Organizations');
export const adminHome = (page: Page) => new RoleHome(page, '/admin/', 'Overview');
export const studentHome = (page: Page) => new RoleHome(page, '/student/', 'Your tests');

export function homeFor(page: Page, role: Role): RoleHome {
  return { superAdmin: platformHome, admin: adminHome, student: studentHome }[role](page);
}
