import { expect, type Locator, type Page } from '@playwright/test';
import { expectHeadingOrder, scrollsHorizontally, undersizedTargets } from '../fixtures/layout';
import { pathPattern } from './paths';
import { dialog } from './ui';

// The admin workspace and platform console shell, and the student top bar (docs/testids/phase-1.md, "Shared shell",
// "Command palette and shortcuts", "Organization switcher", "Student top bar").

export const ADMIN_LINKS = {
  Overview: '/admin/',
  Whitelist: '/admin/whitelist/',
  Students: '/admin/students/',
  Departments: '/admin/departments/',
  Reports: '/admin/reports/',
  'Audit log': '/admin/audit/',
  Settings: '/admin/settings/',
} as const;
export type AdminSection = keyof typeof ADMIN_LINKS;

export const PLATFORM_LINKS = { Organizations: '/platform/', 'Audit log': '/platform/audit/' } as const;

/** FF-03: the one-line explanation a locked feature shows. */
export const NOT_INCLUDED = "Not included in your organization's plan";

export const ARCHIVED_WORKSPACE_NOTICE = 'This organization is archived. You can view its data but not change it.';

export class Shell {
  readonly skipLink: Locator;
  readonly banner: Locator;
  readonly nav: Locator;
  readonly main: Locator;
  readonly h1: Locator;
  readonly accessibilityButton: Locator;
  readonly switcher: Locator;
  /** A switcher placed inside the `Main` navigation (the contract puts it outside, above it). */
  readonly switcherInsideNav: Locator;
  readonly palette: Locator;
  readonly paletteInput: Locator;
  readonly shortcuts: Locator;
  readonly archivedNotice: Locator;

  constructor(readonly page: Page) {
    this.skipLink = page.getByRole('link', { name: 'Skip to main content', exact: true });
    this.banner = page.getByRole('banner');
    this.nav = page.getByRole('navigation', { name: 'Main', exact: true });
    this.main = page.getByRole('main');
    this.h1 = this.main.getByRole('heading', { level: 1 });
    this.accessibilityButton = this.banner.getByRole('button', { name: 'Accessibility settings', exact: true });
    this.switcher = page.getByRole('button', { name: /switch organization/i });
    this.switcherInsideNav = page
      .getByRole('navigation', { name: 'Main', exact: true })
      .getByRole('button', { name: /switch organization/i });
    this.palette = dialog(page, 'Command palette');
    this.paletteInput = this.palette.getByRole('combobox', { name: 'Search students, pages and actions', exact: true });
    this.shortcuts = dialog(page, 'Keyboard shortcuts');
    this.archivedNotice = this.main.getByText(ARCHIVED_WORKSPACE_NOTICE, { exact: true });
  }

  navLink(name: string): Locator {
    return this.nav.getByRole('link', { name, exact: true });
  }

  /** ORG-12: the persistent notice naming the organization a super admin works in. */
  workspaceNotice(orgName: string): Locator {
    return this.banner.getByText(`Working in ${orgName}`, { exact: true });
  }

  /** Any `Working in …` notice. */
  get anyWorkspaceNotice(): Locator {
    return this.banner.getByText(/^Working in /);
  }

  /** The page's level-1 heading with this exact text. */
  heading(name: string): Locator {
    return this.main.getByRole('heading', { level: 1, name, exact: true });
  }

  /** Opens an admin section from the sidebar and waits for its heading. */
  async goToAdmin(section: AdminSection, heading: string = section): Promise<void> {
    await this.navLink(section).click();
    await expect(this.page).toHaveURL(pathPattern(ADMIN_LINKS[section]));
    await expect(this.heading(heading)).toBeVisible();
  }

  /** Opens a path directly and waits for its heading. */
  async open(path: string, heading: string): Promise<void> {
    await this.page.goto(path);
    await expect(this.heading(heading)).toBeVisible();
  }

  /** A choice of the open switcher menu: `Platform` or an organization's name. */
  switchChoice(choice: string): Locator {
    return this.page.getByRole('menuitem', { name: choice, exact: true });
  }

  /** ORG-09: a super admin chooses an organization (or `Platform`) in the sidebar switcher. */
  async switchTo(choice: string): Promise<void> {
    await expect(this.switcher).toBeVisible();
    await this.switcher.click();
    await this.switchChoice(choice).click();
  }

  /** Enters an organization's admin workspace and waits for its Overview and the workspace notice. */
  async enterOrg(orgName: string): Promise<void> {
    await this.switchTo(orgName);
    await expect(this.page).toHaveURL(pathPattern('/admin/'));
    await expect(this.heading('Overview')).toBeVisible();
    await expect(this.workspaceNotice(orgName)).toBeVisible();
  }

  async openPalette(): Promise<void> {
    await this.page.keyboard.press('Control+K');
    await expect(this.palette).toBeVisible();
    await expect(this.paletteInput).toBeFocused();
  }

  /** A palette result by exact name. */
  paletteOption(name: string): Locator {
    return this.palette.getByRole('option', { name, exact: true });
  }

  /** Types into the palette and chooses the option with this exact name. */
  async paletteChoose(query: string, option: string): Promise<void> {
    await this.paletteInput.fill(query);
    const opt = this.palette.getByRole('option', { name: option, exact: true });
    await expect(opt).toBeVisible();
    await opt.click();
    await expect(this.palette).toBeHidden();
  }

  async openShortcuts(): Promise<void> {
    await this.page.keyboard.press('?');
    await expect(this.shortcuts).toBeVisible();
  }
}

export class StudentShell {
  readonly banner: Locator;
  readonly main: Locator;
  readonly accessibilityButton: Locator;
  readonly accountMenu: Locator;
  readonly shortcuts: Locator;

  constructor(readonly page: Page) {
    this.banner = page.getByRole('banner');
    this.main = page.getByRole('main');
    this.accessibilityButton = this.banner.getByRole('button', { name: 'Accessibility settings', exact: true });
    this.accountMenu = this.banner.getByRole('button', { name: 'Account menu', exact: true });
    this.shortcuts = dialog(page, 'Keyboard shortcuts');
  }

  menuItem(name: 'Profile' | 'Switch organization' | 'Sign out'): Locator {
    return this.page.getByRole('menuitem', { name, exact: true });
  }

  async choose(name: 'Profile' | 'Switch organization' | 'Sign out'): Promise<void> {
    await this.accountMenu.click();
    await this.menuItem(name).click();
  }
}

/**
 * The shell rules every admin and platform page meets (A11Y-07, UX-04, A11Y-16, UX-12): one banner, one `Main`
 * navigation, one main landmark, a heading outline without skipped levels, no target under 44 x 44 px, and no
 * horizontal page scroll at 768 px.
 */
export async function expectShellRules(page: Page, where: string): Promise<void> {
  const shell = new Shell(page);
  await expect(shell.banner, `banner on ${where}`).toHaveCount(1);
  await expect(shell.nav, `Main navigation on ${where}`).toHaveCount(1);
  await expect(shell.main, `main on ${where}`).toHaveCount(1);
  await expectHeadingOrder(page);
  expect(await undersizedTargets(page), `small targets on ${where}`).toEqual([]);
  const size = page.viewportSize();
  await page.setViewportSize({ width: 768, height: size?.height ?? 800 });
  await expect(shell.h1).toBeVisible();
  expect(await scrollsHorizontally(page), `horizontal page scroll on ${where} at 768 px`).toBe(false);
  if (size) await page.setViewportSize(size);
}
