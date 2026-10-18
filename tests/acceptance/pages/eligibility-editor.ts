import { expect, type Locator, type Page } from '@playwright/test';
import { button, count, dataRows, dialog, exactly, field, table } from './ui';

// The eligibility editor of the series form and the test Eligibility tab (docs/testids/phase-2.md,
// "Eligibility editor").

export type EligibilityScope = 'series' | 'test';

export const unknownEntryError = (entry: string) => `No student matches ${entry}. Check the email or PRN.`;
export const NARROW_ONLY_NOTE = 'The series rules apply first. These rules can only narrow them.';

/** The live count text, for example `5 students can take this series`. */
export function eligibleCountText(n: number, scope: EligibilityScope): string {
  return `${count(n)} ${n === 1 ? 'student' : 'students'} can take this ${scope}`;
}

export class EligibilityEditor {
  readonly group: Locator;
  readonly departments: Locator;
  readonly years: Locator;
  readonly include: Locator;
  readonly exclude: Locator;
  readonly count: Locator;
  readonly showMatching: Locator;

  constructor(
    readonly page: Page,
    within: Page | Locator,
    readonly scope: EligibilityScope,
  ) {
    this.group = within.getByRole('group', { name: `Students who can take this ${scope}`, exact: true });
    this.departments = this.group.getByRole('group', { name: 'Departments', exact: true });
    this.years = this.group.getByRole('group', { name: 'Graduation years', exact: true });
    this.include = field(this.group, 'Also include');
    this.exclude = field(this.group, 'Exclude');
    this.count = this.group.getByRole('status').filter({ hasText: /can take this/ });
    this.showMatching = button(this.group, 'Show matching students');
  }

  department(name: string): Locator {
    return this.departments.getByRole('checkbox', { name, exact: true });
  }

  year(y: number): Locator {
    return this.years.getByRole('checkbox', { name: String(y), exact: true });
  }

  async expectCount(n: number): Promise<void> {
    await expect(this.count).toHaveText(exactly(eligibleCountText(n, this.scope)));
  }

  matchingDialog(): Locator {
    return dialog(this.page, `Students who can take this ${this.scope}`);
  }

  matchingTable(): Locator {
    return table(this.matchingDialog(), 'Matching students');
  }

  /** Opens the matching list and returns the names in its first column, in display order. */
  async matchingNames(): Promise<string[]> {
    await this.showMatching.click();
    const tbl = this.matchingTable();
    await expect(tbl).toBeVisible();
    const rows = dataRows(tbl);
    await expect(rows.first()).toBeVisible();
    return rows.evaluateAll((rs) =>
      rs.map((r) => (r.querySelector('td, th[scope=row], [role=cell], [role=rowheader]')?.textContent ?? '').trim()),
    );
  }

  async closeMatching(): Promise<void> {
    await button(this.matchingDialog(), 'Close').click();
    await expect(this.matchingDialog()).toBeHidden();
  }
}
