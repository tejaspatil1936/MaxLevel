import { expect, type Locator, type Page } from '@playwright/test';
import { Shell } from './shell';
import { field, table } from './ui';

// /admin/settings/ and the audit logs (/admin/audit/, /platform/audit/) (docs/testids/phase-1.md).

export const REFUSED_PREFIX = "Couldn't save this change.";
export const AUDIT_EMPTY = { sentence: 'No audit entries match these filters.', action: 'Clear filters' } as const;

export class SettingsPage {
  readonly shell: Shell;
  readonly heading: Locator;
  readonly profileLock: Locator;
  readonly refused: Locator;
  readonly features: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    this.heading = this.shell.heading('Settings');
    this.profileLock = this.shell.main.getByRole('switch', { name: 'Lock student profiles', exact: true });
    this.refused = this.shell.main.getByRole('alert').filter({ hasText: REFUSED_PREFIX });
    this.features = this.shell.main.getByRole('list', { name: 'Features', exact: true });
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/settings/');
    await expect(this.heading).toBeVisible();
  }

  section(name: 'Student profiles' | 'Plan and features'): Locator {
    return this.shell.main.getByRole('heading', { level: 2, name, exact: true });
  }

  /** The Features list item of a feature, by its label (as on the platform switches). */
  feature(label: string): Locator {
    return this.features
      .getByRole('listitem')
      .filter({ hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`) });
  }
}

export class AuditPage {
  readonly shell: Shell;
  readonly heading: Locator;
  readonly exportCsv: Locator;
  readonly organization: Locator;
  readonly actor: Locator;
  readonly action: Locator;
  readonly target: Locator;
  readonly from: Locator;
  readonly to: Locator;
  readonly apply: Locator;
  readonly clear: Locator;
  readonly list: Locator;

  constructor(
    readonly page: Page,
    readonly path: '/admin/audit/' | '/platform/audit/' = '/admin/audit/',
  ) {
    this.shell = new Shell(page);
    const main = this.shell.main;
    this.heading = this.shell.heading('Audit log');
    this.exportCsv = main.getByRole('button', { name: 'Export CSV', exact: true });
    this.organization = field(main, 'Organization');
    this.actor = field(main, 'Actor');
    this.action = field(main, 'Action');
    this.target = field(main, 'Target');
    this.from = field(main, 'From');
    this.to = field(main, 'To');
    this.apply = main.getByRole('button', { name: 'Apply filters', exact: true });
    this.clear = main.getByRole('button', { name: 'Clear filters', exact: true }).first();
    this.list = table(main, 'Audit log');
  }

  async goto(): Promise<void> {
    await this.page.goto(this.path);
    await expect(this.heading).toBeVisible();
  }

  /** Data rows that mention this action name. */
  rowsWithAction(action: string): Locator {
    return this.list.getByRole('row').filter({ has: this.page.getByRole('cell', { name: action, exact: true }) });
  }

  /** Data rows that contain this text. */
  rowWith(text: string): Locator {
    return this.rows.filter({ hasText: text });
  }

  /** Every data row of the log. */
  get rows(): Locator {
    return this.list.getByRole('row').filter({ has: this.page.getByRole('cell') });
  }

  async filter(by: {
    organization?: string;
    actor?: string;
    action?: string;
    target?: string;
    from?: string;
    to?: string;
  }) {
    if (by.organization) await this.organization.selectOption({ label: by.organization });
    if (by.actor !== undefined) await this.actor.fill(by.actor);
    if (by.action !== undefined) await this.action.fill(by.action);
    if (by.target !== undefined) await this.target.fill(by.target);
    if (by.from !== undefined) await this.from.fill(by.from);
    if (by.to !== undefined) await this.to.fill(by.to);
    await this.apply.click();
  }
}
