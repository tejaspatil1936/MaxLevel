import { expect, type Locator, type Page } from '@playwright/test';
import { Shell } from './shell';
import { alertDialog, cellIn, count, dialog, field, rowWith, table } from './ui';

// /admin/whitelist/ and the upload wizard (docs/testids/phase-1.md, "Whitelist", "Upload wizard").

export const WHITELIST_EMPTY = {
  sentence: 'No students yet. Upload your whitelist to let students sign in.',
  action: 'Upload whitelist',
} as const;
export const WHITELIST_NO_MATCH = { sentence: 'No entries match your search.', action: 'Clear search' } as const;
export const WHITELIST_ERRORS = {
  wrongFile: "This file isn't a CSV or XLSX file. Choose a .csv or .xlsx file.",
  invalidEmail: 'Enter a valid email address, like name@college.edu.',
  alreadyListed: 'This email is already on the whitelist.',
} as const;
export const overLimitText = (total: number, max: number) =>
  `This would bring the whitelist to ${count(total)} entries, over your limit of ${count(max)}. Remove some rows or ask the platform team to raise the limit.`;
export const entriesText = (n: number) => (n === 1 ? '1 entry' : `${count(n)} entries`);

export type Status = 'Invited' | 'Registered' | 'Disabled';

export class WhitelistPage {
  readonly shell: Shell;
  readonly heading: Locator;
  readonly upload: Locator;
  readonly addEntry: Locator;
  readonly count: Locator;
  readonly search: Locator;
  readonly statusFilter: Locator;
  readonly list: Locator;
  readonly bulkBar: Locator;
  readonly wizard: UploadWizard;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    const main = this.shell.main;
    this.heading = this.shell.heading('Whitelist');
    this.upload = main.getByRole('button', { name: 'Upload whitelist', exact: true }).first();
    this.addEntry = main.getByRole('button', { name: 'Add entry', exact: true });
    this.count = main.getByTestId('whitelist-count');
    this.search = main.getByRole('searchbox', { name: 'Search by email or PRN', exact: true });
    this.statusFilter = field(main, 'Status');
    this.list = table(main, 'Whitelist');
    this.bulkBar = page.getByRole('toolbar', { name: 'Bulk actions', exact: true });
    this.wizard = new UploadWizard(page);
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/whitelist/');
    await expect(this.heading).toBeVisible();
  }

  row(email: string): Locator {
    return rowWith(this.list, email);
  }

  async statusOf(email: string): Promise<Locator> {
    return cellIn(this.list, this.row(email), 'Status');
  }

  select(email: string): Locator {
    return this.list.getByRole('checkbox', { name: `Select ${email}`, exact: true });
  }

  bulkButton(name: 'Disable' | 'Enable' | 'Export' | 'Remove'): Locator {
    return this.bulkBar.getByRole('button', { name, exact: true });
  }

  removeDialog(n: number): Locator {
    return alertDialog(this.page, n === 1 ? 'Remove 1 entry?' : `Remove ${n} entries?`);
  }

  /** The page-level status shown after saving an upload. */
  added(n: number): Locator {
    return this.page.getByRole('status').filter({ hasText: `Added ${count(n)} entries to the whitelist` });
  }

  async addOne(input: { email: string; prn?: string; note?: string }): Promise<Locator> {
    await this.addEntry.click();
    const dlg = dialog(this.page, 'Add whitelist entry');
    await expect(dlg).toBeVisible();
    await field(dlg, 'Email (required)').fill(input.email);
    if (input.prn) await field(dlg, 'PRN').fill(input.prn);
    if (input.note) await field(dlg, 'Note').fill(input.note);
    await dlg.getByRole('button', { name: 'Add entry', exact: true }).click();
    return dlg;
  }
}

export class UploadWizard {
  readonly dialog: Locator;
  readonly continue: Locator;
  readonly sourceStep: Locator;
  readonly uploadFile: Locator;
  readonly pasteList: Locator;
  readonly file: Locator;
  readonly pasted: Locator;
  readonly mappingStep: Locator;
  readonly emailColumn: Locator;
  readonly prnColumn: Locator;
  readonly noteColumn: Locator;
  readonly preview: Locator;
  readonly reportStep: Locator;
  readonly report: Locator;
  readonly problems: Locator;
  readonly overLimit: Locator;
  readonly save: Locator;

  constructor(readonly page: Page) {
    this.dialog = dialog(page, 'Upload whitelist');
    const d = this.dialog;
    this.continue = d.getByRole('button', { name: 'Continue', exact: true });
    this.sourceStep = d.getByRole('heading', { name: 'Choose a source', exact: true });
    const source = d.getByRole('radiogroup', { name: 'Source', exact: true });
    this.uploadFile = source.getByRole('radio', { name: 'Upload a file', exact: true });
    this.pasteList = source.getByRole('radio', { name: 'Paste a list', exact: true });
    this.file = field(d, 'File (CSV or XLSX)');
    this.pasted = field(d, 'Emails, one per line');
    this.mappingStep = d.getByRole('heading', { name: 'Match columns', exact: true });
    this.emailColumn = field(d, 'Email column (required)');
    this.prnColumn = field(d, 'PRN column');
    this.noteColumn = field(d, 'Note column');
    this.preview = table(d, 'Preview');
    this.reportStep = d.getByRole('heading', { name: 'Check before saving', exact: true });
    this.report = d.getByRole('list', { name: 'Validation report', exact: true });
    this.problems = table(d, 'Problems');
    this.overLimit = d.getByRole('alert').filter({ hasText: /over your limit of/ });
    this.save = d.getByRole('button', { name: 'Save to whitelist', exact: true });
  }

  /** A report line, for example reportLine('Ready to add', 3) is exactly `Ready to add: 3`. */
  reportLine(
    label: 'Ready to add' | 'Invalid emails' | 'Duplicates in the file' | 'Already on the whitelist',
    n: number,
  ) {
    return this.report.getByRole('listitem').filter({ hasText: new RegExp(`^\\s*${label}: ${count(n)}\\s*$`) });
  }

  /** The row of the Preview table with a cell that is exactly this text (case matters: emails are shown as written). */
  previewRow(text: string): Locator {
    return this.preview.getByRole('row').filter({ has: this.page.getByRole('cell', { name: text, exact: true }) });
  }

  /** A row of the Problems table with this email (as written in the file) and problem. */
  problem(email: string, problem: 'Invalid email' | 'Duplicate in the file' | 'Already on the whitelist'): Locator {
    return this.problems
      .getByRole('row')
      .filter({ hasText: email })
      .filter({ has: this.page.getByRole('cell', { name: problem, exact: true }) });
  }

  async open(opener: Locator): Promise<void> {
    await opener.click();
    await expect(this.dialog).toBeVisible();
    await expect(this.sourceStep).toBeVisible();
  }

  /** Step 1 with a file, then on to the column mapping. */
  async chooseFile(path: string): Promise<void> {
    await this.uploadFile.check();
    await this.file.setInputFiles(path);
    await this.continue.click();
    await expect(this.mappingStep).toBeVisible();
  }

  /** Step 2: map the columns by header name (`None` leaves an optional one unmapped), then on to the report. */
  async mapColumns(map: { email: string; prn?: string; note?: string }): Promise<void> {
    await this.emailColumn.selectOption({ label: map.email });
    await this.prnColumn.selectOption({ label: map.prn ?? 'None' });
    await this.noteColumn.selectOption({ label: map.note ?? 'None' });
  }

  async toReport(): Promise<void> {
    await this.continue.click();
    await expect(this.reportStep).toBeVisible();
  }

  /** Step 1 with a pasted list; pasted lists go straight to the report. */
  async paste(lines: string[]): Promise<void> {
    await this.pasteList.check();
    await this.pasted.fill(lines.join('\n'));
    await this.continue.click();
    await expect(this.reportStep).toBeVisible();
  }
}
