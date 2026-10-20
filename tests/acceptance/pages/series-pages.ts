import { expect, type Locator, type Page } from '@playwright/test';
import { EligibilityEditor } from './eligibility-editor';
import { pathPattern } from './paths';
import { SettingsControls } from './settings-controls';
import { Shell } from './shell';
import { alertDialog, button, cellIn, dataRows, dialog, exactly, field, table } from './ui';

// Series screens: /admin/series/, /admin/series/new/, /admin/series/edit/, /admin/series/view/
// (docs/testids/phase-2.md, "Series list", "New series and Edit series", "Series page").

export const SERIES_LINK = { name: 'Series', path: '/admin/series/' } as const;

export const SERIES_EMPTY = {
  sentence: 'No series yet. Create a series to start adding tests.',
  action: 'New series',
} as const;
export const TIMELINE_EMPTY = {
  sentence: 'No tests yet. Add the first test to this series.',
  action: 'Add test',
} as const;

export const SERIES_ERRORS = {
  title: 'Enter the series title.',
  endBeforeStart: "The end date can't be before the start date.",
} as const;

export const TEST_ERRORS = {
  title: 'Enter the test title.',
  outsideSeries: (from: string, to: string) => `Choose a date from ${from} to ${to}, the series dates.`,
} as const;

export const DAY_LABEL_HINT = 'Leave empty to number tests by date, for example Day 3.';

/** Not-found screens for an ID outside the organization being worked in. */
export class NotFoundPage {
  readonly shell: Shell;
  constructor(readonly page: Page) {
    this.shell = new Shell(page);
  }
  heading(kind: 'series' | 'test'): Locator {
    return this.shell.heading(kind === 'series' ? 'Series not found' : 'Test not found');
  }
  message(kind: 'series' | 'test', orgName: string): Locator {
    return this.shell.main.getByText(`This ${kind} doesn't exist in ${orgName}.`, { exact: true });
  }
  get back(): Locator {
    return this.shell.main.getByRole('link', { name: 'Back to series', exact: true });
  }
}

export class SeriesListPage {
  readonly shell: Shell;
  readonly heading: Locator;
  readonly newSeries: Locator;
  readonly list: Locator;
  readonly rows: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    this.heading = this.shell.heading('Series');
    this.newSeries = this.shell.main
      .getByRole('link', { name: 'New series', exact: true })
      .or(this.shell.main.getByRole('button', { name: 'New series', exact: true }))
      .first();
    this.list = table(this.shell.main, 'Series');
    this.rows = dataRows(this.list);
  }

  async goto(): Promise<void> {
    await this.page.goto(SERIES_LINK.path);
    await expect(this.heading).toBeVisible();
  }

  /** Opens the list from the sidebar link. */
  async openFromSidebar(): Promise<void> {
    await this.shell.navLink(SERIES_LINK.name).click();
    await expect(this.page).toHaveURL(pathPattern(SERIES_LINK.path));
    await expect(this.heading).toBeVisible();
  }

  row(title: string): Locator {
    return this.list.getByRole('row').filter({ has: this.page.getByRole('link', { name: title, exact: true }) });
  }

  async cell(title: string, column: 'Title' | 'Dates' | 'Tests' | 'Status'): Promise<Locator> {
    return cellIn(this.list, this.row(title), column);
  }

  async open(title: string): Promise<SeriesPage> {
    await this.row(title).getByRole('link', { name: title, exact: true }).click();
    const series = new SeriesPage(this.page);
    await expect(series.shell.heading(title)).toBeVisible();
    return series;
  }

  async startNew(): Promise<SeriesForm> {
    await this.newSeries.click();
    const form = new SeriesForm(this.page, 'new');
    await expect(form.heading).toBeVisible();
    return form;
  }
}

export interface SeriesDetails {
  title?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  dailyStart?: string;
  dailyEnd?: string;
}

export class SeriesForm {
  readonly shell: Shell;
  readonly heading: Locator;
  readonly title: Locator;
  readonly description: Locator;
  readonly startDate: Locator;
  readonly endDate: Locator;
  readonly dailyStart: Locator;
  readonly dailyEnd: Locator;
  readonly defaults: Locator;
  readonly settings: SettingsControls;
  readonly eligibility: EligibilityEditor;
  readonly footer: Locator;
  readonly discard: Locator;
  readonly submit: Locator;
  readonly unsaved: Locator;

  constructor(
    readonly page: Page,
    readonly mode: 'new' | 'edit',
  ) {
    this.shell = new Shell(page);
    const main = this.shell.main;
    this.heading = this.shell.heading(mode === 'new' ? 'New series' : 'Edit series');
    this.title = field(main, 'Title (required)');
    this.description = field(main, 'Description');
    this.startDate = field(main, 'Start date (required)');
    this.endDate = field(main, 'End date (required)');
    this.dailyStart = field(main, 'Daily start time (required)');
    this.dailyEnd = field(main, 'Daily end time (required)');
    this.defaults = main.getByRole('group', { name: 'Default settings', exact: true });
    this.settings = new SettingsControls(page, this.defaults);
    this.eligibility = new EligibilityEditor(page, main, 'series');
    this.footer = page.getByRole('region', { name: 'Form actions', exact: true });
    this.discard = button(this.footer, 'Discard');
    this.submit = button(this.footer, mode === 'new' ? 'Create series' : 'Save changes');
    this.unsaved = this.footer.getByRole('status').filter({ hasText: exactly('Unsaved changes') });
  }

  /** Text anywhere in the form with exactly this content (for checking a message is gone). */
  text(t: string): Locator {
    return this.shell.main.getByText(t, { exact: true });
  }

  async gotoNew(): Promise<void> {
    await this.page.goto('/admin/series/new/');
    await expect(this.heading).toBeVisible();
  }

  async fillDetails(d: SeriesDetails): Promise<void> {
    if (d.title !== undefined) await this.title.fill(d.title);
    if (d.description !== undefined) await this.description.fill(d.description);
    if (d.startDate !== undefined) await this.startDate.fill(d.startDate);
    if (d.endDate !== undefined) await this.endDate.fill(d.endDate);
    if (d.dailyStart !== undefined) await this.dailyStart.fill(d.dailyStart);
    if (d.dailyEnd !== undefined) await this.dailyEnd.fill(d.dailyEnd);
  }

  /** Submits and waits for the series page of `title`. */
  async submitAndOpen(title: string): Promise<SeriesPage> {
    await this.submit.click();
    const series = new SeriesPage(this.page);
    await expect(series.shell.heading(title)).toBeVisible();
    return series;
  }
}

export interface TestDetails {
  title?: string;
  company?: string;
  scheduledDate?: string;
  dayLabel?: string;
  hideDay?: boolean;
}

/** Fills the fields shared by `Add test` and `Edit test details`. */
export async function fillTestDetails(dlg: Locator, d: TestDetails): Promise<void> {
  if (d.title !== undefined) await field(dlg, 'Title (required)').fill(d.title);
  if (d.company !== undefined) await field(dlg, 'Company').fill(d.company);
  if (d.scheduledDate !== undefined) await field(dlg, 'Scheduled date (required)').fill(d.scheduledDate);
  if (d.dayLabel !== undefined) await field(dlg, 'Day label').fill(d.dayLabel);
  if (d.hideDay !== undefined)
    await dlg.getByRole('checkbox', { name: 'Hide the day label', exact: true }).setChecked(d.hideDay);
}

export class SeriesPage {
  readonly shell: Shell;
  readonly status: Locator;
  readonly addTest: Locator;
  readonly editSeries: Locator;
  readonly moreActions: Locator;
  readonly timeline: Locator;
  readonly items: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    const main = this.shell.main;
    this.status = main.getByTestId('series-status');
    this.addTest = button(main, 'Add test').first();
    this.editSeries = main
      .getByRole('link', { name: 'Edit series', exact: true })
      .or(main.getByRole('button', { name: 'Edit series', exact: true }));
    this.moreActions = button(main, 'More actions');
    this.timeline = main.getByRole('list', { name: 'Tests by day', exact: true });
    this.items = this.timeline.getByRole('listitem');
  }

  static url(seriesId: string): string {
    return `/admin/series/view/?id=${encodeURIComponent(seriesId)}`;
  }

  async goto(seriesId: string, title: string): Promise<void> {
    await this.page.goto(SeriesPage.url(seriesId));
    await expect(this.shell.heading(title)).toBeVisible();
  }

  /** The timeline item holding the link to this test. */
  item(testTitle: string): Locator {
    return this.items.filter({ has: this.page.getByRole('link', { name: testTitle, exact: true }) });
  }

  testLink(testTitle: string): Locator {
    return this.timeline.getByRole('link', { name: testTitle, exact: true });
  }

  /** Waits until the timeline lists exactly these test titles, in this order. */
  async expectTimeline(titles: readonly string[]): Promise<void> {
    await expect(this.timeline.getByRole('link')).toHaveText(titles.map((t) => exactly(t)));
  }

  addTestDialog(): Locator {
    return dialog(this.page, 'Add test');
  }

  /** Opens `Add test`, fills it and submits; returns the dialog (hidden on success). */
  async addTestWith(d: TestDetails): Promise<Locator> {
    await this.addTest.click();
    const dlg = this.addTestDialog();
    await expect(dlg).toBeVisible();
    await fillTestDetails(dlg, d);
    await button(dlg, 'Add test').click();
    return dlg;
  }

  async add(d: TestDetails): Promise<void> {
    const dlg = await this.addTestWith(d);
    await expect(dlg).toBeHidden();
    await expect(this.testLink(d.title!)).toBeVisible();
  }

  /** The `status` notice with this exact text. */
  notice(text: string): Locator {
    return this.page.getByRole('status').filter({ hasText: exactly(text) });
  }

  async chooseAction(item: 'Activate series' | 'Archive series'): Promise<void> {
    await this.moreActions.click();
    await this.page.getByRole('menuitem', { name: item, exact: true }).click();
  }

  archiveDialog(title: string): Locator {
    return alertDialog(this.page, `Archive ${title}?`);
  }

  /** Archive series from the overflow menu, confirmed in its dialog. */
  async archive(title: string): Promise<void> {
    await this.chooseAction('Archive series');
    const dlg = this.archiveDialog(title);
    await expect(dlg).toBeVisible();
    await button(dlg, 'Archive series').click();
    await expect(dlg).toBeHidden();
  }

  async openEdit(): Promise<SeriesForm> {
    await this.editSeries.click();
    const form = new SeriesForm(this.page, 'edit');
    await expect(form.heading).toBeVisible();
    return form;
  }
}
