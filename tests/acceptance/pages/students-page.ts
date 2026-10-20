import { expect, type Locator, type Page } from '@playwright/test';
import { Shell } from './shell';
import { alertDialog, cellIn, dataRows, dialog, field, table } from './ui';

// /admin/students/ and the student detail drawer (docs/testids/phase-1.md, "Students").

export const STUDENTS_EMPTY = {
  sentence: 'No students yet. Add a student to get started.',
  action: 'Add student',
} as const;
export const STUDENTS_NO_MATCH = { sentence: 'No students match your search.', action: 'Clear search' } as const;
export const STUDENT_ERRORS = {
  prnTaken: 'This PRN already belongs to another student. Check it and try again.',
  emailListed: 'This email is already on the whitelist.',
} as const;
export type StudentColumn = 'Name' | 'Email' | 'PRN' | 'Department' | 'Graduation year' | 'Status';

export interface StudentInput {
  email: string;
  name: string;
  prn: string;
  department: string;
  graduationYear: number;
}

export class StudentsPage {
  readonly shell: Shell;
  readonly heading: Locator;
  readonly add: Locator;
  readonly search: Locator;
  readonly department: Locator;
  readonly graduationYear: Locator;
  readonly status: Locator;
  readonly columns: Locator;
  readonly density: Locator;
  readonly list: Locator;
  readonly rows: Locator;
  readonly bulkBar: Locator;
  readonly skeletons: Locator;
  /** The region marked busy while the list loads (UX-07). */
  readonly busy: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    const main = this.shell.main;
    this.heading = this.shell.heading('Students');
    this.add = main.getByRole('button', { name: 'Add student', exact: true }).first();
    this.search = main.getByRole('searchbox', { name: 'Search by name, email or PRN', exact: true });
    this.department = field(main, 'Department');
    this.graduationYear = field(main, 'Graduation year');
    this.status = field(main, 'Status');
    this.columns = main.getByRole('button', { name: 'Columns', exact: true });
    this.density = main.getByRole('radiogroup', { name: 'Density', exact: true });
    this.list = table(main, 'Students');
    this.rows = dataRows(this.list);
    this.bulkBar = page.getByRole('toolbar', { name: 'Bulk actions', exact: true });
    this.skeletons = main.getByTestId('skeleton');
    this.busy = main.locator('[aria-busy="true"]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/students/');
    await expect(this.heading).toBeVisible();
    await expect(this.rows.first()).toBeVisible();
  }

  /** The row whose name button is exactly this student's full name. */
  row(name: string): Locator {
    return this.list.getByRole('row').filter({ has: this.page.getByRole('button', { name, exact: true }) });
  }

  /** Cells of the table whose whole text is exactly `text`. */
  exactCell(text: string): Locator {
    return this.list.getByRole('cell', { name: text, exact: true });
  }

  nameButton(name: string): Locator {
    return this.list.getByRole('button', { name, exact: true });
  }

  select(name: string): Locator {
    return this.list.getByRole('checkbox', { name: `Select ${name}`, exact: true });
  }

  /** A column-picker choice (open the `Columns` menu first). */
  columnChoice(name: Exclude<StudentColumn, 'Name'>): Locator {
    return this.page.getByRole('menuitemcheckbox', { name, exact: true });
  }

  densityOption(name: 'Comfortable' | 'Compact'): Locator {
    return this.density.getByRole('radio', { name, exact: true });
  }

  columnHeader(name: StudentColumn): Locator {
    return this.list.getByRole('columnheader', { name, exact: true });
  }

  sortButton(name: StudentColumn): Locator {
    return this.columnHeader(name).getByRole('button', { name, exact: true });
  }

  async cell(name: string, column: StudentColumn): Promise<Locator> {
    return cellIn(this.list, this.row(name), column);
  }

  /** Full names of the data rows, in display order. */
  async names(): Promise<string[]> {
    const texts = await this.rows.evaluateAll((rows) =>
      rows.map((r) => {
        const button = Array.from(r.querySelectorAll('button, [role=button]')).find(
          (b) => b.getAttribute('role') !== 'checkbox',
        );
        return (button?.getAttribute('aria-label') ?? button?.textContent ?? '').trim();
      }),
    );
    return texts;
  }

  async openDrawer(name: string): Promise<StudentDrawer> {
    await this.nameButton(name).click();
    const drawer = new StudentDrawer(this.page, name);
    await expect(drawer.dialog).toBeVisible();
    return drawer;
  }

  addDialog(): Locator {
    return dialog(this.page, 'Add student');
  }

  async addStudent(s: StudentInput): Promise<Locator> {
    await this.add.click();
    const dlg = this.addDialog();
    await expect(dlg).toBeVisible();
    await field(dlg, 'Email (required)').fill(s.email);
    await field(dlg, 'Full name (required)').fill(s.name);
    await field(dlg, 'PRN (required)').fill(s.prn);
    await field(dlg, 'Department (required)').selectOption({ label: s.department });
    await field(dlg, 'Graduation year (required)').selectOption({ label: String(s.graduationYear) });
    await dlg.getByRole('button', { name: 'Add student', exact: true }).click();
    return dlg;
  }
}

export class StudentDrawer {
  readonly dialog: Locator;
  readonly profile: Locator;
  readonly attemptsHeading: Locator;
  readonly attempts: Locator;
  readonly noAttempts: Locator;
  readonly history: Locator;
  readonly historyItems: Locator;
  readonly historyHeading: Locator;
  /** The fixed text shown instead of the list when the student has no audit entries. */
  readonly noChanges: Locator;
  readonly editProfile: Locator;
  readonly moreActions: Locator;
  readonly close: Locator;
  readonly save: Locator;

  constructor(
    readonly page: Page,
    readonly name: string,
  ) {
    this.dialog = dialog(page, name);
    const d = this.dialog;
    this.profile = d.getByRole('heading', { name: 'Profile', exact: true });
    this.attemptsHeading = d.getByRole('heading', { name: 'Attempts', exact: true });
    this.attempts = table(d, 'Attempts');
    this.noAttempts = d.getByText('No attempts yet.', { exact: true });
    this.history = d.getByRole('list', { name: 'Change history', exact: true });
    this.historyItems = this.history.getByRole('listitem');
    this.historyHeading = d.getByRole('heading', { name: 'Change history', exact: true });
    this.noChanges = d.getByText('No changes yet.', { exact: true });
    this.editProfile = d.getByRole('button', { name: 'Edit profile', exact: true });
    this.moreActions = d.getByRole('button', { name: 'More actions', exact: true });
    this.close = d.getByRole('button', { name: 'Close', exact: true });
    this.save = d.getByRole('button', { name: 'Save changes', exact: true });
  }

  field(label: string): Locator {
    return field(this.dialog, label);
  }

  async edit(changes: { name?: string; prn?: string; department?: string; graduationYear?: number }): Promise<void> {
    await this.editProfile.click();
    if (changes.name !== undefined) await this.field('Full name (required)').fill(changes.name);
    if (changes.prn !== undefined) await this.field('PRN (required)').fill(changes.prn);
    if (changes.department) await this.field('Department (required)').selectOption({ label: changes.department });
    if (changes.graduationYear)
      await this.field('Graduation year (required)').selectOption({ label: String(changes.graduationYear) });
    await this.save.click();
    await expect(this.save).toBeHidden();
  }

  /** A destructive or status item of the overflow menu, wherever it is shown. */
  actionItem(item: 'Disable student' | 'Enable student' | 'Delete student'): Locator {
    return this.page
      .getByRole('menuitem', { name: item, exact: true })
      .or(this.dialog.getByRole('button', { name: item, exact: true }));
  }

  async chooseAction(item: 'Disable student' | 'Enable student' | 'Delete student'): Promise<void> {
    await this.moreActions.click();
    await this.page.getByRole('menuitem', { name: item, exact: true }).click();
  }

  disableDialog(): Locator {
    return alertDialog(this.page, `Disable ${this.name}?`);
  }

  deleteDialog(): Locator {
    return alertDialog(this.page, `Delete ${this.name}?`);
  }

  typedConfirmation(): Locator {
    return this.deleteDialog().getByRole('textbox', { name: "Type the student's name to confirm", exact: true });
  }
}
