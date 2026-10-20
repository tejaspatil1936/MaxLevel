import { expect, type Locator, type Page } from '@playwright/test';
import { pathPattern } from './paths';
import { StudentShell } from './shell';

// Student dashboard and test page (docs/testids/phase-3.md, "Student dashboard" and "Test page").

export type DashboardGroup = 'Live now' | 'Upcoming' | 'Completed';

export class StudentDashboard {
  readonly shell: StudentShell;
  readonly main: Locator;
  readonly heading: Locator;
  readonly nextTest: Locator;

  constructor(readonly page: Page) {
    this.shell = new StudentShell(page);
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1, name: 'Your tests', exact: true });
    this.nextTest = this.main.getByRole('region', { name: 'Next test', exact: true });
  }

  async goto(): Promise<void> {
    await this.page.goto('/student/');
    await expect(this.heading).toBeVisible();
  }

  groupHeading(name: DashboardGroup): Locator {
    return this.main.getByRole('heading', { level: 2, name, exact: true });
  }

  list(name: DashboardGroup): Locator {
    return this.main.getByRole('list', { name, exact: true });
  }

  /** The list item of a test in a group, found by the test heading (a link in live and upcoming, text in completed). */
  item(group: DashboardGroup, testHeading: string): Locator {
    const items = this.list(group).getByRole('listitem');
    return group === 'Completed'
      ? items.filter({ hasText: testHeading })
      : items.filter({ has: this.page.getByRole('link', { name: testHeading, exact: true }) });
  }

  link(group: Exclude<DashboardGroup, 'Completed'>, testHeading: string): Locator {
    return this.item(group, testHeading).getByRole('link', { name: testHeading, exact: true });
  }

  /** The countdown of a live (`Last start in`) or upcoming (`Opens in`) item. */
  timer(group: Exclude<DashboardGroup, 'Completed'>, testHeading: string): Locator {
    return this.item(group, testHeading).getByRole('timer', {
      name: group === 'Live now' ? 'Last start in' : 'Opens in',
      exact: true,
    });
  }
}

export class StudentTestPage {
  readonly shell: StudentShell;
  readonly main: Locator;
  readonly details: Locator;
  readonly checkDevice: Locator;
  readonly resume: Locator;
  readonly opensIn: Locator;
  readonly lastStartIn: Locator;
  readonly finished: Locator;

  constructor(readonly page: Page) {
    this.shell = new StudentShell(page);
    this.main = page.getByRole('main');
    this.details = this.main.getByRole('list', { name: 'Test details', exact: true });
    this.checkDevice = this.main.getByRole('link', { name: 'Check your device', exact: true });
    this.resume = this.main.getByRole('link', { name: 'Resume test', exact: true });
    this.opensIn = this.main.getByRole('timer', { name: 'Opens in', exact: true });
    this.lastStartIn = this.main.getByRole('timer', { name: 'Last start in', exact: true });
    this.finished = this.main.getByText('You have finished this test.', { exact: true });
  }

  static url(testId: string): string {
    return `/student/test/?id=${encodeURIComponent(testId)}`;
  }

  heading(name: string): Locator {
    return this.main.getByRole('heading', { level: 1, name, exact: true });
  }

  async goto(testId: string, heading: string): Promise<void> {
    await this.page.goto(StudentTestPage.url(testId));
    await expect(this.heading(heading)).toBeVisible();
  }

  detail(text: string): Locator {
    return this.details
      .getByRole('listitem')
      .filter({ hasText: new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) });
  }

  opensAt(text: string): Locator {
    return this.main.getByText(text, { exact: true });
  }
}

/** `Test not found` on the test page, preflight and rules for a test the student can't see. */
export class TestNotAvailable {
  readonly heading: Locator;
  readonly message: Locator;
  readonly back: Locator;

  constructor(readonly page: Page) {
    const main = page.getByRole('main');
    this.heading = main.getByRole('heading', { level: 1, name: 'Test not found', exact: true });
    this.message = main.getByText("This test isn't available to you.", { exact: true });
    this.back = main.getByRole('link', { name: 'Back to your tests', exact: true });
  }

  async expectShown(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.message).toBeVisible();
    await expect(this.back).toHaveAttribute('href', /\/student\/?$/);
  }
}

export async function expectOnStudentHome(page: Page): Promise<void> {
  await expect(page).toHaveURL(pathPattern('/student/'));
  await expect(
    page.getByRole('main').getByRole('heading', { level: 1, name: 'Your tests', exact: true }),
  ).toBeVisible();
}
