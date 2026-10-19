import { expect, type Locator, type Page } from '@playwright/test';
import { pathPattern } from './paths';

// The public accessibility statement at /accessibility/ (docs/testids/phase-8.md, "Public accessibility statement").

export const STATEMENT_PATH = '/accessibility/';
export const STATEMENT_LINK_NAME = 'Accessibility statement';
export const STATEMENT_SECTIONS = ['Standard', 'Known gaps', 'Timed exams', 'Contact'] as const;
export type StatementSection = (typeof STATEMENT_SECTIONS)[number];

export class AccessibilityStatementPage {
  readonly main: Locator;
  readonly heading: Locator;
  readonly standard: Locator;
  readonly knownGaps: Locator;
  readonly gapItems: Locator;
  readonly timedExams: Locator;
  readonly contact: Locator;
  readonly contactLinks: Locator;
  /** Every level-2 heading on the page, in document order. */
  readonly sectionHeadings: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1, name: 'Accessibility statement', exact: true });
    this.standard = this.section('Standard');
    this.knownGaps = this.section('Known gaps');
    this.gapItems = this.knownGaps.getByRole('list').getByRole('listitem');
    this.timedExams = this.section('Timed exams');
    this.contact = this.section('Contact');
    this.contactLinks = this.contact.getByRole('link');
    this.sectionHeadings = this.main.getByRole('heading', { level: 2 });
  }

  /** A statement section: a region named by its level-2 heading. */
  section(name: StatementSection): Locator {
    return this.main.getByRole('region', { name, exact: true });
  }

  /** The level-2 heading of a section, inside that section. */
  sectionHeading(name: StatementSection): Locator {
    return this.section(name).getByRole('heading', { level: 2, name, exact: true });
  }

  /** The known-gap list items whose text holds every one of these words (case-insensitive). */
  gapWith(...words: string[]): Locator {
    let items = this.gapItems;
    for (const w of words) items = items.filter({ hasText: new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
    return items;
  }

  async goto(): Promise<void> {
    await this.page.goto(STATEMENT_PATH);
    await this.expectShown();
  }

  /** The statement is on screen at /accessibility/ with its level-1 heading. */
  async expectShown(): Promise<void> {
    await expect(this.page).toHaveURL(pathPattern(STATEMENT_PATH));
    await expect(this.heading).toBeVisible();
  }

  /** The `mailto:` contact link: one link whose accessible name is exactly the address it opens. */
  async expectContactLink(): Promise<string> {
    const link = this.contact.locator('a[href^="mailto:"]').first();
    await expect(link).toBeVisible();
    await expect(link).toHaveRole('link');
    const href = (await link.getAttribute('href')) ?? '';
    const address = href.replace(/^mailto:/, '');
    expect(address, 'contact address (mailto: with no query string)').toMatch(/^[^\s@?]+@[^\s@?]+\.[^\s@?]+$/);
    await expect(link).toHaveAccessibleName(address);
    return address;
  }
}
