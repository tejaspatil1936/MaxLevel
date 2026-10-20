import { expect, type Locator, type Page } from '@playwright/test';
import { Shell } from './shell';
import { alertDialog, cellIn, dialog, field, table } from './ui';

// /admin/departments/ (docs/testids/phase-1.md, "Departments").

export const DEPARTMENT_EMPTY = {
  sentence: 'No departments yet. Add the departments your students belong to.',
  action: 'Add department',
} as const;
export const DEPARTMENT_EXISTS = 'A department with this name already exists.';
export const inUseText = (n: number) => `Used by ${n} students. Merge or archive it instead.`;

export class DepartmentsPage {
  readonly shell: Shell;
  readonly heading: Locator;
  readonly add: Locator;
  readonly list: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    this.heading = this.shell.heading('Departments');
    this.add = this.shell.main.getByRole('button', { name: 'Add department', exact: true }).first();
    this.list = table(this.shell.main, 'Departments');
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/departments/');
    await expect(this.heading).toBeVisible();
  }

  /** The row whose first cell is exactly this department name. */
  row(name: string): Locator {
    return this.list.getByRole('row').filter({
      has: this.page
        .getByRole('cell', { name, exact: true })
        .or(this.page.getByRole('rowheader', { name, exact: true })),
    });
  }

  async cell(name: string, column: 'Students' | 'Status'): Promise<Locator> {
    return cellIn(this.list, this.row(name), column);
  }

  menuButton(name: string): Locator {
    return this.list.getByRole('button', { name: `Actions for ${name}`, exact: true });
  }

  async openMenu(name: string): Promise<Locator> {
    await this.menuButton(name).click();
    const menu = this.page.getByRole('menu');
    await expect(menu).toBeVisible();
    return menu;
  }

  /** An item of the open row menu. */
  menuItem(item: 'Rename' | 'Merge into another department' | 'Archive' | 'Restore' | 'Delete'): Locator {
    return this.page.getByRole('menu').getByRole('menuitem', { name: item, exact: true });
  }

  async choose(name: string, item: 'Rename' | 'Merge into another department' | 'Archive' | 'Restore' | 'Delete') {
    const menu = await this.openMenu(name);
    await menu.getByRole('menuitem', { name: item, exact: true }).click();
  }

  addDialog(): Locator {
    return dialog(this.page, 'Add department');
  }

  async addDepartment(name: string): Promise<Locator> {
    await this.add.click();
    const dlg = this.addDialog();
    await expect(dlg).toBeVisible();
    await field(dlg, 'Name (required)').fill(name);
    await dlg.getByRole('button', { name: 'Add department', exact: true }).click();
    return dlg;
  }

  async rename(from: string, to: string): Promise<void> {
    await this.choose(from, 'Rename');
    const dlg = dialog(this.page, `Rename ${from}`);
    await expect(dlg).toBeVisible();
    await field(dlg, 'Name (required)').fill(to);
    await dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dlg).toBeHidden();
  }

  async merge(from: string, into: string): Promise<void> {
    await this.choose(from, 'Merge into another department');
    const dlg = dialog(this.page, `Merge ${from}`);
    await expect(dlg).toBeVisible();
    await field(dlg, 'Merge into (required)').selectOption({ label: into });
    await dlg.getByRole('button', { name: 'Merge departments', exact: true }).click();
    await expect(dlg).toBeHidden();
  }

  deleteDialog(name: string): Locator {
    return alertDialog(this.page, `Delete ${name}?`);
  }
}
