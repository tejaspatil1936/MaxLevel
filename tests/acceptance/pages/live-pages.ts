import { expect, type Locator, type Page } from '@playwright/test';
import { Shell } from './shell';
import { alertDialog, button, dataRows, dialog, exactly, field, table } from './ui';

// Phase 5 admin screens (docs/testids/phase-5.md): the live exams list, the live view with its counts, filters, roster
// and row actions, the grant, terminate, reinstate and reset dialogs, the timeline drawer, and the accommodations part
// of the phase 1 student drawer.

export const LIVE_LINK = { name: 'Live exams', path: '/admin/live/' } as const;

export type RosterColumn = 'Student' | 'PRN' | 'Status' | 'Answered' | 'Strikes' | 'Phone' | 'Last seen' | 'Time left';
export const ROSTER_COLUMNS: readonly (RosterColumn | 'Actions')[] = [
  'Student',
  'PRN',
  'Status',
  'Answered',
  'Strikes',
  'Phone',
  'Last seen',
  'Time left',
  'Actions',
];

export type LiveFilter =
  'With strikes' | 'Phone disconnected' | 'Offline for more than 60 s' | 'Not started' | 'Terminated';
export const LIVE_FILTERS: readonly LiveFilter[] = [
  'With strikes',
  'Phone disconnected',
  'Offline for more than 60 s',
  'Not started',
  'Terminated',
];

export type RowAction =
  'View timeline' | 'Grant extra time' | 'Reset attempt' | 'Terminate attempt' | 'Reinstate attempt';

/** The `status` notice with this exact text. */
export const noticeOn = (page: Page, text: string) => page.getByRole('status').filter({ hasText: exactly(text) });

export class LiveExamsPage {
  readonly shell: Shell;
  readonly heading: Locator;
  readonly list: Locator;
  readonly rows: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    this.heading = this.shell.heading('Live exams');
    this.list = table(this.shell.main, 'Live exams');
    this.rows = dataRows(this.list);
  }

  async goto(): Promise<void> {
    await this.page.goto(LIVE_LINK.path);
    await expect(this.heading).toBeVisible();
  }

  testLink(testHeading: string): Locator {
    return this.list.getByRole('link', { name: testHeading, exact: true });
  }

  row(testHeading: string): Locator {
    return this.list.getByRole('row').filter({ has: this.testLink(testHeading) });
  }
}

export class LiveDashboard {
  readonly shell: Shell;
  readonly main: Locator;
  readonly counts: Locator;
  readonly filters: Locator;
  readonly search: Locator;
  readonly roster: Locator;
  readonly rows: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    this.main = this.shell.main;
    this.counts = this.main.getByRole('list', { name: 'Status counts', exact: true });
    this.filters = this.main.getByRole('group', { name: 'Filters', exact: true });
    this.search = this.main.getByRole('searchbox', { name: 'Search by name or PRN', exact: true });
    this.roster = table(this.main, 'Roster');
    this.rows = dataRows(this.roster);
  }

  static url(testId: string): string {
    return `/admin/live/?test=${encodeURIComponent(testId)}`;
  }

  heading(testHeading: string): Locator {
    return this.shell.heading(`Live: ${testHeading}`);
  }

  /** Opens the live view of a test and waits for its heading and roster. */
  async goto(testId: string, testHeading: string): Promise<void> {
    await this.page.goto(LiveDashboard.url(testId));
    await this.expectShown(testHeading);
  }

  async expectShown(testHeading: string): Promise<void> {
    await expect(this.heading(testHeading)).toBeVisible();
    await expect(this.roster).toBeVisible();
  }

  /** The seven counts, in order, exactly (waits for them). */
  async expectCounts(texts: string[], timeout?: number): Promise<void> {
    await expect(this.counts.getByRole('listitem')).toHaveText(
      texts.map((t) => exactly(t)),
      timeout ? { timeout } : {},
    );
  }

  filter(name: LiveFilter): Locator {
    return this.filters.getByRole('button', { name, exact: true });
  }

  /** Presses or releases a filter and waits for its pressed state. */
  async setFilter(name: LiveFilter, pressed: boolean): Promise<void> {
    const b = this.filter(name);
    if ((await b.getAttribute('aria-pressed')) !== String(pressed)) await b.click();
    await expect(b).toHaveAttribute('aria-pressed', String(pressed));
  }

  /** The roster row of a student, by the exact text of a cell (the full name). */
  row(name: string): Locator {
    return this.roster.getByRole('row').filter({
      has: this.page
        .getByRole('cell', { name, exact: true })
        .or(this.page.getByRole('rowheader', { name, exact: true })),
    });
  }

  columnHeader(column: RosterColumn | 'Actions'): Locator {
    return this.roster.getByRole('columnheader', { name: column, exact: true });
  }

  sortButton(column: RosterColumn): Locator {
    return this.columnHeader(column).getByRole('button', { name: column, exact: true });
  }

  /** The index of a column among the roster's column headers. */
  private async columnIndex(column: RosterColumn | 'Actions'): Promise<number> {
    const headers = (await this.roster.getByRole('columnheader').allInnerTexts()).map((h) => h.trim());
    const index = headers.indexOf(column);
    expect(index, `column ${column} in ${JSON.stringify(headers)}`).toBeGreaterThanOrEqual(0);
    return index;
  }

  /** The cell of a student's row under a column. */
  async cell(name: string, column: RosterColumn): Promise<Locator> {
    const index = await this.columnIndex(column);
    const row = this.row(name);
    return row.getByRole('cell').or(row.getByRole('rowheader')).or(row.getByRole('gridcell')).nth(index);
  }

  /** Waits until a student's row reads exactly these texts in these columns. */
  async expectRow(name: string, cells: Partial<Record<RosterColumn, string | RegExp>>, timeout?: number) {
    await expect(this.row(name), `row of ${name}`).toHaveCount(1, timeout ? { timeout } : {});
    for (const [column, text] of Object.entries(cells) as Array<[RosterColumn, string | RegExp]>) {
      await expect(await this.cell(name, column), `${name}: ${column}`).toHaveText(
        typeof text === 'string' ? exactly(text) : text,
        timeout ? { timeout } : {},
      );
    }
  }

  /** The `Student` cells of the data rows, in display order. */
  async names(): Promise<string[]> {
    const index = await this.columnIndex('Student');
    return this.rows.evaluateAll(
      (rows, i) =>
        rows.map((r) => (r.querySelectorAll('td, th')[i as number]?.textContent ?? '').replace(/\s+/g, ' ').trim()),
      index,
    );
  }

  /** Waits until the shown rows are exactly these students, in this order. */
  async expectNames(names: string[], timeout?: number): Promise<void> {
    await expect.poll(() => this.names(), { message: 'roster rows', ...(timeout ? { timeout } : {}) }).toEqual(names);
  }

  /** Waits until the shown rows are exactly these students, in any order. */
  async expectNameSet(names: string[], timeout?: number): Promise<void> {
    await expect
      .poll(async () => (await this.names()).sort(), { message: 'roster rows', ...(timeout ? { timeout } : {}) })
      .toEqual([...names].sort());
  }

  actionsButton(name: string): Locator {
    return this.roster.getByRole('button', { name: `Actions for ${name}`, exact: true });
  }

  /** Opens a row's actions menu and returns it. */
  async openActions(name: string): Promise<Locator> {
    await this.actionsButton(name).click();
    const menu = this.page.getByRole('menu');
    await expect(menu).toBeVisible();
    return menu;
  }

  menuItem(item: RowAction): Locator {
    return this.page.getByRole('menu').getByRole('menuitem', { name: item, exact: true });
  }

  async choose(name: string, item: RowAction): Promise<void> {
    await this.openActions(name);
    await this.menuItem(item).click();
  }

  get empty(): Locator {
    return this.main.getByTestId('empty-state');
  }

  notice(text: string): Locator {
    return noticeOn(this.page, text);
  }

  extraTime(name: string): ExtraTimeDialog {
    return new ExtraTimeDialog(this.page, name);
  }

  reasonDialog(kind: 'terminate' | 'reinstate' | 'reset', name: string): ReasonDialog {
    return new ReasonDialog(this.page, kind, name);
  }

  timeline(name: string): TimelineDrawer {
    return new TimelineDrawer(this.page, name);
  }

  /** Cells whose text changes with the clock (`Time left`, `Last seen`), to mask in screenshots. */
  async clockCells(): Promise<Locator[]> {
    const out: Locator[] = [];
    for (const column of ['Last seen', 'Time left'] as const) {
      const n = (await this.columnIndex(column)) + 1;
      out.push(this.roster.locator(`tbody tr > :nth-child(${n})`));
    }
    return out;
  }
}

export class ExtraTimeDialog {
  readonly dialog: Locator;
  readonly minutes: Locator;
  readonly reason: Locator;
  readonly grant: Locator;
  readonly cancel: Locator;
  readonly confirm: Locator;

  constructor(
    readonly page: Page,
    readonly name: string,
  ) {
    this.dialog = dialog(page, `Grant extra time to ${name}`);
    this.minutes = field(this.dialog, 'Extra minutes (required)');
    this.reason = field(this.dialog, 'Reason (required)');
    this.grant = button(this.dialog, 'Grant extra time');
    this.cancel = button(this.dialog, 'Cancel');
    this.confirm = alertDialog(page, "Grant more than the test's duration?");
  }

  text(t: string): Locator {
    return this.dialog.getByText(t, { exact: true });
  }

  async fill(minutes: number | '', reason: string): Promise<void> {
    await this.minutes.fill(String(minutes));
    await this.reason.fill(reason);
  }
}

const REASON_DIALOGS = {
  terminate: { title: (n: string) => `Terminate ${n}'s attempt?`, confirm: 'Terminate attempt' },
  reinstate: { title: (n: string) => `Reinstate ${n}'s attempt?`, confirm: 'Reinstate attempt' },
  reset: { title: (n: string) => `Reset ${n}'s attempt?`, confirm: 'Reset attempt' },
} as const;

export class ReasonDialog {
  readonly dialog: Locator;
  readonly reason: Locator;
  readonly confirm: Locator;
  readonly confirmName: string;

  constructor(
    readonly page: Page,
    kind: 'terminate' | 'reinstate' | 'reset',
    name: string,
  ) {
    const d = REASON_DIALOGS[kind];
    this.dialog = alertDialog(page, d.title(name));
    this.reason = field(this.dialog, 'Reason (required)');
    this.confirmName = d.confirm;
    this.confirm = button(this.dialog, d.confirm);
  }

  text(t: string): Locator {
    return this.dialog.getByText(t, { exact: true });
  }
}

export class TimelineDrawer {
  readonly dialog: Locator;
  readonly events: Locator;
  readonly items: Locator;
  readonly noEvents: Locator;
  readonly close: Locator;

  constructor(
    readonly page: Page,
    name: string,
  ) {
    this.dialog = dialog(page, `Timeline for ${name}`);
    this.events = this.dialog.getByRole('list', { name: 'Events', exact: true });
    this.items = this.events.getByRole('listitem');
    this.noEvents = this.dialog.getByText('No events yet.', { exact: true });
    this.close = button(this.dialog, 'Close');
  }
}

/** The `Accommodations` part of the phase 1 student drawer (`dialog` named the student's full name). */
export class AccommodationsSection {
  readonly heading: Locator;
  readonly list: Locator;
  readonly items: Locator;
  readonly none: Locator;
  readonly add: Locator;
  readonly addDialog: Locator;
  readonly series: Locator;
  readonly kind: Locator;
  readonly amount: Locator;
  readonly save: Locator;

  constructor(
    readonly page: Page,
    drawer: Locator,
  ) {
    this.heading = drawer.getByRole('heading', { name: 'Accommodations', exact: true });
    this.list = drawer.getByRole('list', { name: 'Accommodations', exact: true });
    this.items = this.list.getByRole('listitem');
    this.none = drawer.getByText('No accommodations.', { exact: true });
    this.add = button(drawer, 'Add accommodation');
    this.addDialog = dialog(page, 'Add accommodation');
    this.series = field(this.addDialog, 'Series (required)');
    this.kind = this.addDialog.getByRole('radiogroup', { name: 'Extra time as', exact: true });
    this.amount = field(this.addDialog, 'Amount (required)');
    this.save = button(this.addDialog, 'Save accommodation');
  }

  kindOption(name: 'Percentage of the duration' | 'Minutes'): Locator {
    return this.kind.getByRole('radio', { name, exact: true });
  }

  item(text: string): Locator {
    return this.items.filter({ hasText: exactly(text) });
  }

  removeButton(seriesTitle: string): Locator {
    return this.list.getByRole('button', { name: `Remove accommodation for ${seriesTitle}`, exact: true });
  }

  removeDialog(seriesTitle: string): Locator {
    return alertDialog(this.page, `Remove the accommodation for ${seriesTitle}?`);
  }

  /** Fills and saves the Add accommodation dialog (which must be open). */
  async fill(a: { series?: string; kind?: 'Percentage of the duration' | 'Minutes'; amount?: number }): Promise<void> {
    await expect(this.addDialog).toBeVisible();
    if (a.series) await this.series.selectOption({ label: a.series });
    if (a.kind) await this.kindOption(a.kind).check();
    if (a.amount !== undefined) await this.amount.fill(String(a.amount));
    await this.save.click();
  }
}

/** The screen a reset attempt shows on /exam/?attempt= and /exam/submitted/?attempt=. */
export class ResetAttemptScreen {
  readonly heading: Locator;
  readonly back: Locator;

  constructor(readonly page: Page) {
    const main = page.getByRole('main');
    this.heading = main.getByRole('heading', { level: 1, name: 'Your attempt was reset', exact: true });
    this.back = main.getByRole('link', { name: 'Back to your tests', exact: true });
  }

  text(t: string): Locator {
    return this.page.getByRole('main').getByText(t, { exact: true });
  }
}
