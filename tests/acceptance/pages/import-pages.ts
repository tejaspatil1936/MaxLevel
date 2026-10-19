import { expect, type Locator, type Page } from '@playwright/test';
import type { ImportFile } from '../fixtures/import-files';
import { IMPORT_TEXTS } from '../fixtures/imports';
import { Shell } from './shell';
import { button, dialog, emptyState, exactly, field } from './ui';

// The upload dialog, the Imports list on the test editor's Questions tab, and the import review page
// /admin/imports/review/?id=<jobId> (docs/testids/phase-6.md, "Admin screens").

export type DraftGroup = 'Need fixing' | 'Ready to approve' | 'Approved' | 'Discarded';
export const DRAFT_GROUPS: readonly DraftGroup[] = ['Need fixing', 'Ready to approve', 'Approved', 'Discarded'];

export type ImportStatusWord =
  'Waiting for upload' | 'Queued' | 'Processing' | 'Waiting to retry' | 'Ready for review' | 'Reviewed' | 'Failed';

export const REVIEW_SHORTCUTS = [
  ['J', 'Next question'],
  ['K', 'Previous question'],
  ['A', 'Approve question'],
  ['E', 'Edit question'],
  ['D', 'Discard question'],
] as const;

const asFile = (f: ImportFile) => ({ name: f.name, mimeType: f.contentType, buffer: f.bytes });

/** `Import questions from a file`, opened from the Questions tab or the review page's empty state. */
export class ImportDialog {
  readonly dialog: Locator;
  readonly formats: Locator;
  readonly file: Locator;
  readonly submit: Locator;
  readonly alert: Locator;

  constructor(readonly page: Page) {
    this.dialog = dialog(page, 'Import questions from a file');
    this.formats = this.dialog.getByText(IMPORT_TEXTS.formats, { exact: true });
    this.file = field(this.dialog, 'File (required)');
    this.submit = button(this.dialog, 'Start import');
    this.alert = this.dialog.getByRole('alert');
  }

  async choose(f: ImportFile): Promise<void> {
    await this.file.setInputFiles(asFile(f));
  }

  /** Chooses the file and presses `Start import`. */
  async startWith(f: ImportFile): Promise<void> {
    await this.choose(f);
    await this.submit.click();
  }
}

/** The phase 6 additions to the test editor's Questions tab panel. */
export class QuestionsTabImports {
  readonly importFromFile: Locator;
  readonly imports: Locator;

  constructor(
    readonly page: Page,
    readonly panel: Locator,
  ) {
    this.importFromFile = button(panel, 'Import from file');
    this.imports = panel.getByRole('list', { name: 'Imports', exact: true });
  }

  async openImport(): Promise<ImportDialog> {
    await this.importFromFile.click();
    const dlg = new ImportDialog(this.page);
    await expect(dlg.dialog).toBeVisible();
    return dlg;
  }

  /** The list items of imports of this file name. */
  importItem(filename: string): Locator {
    return this.imports
      .getByRole('listitem')
      .filter({ has: this.page.getByRole('link', { name: filename, exact: true }) });
  }

  importLink(filename: string): Locator {
    return this.imports.getByRole('link', { name: filename, exact: true });
  }
}

/** One draft on the review page: `article` named `Imported question <n>`. */
export class DraftCard {
  readonly article: Locator;
  readonly heading: Locator;
  readonly reasons: Locator;
  readonly options: Locator;
  readonly approve: Locator;
  readonly edit: Locator;
  readonly discard: Locator;
  // Inline edit form.
  readonly prompt: Locator;
  readonly explanation: Locator;
  readonly difficulty: Locator;
  readonly correctAnswer: Locator;
  readonly save: Locator;
  readonly cancel: Locator;

  constructor(
    readonly page: Page,
    scope: Page | Locator,
    readonly order: number,
  ) {
    this.article = scope.getByRole('article', { name: `Imported question ${order}`, exact: true });
    this.heading = this.article.getByRole('heading', { level: 3, name: `Imported question ${order}`, exact: true });
    this.reasons = this.article.getByRole('list', { name: 'Reasons', exact: true });
    this.options = this.article.getByRole('list', { name: 'Options', exact: true });
    this.approve = button(this.article, `Approve question ${order}`);
    this.edit = button(this.article, `Edit question ${order}`);
    this.discard = button(this.article, `Discard question ${order}`);
    this.prompt = this.article.getByRole('textbox', { name: 'Question text', exact: true });
    this.explanation = this.article.getByRole('textbox', { name: 'Explanation', exact: true });
    this.difficulty = this.article.getByLabel('Difficulty', { exact: true });
    this.correctAnswer = this.article.getByRole('radiogroup', { name: 'Correct answer', exact: true });
    this.save = button(this.article, 'Save changes');
    this.cancel = button(this.article, 'Cancel');
  }

  /** A line of text in the article with exactly this text (`Page 2`, `Correct answer: B`, …). */
  text(t: string): Locator {
    return this.article.getByText(t, { exact: true });
  }

  reasonItems(): Locator {
    return this.reasons.getByRole('listitem');
  }

  optionItem(text: string): Locator {
    return this.options.getByRole('listitem').filter({ hasText: exactly(text) });
  }

  optionField(letter: string): Locator {
    return this.article.getByRole('textbox', { name: `Option ${letter}`, exact: true });
  }

  correctRadio(letter: string): Locator {
    return this.correctAnswer.getByRole('radio', { name: letter, exact: true });
  }

  image(alt: string): Locator {
    return this.article.getByRole('img', { name: alt, exact: true });
  }

  /** Elements that could only come from raw HTML in imported text: scripts, frames, images and event attributes. */
  markupElements(): Locator {
    return this.article.locator('script, iframe, img[src="x"], b[onmouseover], [onerror], [onmouseover], [onload]');
  }

  /** The article is the current draft (`aria-current="true"`). */
  async expectCurrent(): Promise<void> {
    await expect(this.article).toHaveAttribute('aria-current', 'true');
  }
}

export class ImportReviewPage {
  readonly shell: Shell;
  readonly status: Locator;
  readonly progress: Locator;
  readonly progressbar: Locator;
  readonly leaveNote: Locator;
  readonly failed: Locator;
  readonly tryAgain: Locator;
  readonly summary: Locator;
  readonly approveAll: Locator;
  readonly source: Locator;
  readonly highlight: Locator;
  readonly empty: Locator;
  readonly reviewShortcuts: Locator;
  /** Every draft article on the page, in document order. */
  readonly articles: Locator;
  /** The article marked current (`aria-current="true"`). */
  readonly current: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    const main = this.shell.main;
    this.status = main.getByTestId('import-status');
    this.progress = main.getByRole('region', { name: 'Import progress', exact: true });
    this.progressbar = this.progress.getByRole('progressbar', { name: 'Pages processed', exact: true });
    this.leaveNote = this.progress.getByText(IMPORT_TEXTS.leave, { exact: true });
    this.failed = main.getByRole('alert').filter({ hasText: /^\s*The import failed\./ });
    this.tryAgain = button(main, 'Try again');
    this.summary = main.getByRole('list', { name: 'Import summary', exact: true });
    this.approveAll = button(main, 'Approve all valid questions');
    this.source = main.getByRole('region', { name: 'Source page', exact: true });
    this.highlight = this.source.getByTestId('source-highlight');
    this.empty = emptyState(main);
    this.reviewShortcuts = this.shell.shortcuts.getByRole('list', { name: 'Review shortcuts', exact: true });
    this.articles = main.getByRole('article');
    this.current = main.locator('[role="article"][aria-current="true"], article[aria-current="true"]');
  }

  static url(jobId: string): string {
    return `/admin/imports/review/?id=${encodeURIComponent(jobId)}`;
  }

  async goto(jobId: string, filename: string): Promise<void> {
    await this.page.goto(ImportReviewPage.url(jobId));
    await this.expectShown(filename);
  }

  async expectShown(filename: string): Promise<void> {
    await expect(this.heading(filename)).toBeVisible();
  }

  heading(filename: string): Locator {
    return this.shell.heading(`Import: ${filename}`);
  }

  back(testHeading: string): Locator {
    return this.shell.main.getByRole('link', { name: `Back to ${testHeading}`, exact: true });
  }

  progressText(t: string): Locator {
    return this.progress.getByText(t, { exact: true });
  }

  summaryItem(t: string): Locator {
    return this.summary.getByRole('listitem').filter({ hasText: exactly(t) });
  }

  group(name: DraftGroup): Locator {
    return this.shell.main.getByRole('region', { name, exact: true });
  }

  groupHeading(name: DraftGroup): Locator {
    return this.group(name).getByRole('heading', { level: 2, name, exact: true });
  }

  /** A draft anywhere on the page. */
  draft(order: number): DraftCard {
    return new DraftCard(this.page, this.shell.main, order);
  }

  /** A draft inside one group. */
  draftIn(group: DraftGroup, order: number): DraftCard {
    return new DraftCard(this.page, this.group(group), order);
  }

  /** The source page image, `Page <p> of <file name>`. */
  sourceImage(page: number, filename: string): Locator {
    return this.source.getByRole('img', { name: `Page ${page} of ${filename}`, exact: true });
  }

  /** The draft numbers of the articles in one group (or the whole page), in document order. */
  async orders(group?: DraftGroup): Promise<number[]> {
    const scope = group ? this.group(group) : this.shell.main;
    const names = await scope
      .getByRole('article')
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute('aria-label') ?? el.querySelector('h3')?.textContent ?? ''),
      );
    return names.map((n) => Number(n.replace(/^\s*Imported question\s+/, '').trim()));
  }

  notice(text: string): Locator {
    return this.page.getByRole('status').filter({ hasText: exactly(text) });
  }

  /**
   * The highlight's box as fractions of the source image's rendered box (IMP-11), or null while either is not laid
   * out. Read it inside `expect.poll`.
   */
  async highlightFraction(
    page: number,
    filename: string,
  ): Promise<{ x: number; y: number; w: number; h: number } | null> {
    const [img, hl] = await Promise.all([this.sourceImage(page, filename).boundingBox(), this.highlight.boundingBox()]);
    if (!img || !hl || img.width === 0 || img.height === 0) return null;
    return {
      x: (hl.x - img.x) / img.width,
      y: (hl.y - img.y) / img.height,
      w: hl.width / img.width,
      h: hl.height / img.height,
    };
  }

  /** How far the source region's left edge is right of the draft's right edge, in px (null while not laid out). */
  async sourceGapRightOf(card: DraftCard): Promise<number | null> {
    const [c, s] = await Promise.all([card.article.boundingBox(), this.source.boundingBox()]);
    return c && s ? s.x - (c.x + c.width) : null;
  }

  /** Collects the URLs of every request with this method whose path matches, from now on. */
  recordRequests(method: string, path: RegExp): string[] {
    const seen: string[] = [];
    this.page.on('request', (r) => {
      if (r.method() === method && path.test(new URL(r.url()).pathname)) seen.push(r.url());
    });
    return seen;
  }

  /** Resolves with the next response to a request with this method whose path matches. */
  nextResponse(method: string, path: RegExp) {
    return this.page.waitForResponse((r) => r.request().method() === method && path.test(new URL(r.url()).pathname));
  }

  /** Collects the message of every JavaScript dialog (alert, confirm, prompt) the page opens, dismissing each. */
  recordDialogs(): string[] {
    const seen: string[] = [];
    this.page.on('dialog', (d) => {
      seen.push(d.message());
      void d.dismiss();
    });
    return seen;
  }

  /** A global the page's own code never sets; markup that ran would set it. */
  async windowFlag(name: string): Promise<unknown> {
    return this.page.evaluate((n) => (window as unknown as Record<string, unknown>)[n], name);
  }

  /** Marks the current document, so a later check can tell that the page was not reloaded. */
  async markDocument(): Promise<void> {
    await this.page.evaluate(() => {
      (window as unknown as { __importReviewMark?: number }).__importReviewMark = 1;
    });
  }

  async expectSameDocument(): Promise<void> {
    const mark = await this.page.evaluate(
      () => (window as unknown as { __importReviewMark?: number }).__importReviewMark,
    );
    expect(mark, 'the review page updated without a reload').toBe(1);
  }
}

/** The `Import not found` screen (phase 2 not-found convention). */
export class ImportNotFound {
  readonly shell: Shell;
  readonly heading: Locator;
  readonly back: Locator;
  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    this.heading = this.shell.heading('Import not found');
    this.back = this.shell.main.getByRole('link', { name: 'Back to series', exact: true });
  }
  message(orgName: string): Locator {
    return this.shell.main.getByText(`This import doesn't exist in ${orgName}.`, { exact: true });
  }
}
