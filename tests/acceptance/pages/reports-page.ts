import { expect, type Locator, type Page } from '@playwright/test';
import { REPORT_TEXTS } from '../fixtures/reports';
import { Shell } from './shell';
import { button, cellIn, dataRows, dialog, emptyState, exactly, field, table } from './ui';

// /admin/reports/ and its Generate report dialog (docs/testids/phase-7.md, "Admin screen").

export class ReportsPage {
  static readonly PATH = '/admin/reports/';

  readonly shell: Shell;
  readonly heading: Locator;
  /** The page header's primary action (the first `Generate report` button in main). */
  readonly generate: Locator;
  readonly table: Locator;
  readonly empty: Locator;
  /** Any `Reports used this month: …` text. */
  readonly anyUsage: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    this.heading = this.shell.heading('Reports');
    this.generate = this.shell.main.getByRole('button', { name: 'Generate report', exact: true }).first();
    this.table = table(this.shell.main, 'Reports');
    this.empty = emptyState(this.shell.main);
    this.anyUsage = this.shell.main.getByText(/^\s*Reports used this month: /);
  }

  async goto(): Promise<void> {
    await this.page.goto(ReportsPage.PATH);
    await expect(this.heading).toBeVisible();
  }

  /** `Reports used this month: <used> of <limit>`, exactly. */
  usage(used: number, limit: number): Locator {
    return this.shell.main.getByText(REPORT_TEXTS.usage(used, limit), { exact: true });
  }

  /** A visible text of the page, exactly. */
  text(t: string): Locator {
    return this.shell.main.getByText(t, { exact: true });
  }

  /** A notice (`status`) whose whole text is `t`. */
  notice(t: string): Locator {
    return this.page.getByRole('status').filter({ hasText: exactly(t) });
  }

  get rows(): Locator {
    return dataRows(this.table);
  }

  /** Rows whose `Report` cell is exactly this title, newest first. */
  rowsFor(title: string): Locator {
    return this.rows.filter({ has: this.page.getByRole('cell', { name: title, exact: true }) });
  }

  /** Rows whose `Requested by` cell is exactly this name or email. */
  rowsRequestedBy(who: string): Locator {
    return this.rows.filter({ has: this.page.getByRole('cell', { name: who, exact: true }) });
  }

  /** The cell of a row under a column of the `Reports` table. */
  cell(row: Locator, column: string): Promise<Locator> {
    return cellIn(this.table, row, column);
  }

  /** `Download PDF` or `Download XLSX` in a row. */
  download(row: Locator, format: 'PDF' | 'XLSX'): Locator {
    return row.getByRole('link', { name: `Download ${format}`, exact: true });
  }

  /** Presses the header's Generate report and returns the open dialog. */
  async openGenerate(): Promise<GenerateReportDialog> {
    await this.generate.click();
    const dlg = new GenerateReportDialog(this.page);
    await expect(dlg.dialog).toBeVisible();
    return dlg;
  }
}

export class GenerateReportDialog {
  readonly dialog: Locator;
  readonly kind: Locator;
  readonly aTest: Locator;
  readonly aSeries: Locator;
  readonly test: Locator;
  readonly series: Locator;
  readonly xlsx: Locator;
  readonly cancel: Locator;
  readonly submit: Locator;

  constructor(readonly page: Page) {
    this.dialog = dialog(page, 'Generate report');
    this.kind = this.dialog.getByRole('radiogroup', { name: 'Report on', exact: true });
    this.aTest = this.kind.getByRole('radio', { name: 'A test', exact: true });
    this.aSeries = this.kind.getByRole('radio', { name: 'A series', exact: true });
    this.test = field(this.dialog, 'Test (required)');
    this.series = field(this.dialog, 'Series (required)');
    this.xlsx = this.dialog.getByRole('checkbox', { name: 'Include an Excel file of the statistics', exact: true });
    this.cancel = button(this.dialog, 'Cancel');
    this.submit = button(this.dialog, 'Generate report');
  }

  /** The dialog's cost line for this monthly limit. */
  cost(limit: number): Locator {
    return this.dialog.getByText(REPORT_TEXTS.cost(limit), { exact: true });
  }

  /** The `alert` in the dialog saying the month's limit is used up. */
  limitAlert(max: number): Locator {
    return this.dialog.getByRole('alert').filter({ hasText: exactly(REPORT_TEXTS.limitReached(max)) });
  }

  /** Fills the dialog for a test (by its option label) or a series (by title), and presses Generate report. */
  async generate(what: { test: string } | { series: string }, opts: { xlsx?: boolean } = {}): Promise<void> {
    if ('test' in what) {
      await this.aTest.check();
      await this.test.selectOption({ label: what.test });
    } else {
      await this.aSeries.check();
      await this.series.selectOption({ label: what.series });
    }
    if (opts.xlsx) await this.xlsx.check();
    await this.submit.click();
  }
}
