import { expect, type Locator, type Page } from '@playwright/test';
import { pathPattern } from './paths';
import { Shell, StudentShell } from './shell';
import { alertDialog, button, dataRows, exactly, table } from './ui';

// Phase 4 screens (docs/testids/phase-4.md): the student result page, history and leaderboards, the student top-bar
// navigation, and the admin results list, test results and series results pages with their export region.

export const RESULTS_LINK = { name: 'Results', path: '/admin/results/' } as const;

/** The light-theme `ballpoint-wash` background of the student's own leaderboard row. */
export const BALLPOINT_WASH = 'rgb(230, 233, 251)';

const exact = (scope: Page | Locator, text: string) => scope.getByText(text, { exact: true });

// ---------- student ----------

export type StudentNavLink = 'Tests' | 'History' | 'Leaderboards';

/** The `Main` navigation in the student top bar. */
export class StudentNav {
  readonly nav: Locator;

  constructor(readonly page: Page) {
    this.nav = page.getByRole('banner').getByRole('navigation', { name: 'Main', exact: true });
  }

  link(name: StudentNavLink): Locator {
    return this.nav.getByRole('link', { name, exact: true });
  }

  async open(name: StudentNavLink): Promise<void> {
    await this.link(name).click();
  }
}

export class StudentResultPage {
  readonly shell: StudentShell;
  readonly main: Locator;
  readonly result: Locator;
  readonly sections: Locator;
  readonly reviewLink: Locator;
  readonly reviewHeading: Locator;
  readonly review: Locator;
  readonly endedHeading: Locator;
  readonly withdrawnHeading: Locator;
  readonly back: Locator;
  readonly resume: Locator;

  constructor(readonly page: Page) {
    this.shell = new StudentShell(page);
    this.main = page.getByRole('main');
    this.result = this.main.getByRole('region', { name: 'Your result', exact: true });
    this.sections = table(this.main, 'Section scores');
    this.reviewLink = this.main.getByRole('link', { name: 'Review answers', exact: true });
    this.reviewHeading = this.main.getByRole('heading', { level: 2, name: 'Answer review', exact: true });
    this.review = this.main.getByRole('list', { name: 'Answer review', exact: true });
    this.endedHeading = this.main.getByRole('heading', { level: 2, name: 'Your test was ended', exact: true });
    this.withdrawnHeading = this.main.getByRole('heading', {
      level: 2,
      name: 'Results are being reviewed',
      exact: true,
    });
    this.back = this.main.getByRole('link', { name: 'Back to your tests', exact: true });
    this.resume = this.main.getByRole('link', { name: 'Resume test', exact: true });
  }

  static url(attemptId: string): string {
    return `/student/result/?attempt=${encodeURIComponent(attemptId)}`;
  }

  heading(name: string): Locator {
    return this.main.getByRole('heading', { level: 1, name, exact: true });
  }

  async goto(attemptId: string, heading: string): Promise<void> {
    await this.page.goto(StudentResultPage.url(attemptId));
    await expect(this.heading(heading)).toBeVisible();
  }

  async expectOn(attemptId: string, heading: string): Promise<void> {
    await expect(this.page).toHaveURL(pathPattern('/student/result/'));
    expect(new URL(this.page.url()).searchParams.get('attempt')).toBe(attemptId);
    await expect(this.heading(heading)).toBeVisible();
  }

  /** A text of the page, exactly. */
  text(t: string): Locator {
    return exact(this.main, t);
  }

  /** A text inside the `Your result` region, exactly. */
  inResult(t: string): Locator {
    return exact(this.result, t);
  }

  /** Any rank line (`Rank …`) in the result region. */
  get rankLine(): Locator {
    return this.result.getByText(/^\s*Rank \d+ of \d+\s*$/);
  }

  /** The review item of question n (1-based, exam order). */
  reviewItem(n: number): Locator {
    return this.review
      .getByRole('listitem')
      .filter({ has: this.page.getByRole('heading', { level: 3, name: `Question ${n}`, exact: true }) });
  }

  /** The `Explanation` heading inside a review item. */
  static explanationHeading(item: Locator): Locator {
    return item.getByRole('heading', { level: 4, name: 'Explanation', exact: true });
  }
}

export class StudentHistoryPage {
  readonly shell: StudentShell;
  readonly main: Locator;
  readonly heading: Locator;

  constructor(readonly page: Page) {
    this.shell = new StudentShell(page);
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1, name: 'Your history', exact: true });
  }

  async goto(): Promise<void> {
    await this.page.goto('/student/history/');
    await expect(this.heading).toBeVisible();
  }

  seriesHeading(title: string): Locator {
    return this.main.getByRole('heading', { level: 2, name: title, exact: true });
  }

  table(seriesTitle: string): Locator {
    return table(this.main, seriesTitle);
  }

  rows(seriesTitle: string): Locator {
    return dataRows(this.table(seriesTitle));
  }

  /** The row of a test, found by its title link. */
  row(seriesTitle: string, testTitle: string): Locator {
    return this.rows(seriesTitle).filter({
      has: this.page.getByRole('link', { name: testTitle, exact: true }),
    });
  }

  testLink(seriesTitle: string, testTitle: string): Locator {
    return this.row(seriesTitle, testTitle).getByRole('link', { name: testTitle, exact: true });
  }
}

export class StudentLeaderboardsPage {
  readonly shell: StudentShell;
  readonly main: Locator;
  readonly heading: Locator;
  readonly list: Locator;

  constructor(readonly page: Page) {
    this.shell = new StudentShell(page);
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1, name: 'Leaderboards', exact: true });
    this.list = this.main.getByRole('list', { name: 'Open leaderboards', exact: true });
  }

  async goto(): Promise<void> {
    await this.page.goto('/student/leaderboards/');
    await expect(this.heading).toBeVisible();
  }

  item(title: string): Locator {
    return this.list.getByRole('listitem').filter({ has: this.page.getByRole('link', { name: title, exact: true }) });
  }

  link(title: string): Locator {
    return this.item(title).getByRole('link', { name: title, exact: true });
  }

  text(t: string): Locator {
    return exact(this.main, t);
  }
}

export class LeaderboardPage {
  readonly main: Locator;
  readonly table: Locator;
  readonly notOnBoard: Locator;
  readonly notAvailable: Locator;
  readonly notAvailableText: Locator;
  readonly back: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.table = table(this.main, 'Leaderboard');
    this.notOnBoard = exact(this.main, 'You are not on this leaderboard.');
    this.notAvailable = this.main.getByRole('heading', { level: 1, name: 'Leaderboard not available', exact: true });
    this.notAvailableText = exact(this.main, "This leaderboard isn't open to you.");
    this.back = this.main.getByRole('link', { name: 'Back to leaderboards', exact: true });
  }

  static url(boardId: string): string {
    return `/student/leaderboards/?board=${encodeURIComponent(boardId)}`;
  }

  heading(boardTitle: string): Locator {
    return this.main.getByRole('heading', { level: 1, name: `${boardTitle} leaderboard`, exact: true });
  }

  async goto(boardId: string, boardTitle: string): Promise<void> {
    await this.page.goto(LeaderboardPage.url(boardId));
    await expect(this.heading(boardTitle)).toBeVisible();
  }

  ownRank(n: number, total: number): Locator {
    return exact(this.main, `You are ranked ${n} of ${total}.`);
  }

  get rows(): Locator {
    return dataRows(this.table);
  }

  get ownRows(): Locator {
    return this.table.locator('tr[aria-current="true"]');
  }
}

/** Cell texts of every data row of a table, trimmed, in order. */
export async function tableTexts(tbl: Locator): Promise<string[][]> {
  const rows = dataRows(tbl);
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  const out: string[][] = [];
  for (let i = 0; i < count; i++) {
    const cells = rows.nth(i).getByRole('cell').or(rows.nth(i).getByRole('rowheader'));
    out.push((await cells.allInnerTexts()).map((t) => t.trim()));
  }
  return out;
}

/** Column header texts of a table, trimmed. */
export async function headerTexts(tbl: Locator): Promise<string[]> {
  return (await tbl.getByRole('columnheader').allInnerTexts()).map((t) => t.trim());
}

/** Computed background colours of a row and its cells. */
export async function rowBackgrounds(row: Locator): Promise<string[]> {
  return row.evaluate((tr) =>
    [tr, ...Array.from(tr.children)].map((el) => getComputedStyle(el as Element).backgroundColor),
  );
}

/** `See your result` on the submitted screen. */
export const seeYourResult = (page: Page) =>
  page.getByRole('main').getByRole('link', { name: 'See your result', exact: true });

// ---------- admin ----------

export class AdminResultsList {
  readonly shell: Shell;
  readonly heading: Locator;
  readonly tests: Locator;
  readonly series: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    this.heading = this.shell.heading('Results');
    this.tests = table(this.shell.main, 'Tests');
    this.series = table(this.shell.main, 'Series');
  }

  async goto(): Promise<void> {
    await this.page.goto(RESULTS_LINK.path);
    await expect(this.heading).toBeVisible();
  }

  testRow(heading: string): Locator {
    return dataRows(this.tests).filter({ has: this.page.getByRole('link', { name: heading, exact: true }) });
  }

  testLink(heading: string): Locator {
    return this.testRow(heading).getByRole('link', { name: heading, exact: true });
  }

  seriesLink(title: string): Locator {
    return dataRows(this.series)
      .filter({ has: this.page.getByRole('link', { name: title, exact: true }) })
      .getByRole('link', { name: title, exact: true });
  }
}

export class ExportRegion {
  readonly region: Locator;
  readonly csv: Locator;
  readonly xlsx: Locator;
  readonly status: Locator;
  readonly failed: Locator;
  readonly note: Locator;

  constructor(scope: Locator) {
    this.region = scope.getByRole('region', { name: 'Export results', exact: true });
    this.csv = button(this.region, 'Export CSV');
    this.xlsx = button(this.region, 'Export XLSX');
    this.status = this.region.getByRole('status');
    this.failed = this.region.getByRole('alert').filter({ hasText: exactly('The export failed. Try again.') });
    this.note = exact(this.region, 'This link works for 15 minutes.');
  }

  download(format: 'CSV' | 'XLSX'): Locator {
    return this.region.getByRole('link', { name: `Download ${format}`, exact: true });
  }
}

class ReleaseRegion {
  readonly region: Locator;
  readonly release: Locator;
  readonly withdraw: Locator;

  constructor(
    readonly page: Page,
    scope: Locator,
  ) {
    this.region = scope.getByRole('region', { name: 'Result release', exact: true });
    this.release = button(this.region, 'Release results');
    this.withdraw = button(this.region, 'Withdraw results');
  }

  state(text: string): Locator {
    return exact(this.region, text);
  }

  get releaseDialog(): Locator {
    return alertDialog(this.page, 'Release results?');
  }

  get withdrawDialog(): Locator {
    return alertDialog(this.page, 'Withdraw results?');
  }

  /** Presses Release results, confirms, and waits for the `Results released` notice. */
  async releaseAndConfirm(): Promise<void> {
    await this.release.click();
    await expect(this.releaseDialog).toBeVisible();
    await button(this.releaseDialog, 'Release results').click();
    await expect(this.page.getByRole('status').filter({ hasText: exactly('Results released') })).toBeVisible();
  }

  /** Presses Withdraw results, confirms, and waits for the `Results withdrawn` notice. */
  async withdrawAndConfirm(): Promise<void> {
    await this.withdraw.click();
    await expect(this.withdrawDialog).toBeVisible();
    await button(this.withdrawDialog, 'Withdraw results').click();
    await expect(this.page.getByRole('status').filter({ hasText: exactly('Results withdrawn') })).toBeVisible();
  }
}

export class AdminTestResults {
  readonly shell: Shell;
  readonly release: ReleaseRegion;
  readonly exports: ExportRegion;
  readonly leaderboardHeading: Locator;
  readonly leaderboard: Locator;
  readonly notFound: Locator;
  readonly backToResults: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    this.release = new ReleaseRegion(page, this.shell.main);
    this.exports = new ExportRegion(this.shell.main);
    this.leaderboardHeading = this.shell.main.getByRole('heading', { level: 2, name: 'Leaderboard', exact: true });
    this.leaderboard = table(this.shell.main, 'Leaderboard');
    this.notFound = this.shell.heading('Test not found');
    this.backToResults = this.shell.main.getByRole('link', { name: 'Back to results', exact: true });
  }

  static url(testId: string): string {
    return `/admin/results/?test=${encodeURIComponent(testId)}`;
  }

  heading(testHeading: string): Locator {
    return this.shell.heading(`Results for ${testHeading}`);
  }

  async goto(testId: string, testHeading: string): Promise<void> {
    await this.page.goto(AdminTestResults.url(testId));
    await expect(this.heading(testHeading)).toBeVisible();
  }

  text(t: string): Locator {
    return exact(this.shell.main, t);
  }
}

export class AdminSeriesResults {
  readonly shell: Shell;
  readonly exports: ExportRegion;
  readonly leaderboard: Locator;
  readonly notFound: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    this.exports = new ExportRegion(this.shell.main);
    this.leaderboard = table(this.shell.main, 'Leaderboard');
    this.notFound = this.shell.heading('Series not found');
  }

  static url(seriesId: string): string {
    return `/admin/results/?series=${encodeURIComponent(seriesId)}`;
  }

  heading(seriesTitle: string): Locator {
    return this.shell.heading(`Results for ${seriesTitle}`);
  }

  async goto(seriesId: string, seriesTitle: string): Promise<void> {
    await this.page.goto(AdminSeriesResults.url(seriesId));
    await expect(this.heading(seriesTitle)).toBeVisible();
  }
}
