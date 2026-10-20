import { expect, type Locator, type Page } from '@playwright/test';
import { pathPattern } from './paths';
import { Shell } from './shell';
import { alertDialog, dialog, field, rowWith, table } from './ui';

// Platform console screens (docs/testids/phase-1.md, "Platform console").

export const SUSPENDED_SIGN_IN =
  "This organization is suspended, so you can't sign in. Ask your placement cell for help.";
export const ARCHIVED_SIGN_IN =
  "This organization is archived, so you can't sign in. Ask your placement cell for help.";

/** The refusal shown on / to people of a suspended or archived organization (ORG-07, DECISIONS Q9). */
export function signInRefusal(page: Page, status: 'suspended' | 'archived'): Locator {
  return page.getByRole('alert').filter({ hasText: status === 'suspended' ? SUSPENDED_SIGN_IN : ARCHIVED_SIGN_IN });
}

export const ORG_ERRORS = {
  nameMissing: "Enter the organization's name.",
  slugTaken: 'This slug is already used by another organization. Choose a different one.',
  adminExists: 'This email is already an admin of this organization.',
  badLimit: 'Enter a whole number, 0 or more.',
} as const;

export const FEATURE_LABELS = {
  ai_question_import: 'AI question import',
  question_pools: 'Question pools',
  sections: 'Sections',
  negative_marking: 'Negative marking',
  per_question_timer: 'Per-question timer',
  second_camera: 'Phone as second camera',
  public_leaderboards: 'Leaderboards',
  extra_time_grants: 'Extra time',
  results_export: 'Results export',
  analytics_reports: 'Analytics reports',
} as const;

export const LIMIT_LABELS = {
  max_students: 'Max students',
  max_admins: 'Max admins',
  ai_imports_per_month: 'AI imports per month',
  ai_reports_per_month: 'AI reports per month',
  storage_gb: 'Storage (GB)',
} as const;

export type UsageMeasure =
  'Students' | 'Admins' | 'Tests run this month' | 'AI imports this month' | 'Analytics reports this month' | 'Storage';

export class OrganizationsPage {
  readonly shell: Shell;
  readonly newOrganization: Locator;
  readonly list: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    this.newOrganization = this.shell.main
      .getByRole('link', { name: 'New organization', exact: true })
      .or(this.shell.main.getByRole('button', { name: 'New organization', exact: true }));
    this.list = table(this.shell.main, 'Organizations');
  }

  async goto(): Promise<void> {
    await this.page.goto('/platform/');
    await expect(this.shell.heading('Organizations')).toBeVisible();
  }

  row(orgName: string): Locator {
    return this.list.getByRole('row').filter({ has: this.page.getByRole('link', { name: orgName, exact: true }) });
  }

  /** The Status cell of an organization's row. */
  status(orgName: string): Locator {
    return this.row(orgName).getByRole('cell', { name: /^(Active|Suspended|Archived)$/ });
  }

  async openOrg(orgName: string): Promise<OrgDetailPage> {
    await this.row(orgName).getByRole('link', { name: orgName, exact: true }).click();
    const detail = new OrgDetailPage(this.page);
    await expect(this.page).toHaveURL(/\/platform\/org\/\?id=/);
    await expect(detail.shell.heading(orgName)).toBeVisible();
    return detail;
  }

  async startNewOrganization(): Promise<OrgForm> {
    await this.newOrganization.click();
    const form = new OrgForm(this.page);
    await expect(form.heading).toBeVisible();
    return form;
  }
}

export class OrgForm {
  readonly shell: Shell;
  readonly heading: Locator;
  readonly name: Locator;
  readonly slug: Locator;
  readonly timezone: Locator;
  readonly logo: Locator;
  readonly departments: Locator;
  readonly footer: Locator;
  readonly discard: Locator;
  readonly create: Locator;
  readonly unsaved: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    this.heading = this.shell.heading('New organization');
    const main = this.shell.main;
    this.name = field(main, 'Name (required)');
    this.slug = field(main, 'URL slug (required)');
    this.timezone = field(main, 'Timezone (required)');
    this.logo = field(main, 'Logo');
    this.departments = field(main, 'Departments');
    this.footer = page.getByRole('region', { name: 'Form actions', exact: true });
    this.discard = this.footer.getByRole('button', { name: 'Discard', exact: true });
    this.create = this.footer.getByRole('button', { name: 'Create organization', exact: true });
    this.unsaved = this.footer.getByRole('status').filter({ hasText: 'Unsaved changes' });
  }

  async fill(input: {
    name: string;
    slug: string;
    timezone?: string;
    departments?: string[];
    logo?: { name: string; mimeType: string; buffer: Buffer };
  }): Promise<void> {
    await this.name.fill(input.name);
    await this.slug.fill(input.slug);
    if (input.timezone) await this.timezone.selectOption(input.timezone);
    if (input.departments) await this.departments.fill(input.departments.join('\n'));
    if (input.logo) await this.logo.setInputFiles(input.logo);
  }
}

export class OrgDetailPage {
  readonly shell: Shell;
  readonly status: Locator;
  readonly editDetails: Locator;
  readonly moreActions: Locator;
  readonly admins: Locator;
  readonly addAdmin: Locator;
  readonly saveEntitlements: Locator;
  readonly entitlementsSaved: Locator;
  readonly usage: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    const main = this.shell.main;
    this.status = main.getByTestId('org-status');
    this.editDetails = main.getByRole('button', { name: 'Edit details', exact: true });
    this.moreActions = main.getByRole('button', { name: 'More actions', exact: true });
    this.admins = table(main, 'Admins');
    this.addAdmin = main.getByRole('button', { name: 'Add admin', exact: true });
    this.saveEntitlements = main.getByRole('button', { name: 'Save features and limits', exact: true });
    this.entitlementsSaved = page.getByRole('status').filter({ hasText: 'Features and limits saved' });
    this.usage = table(main, 'Usage');
  }

  async goto(orgId: string, orgName: string): Promise<void> {
    await this.page.goto(`/platform/org/?id=${encodeURIComponent(orgId)}`);
    await expect(this.shell.heading(orgName)).toBeVisible();
  }

  /** An item of the `More actions` menu (open the menu first). */
  menuItem(name: 'Suspend organization' | 'Archive organization' | 'Restore organization'): Locator {
    return this.page.getByRole('menuitem', { name, exact: true });
  }

  editDialog(): Locator {
    return dialog(this.page, 'Edit details');
  }

  /** Opens `Edit details`, checks the current name, saves a new one and waits for the dialog to close. */
  async editName(current: string, next: string): Promise<void> {
    await this.editDetails.click();
    const edit = this.editDialog();
    await expect(edit).toBeVisible();
    await expect(field(edit, 'Name (required)')).toHaveValue(current);
    await field(edit, 'Name (required)').fill(next);
    await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(edit).toBeHidden();
  }

  section(name: 'Admins' | 'Features and limits' | 'Usage'): Locator {
    return this.shell.main.getByRole('heading', { level: 2, name, exact: true });
  }

  logo(orgName: string): Locator {
    return this.shell.main.getByRole('img', { name: `${orgName} logo`, exact: true });
  }

  feature(label: string): Locator {
    return this.shell.main.getByRole('switch', { name: label, exact: true });
  }

  limit(label: string): Locator {
    return this.shell.main.getByRole('spinbutton', { name: label, exact: true });
  }

  adminRow(email: string): Locator {
    return rowWith(this.admins, email);
  }

  /** A usage row by its measure (row header) name. */
  usageRow(measure: UsageMeasure): Locator {
    return this.usage
      .getByRole('row')
      .filter({ has: this.page.getByRole('rowheader', { name: measure, exact: true }) })
      .or(this.usage.getByRole('row').filter({ has: this.page.getByRole('cell', { name: measure, exact: true }) }));
  }

  /** Suspend, archive or restore through the overflow menu and its confirmation dialog. */
  async changeStatus(
    action: 'Suspend organization' | 'Archive organization' | 'Restore organization',
    orgName: string,
  ): Promise<void> {
    await this.moreActions.click();
    await this.page.getByRole('menuitem', { name: action, exact: true }).click();
    const verb = action.split(' ')[0]!;
    const confirm = alertDialog(this.page, `${verb} ${orgName}?`);
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: action, exact: true }).click();
    await expect(confirm).toBeHidden();
  }

  addAdminDialog(): Locator {
    return dialog(this.page, 'Add admin');
  }

  async addAdminByEmail(email: string, name?: string): Promise<Locator> {
    await this.addAdmin.click();
    const dlg = this.addAdminDialog();
    await expect(dlg).toBeVisible();
    await field(dlg, 'Email (required)').fill(email);
    if (name) await field(dlg, 'Name').fill(name);
    await dlg.getByRole('button', { name: 'Add admin', exact: true }).click();
    return dlg;
  }

  /** Opens the row menu of an admin, chooses `Remove admin` and returns the confirmation dialog. */
  async openRemoveAdmin(email: string): Promise<Locator> {
    await this.adminRow(email)
      .getByRole('button', { name: `Actions for ${email}`, exact: true })
      .click();
    await this.page.getByRole('menuitem', { name: 'Remove admin', exact: true }).click();
    const confirm = alertDialog(this.page, `Remove ${email}?`);
    await expect(confirm).toBeVisible();
    return confirm;
  }

  async removeAdmin(email: string): Promise<void> {
    const confirm = await this.openRemoveAdmin(email);
    await confirm.getByRole('button', { name: 'Remove admin', exact: true }).click();
    await expect(confirm).toBeHidden();
  }
}

/** The page the browser lands on is an organization's detail page. */
export async function expectOrgDetail(page: Page, orgName: string): Promise<OrgDetailPage> {
  const detail = new OrgDetailPage(page);
  await expect(page).toHaveURL(/\/platform\/org\/\?id=[^&]+/);
  await expect(detail.shell.heading(orgName)).toBeVisible();
  return detail;
}

/** The platform home path. */
export const PLATFORM_HOME = pathPattern('/platform/');
