import { expect, type Locator, type Page } from '@playwright/test';
import { SHORTCUTS } from '../fixtures/exam';
import { alertDialog, button, dialog } from './ui';

// The exam screen: preview mode, /exam/?preview=<testId> (docs/testids/phase-2.md, "Exam screen in preview"), and
// attempt mode, /exam/?attempt=<attemptId> (docs/testids/phase-3.md, "Exam screen in attempt mode").

/** Palette and track state words (docs/testids/phase-3.md, "Question states"). */
export type QuestionState =
  | 'not visited'
  | 'not answered'
  | 'answered'
  | 'marked for review'
  | 'answered, marked for review'
  | 'answered, locked'
  | 'not answered, locked';

export const LEGEND = [
  'Not visited',
  'Not answered',
  'Answered',
  'Marked for review',
  'Answered and marked for review',
  'Locked',
] as const;

export const PREVIEW_NOTE = 'Preview. No attempt is saved and proctoring is off.';

type SpyWindow = Window & { __proctorCalls?: { media: number; fullscreen: number } };

/**
 * Counts camera and fullscreen requests made by the page (Q-13: proctoring is off in preview). Install before the
 * page loads; read with `proctoringCalls`.
 */
export async function installProctoringSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls = { media: 0, fullscreen: 0 };
    (window as SpyWindow).__proctorCalls = calls;
    const md = navigator.mediaDevices;
    if (md && typeof md.getUserMedia === 'function') {
      const original = md.getUserMedia.bind(md);
      md.getUserMedia = (constraints?: MediaStreamConstraints) => {
        calls.media++;
        return original(constraints);
      };
    }
    const proto = Element.prototype as Element & { requestFullscreen: Element['requestFullscreen'] };
    const originalFs = proto.requestFullscreen;
    proto.requestFullscreen = function (this: Element, options?: FullscreenOptions) {
      calls.fullscreen++;
      return originalFs.call(this, options);
    };
  });
}

export async function proctoringCalls(page: Page): Promise<{ media: number; fullscreen: number }> {
  return page.evaluate(() => (window as SpyWindow).__proctorCalls ?? { media: -1, fullscreen: -1 });
}

/** Makes the window lose focus and the page report itself hidden, as switching tabs would (PR-05 triggers). */
export async function simulateLeavingTheWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
  });
}

export class ExamScreen {
  readonly banner: Locator;
  readonly main: Locator;
  readonly title: Locator;
  readonly previewNote: Locator;
  readonly showAnswers: Locator;
  readonly exitPreview: Locator;
  readonly questionHeading: Locator;
  readonly options: Locator;
  readonly previous: Locator;
  readonly markForReview: Locator;
  readonly clearAnswer: Locator;
  readonly saveAndNext: Locator;
  readonly submit: Locator;
  readonly palette: Locator;
  readonly explanationHeading: Locator;
  /** Any strike warning or blocking overlay (PR-04, PR-09). */
  readonly warnings: Locator;
  readonly syncStatus: Locator;
  readonly timer: Locator;
  readonly announcements: Locator;
  readonly questionTimer: Locator;
  readonly currentSection: Locator;
  readonly track: Locator;
  readonly paletteToggle: Locator;
  readonly legend: Locator;
  readonly legendSamples: Locator;
  readonly shortcuts: Locator;
  readonly summary: Locator;
  readonly reconnect: Locator;
  readonly cameraToggle: Locator;
  readonly video: Locator;

  constructor(readonly page: Page) {
    this.banner = page.getByRole('banner');
    this.main = page.getByRole('main');
    this.title = this.banner.getByRole('heading', { level: 1 });
    this.previewNote = page.getByText(PREVIEW_NOTE, { exact: true });
    this.showAnswers = page.getByRole('switch', { name: 'Show answers', exact: true });
    this.exitPreview = page.getByRole('link', { name: 'Exit preview', exact: true });
    this.questionHeading = this.main.getByRole('heading', { level: 2, name: /^Question \d+ of \d+$/ });
    this.options = this.main.getByRole('radiogroup', { name: 'Answer options', exact: true });
    this.previous = button(page, 'Previous');
    this.markForReview = button(page, 'Mark for review');
    this.clearAnswer = button(page, 'Clear answer');
    this.saveAndNext = button(page, 'Save and next');
    this.submit = button(page, 'Submit test');
    this.palette = page.getByRole('navigation', { name: 'Question palette', exact: true });
    this.explanationHeading = this.main.getByRole('heading', { level: 3, name: 'Explanation', exact: true });
    this.warnings = page.getByRole('alertdialog');
    this.syncStatus = this.banner.getByRole('status', { name: 'Sync status', exact: true });
    this.timer = this.banner.getByRole('timer', { name: 'Time left', exact: true });
    this.announcements = this.banner.getByRole('status', { name: 'Time announcements', exact: true });
    this.questionTimer = this.main.getByRole('timer', { name: 'Time left for this question', exact: true });
    this.currentSection = this.main.getByTestId('current-section');
    this.track = page.getByRole('navigation', { name: 'Timing track', exact: true });
    this.paletteToggle = page.getByRole('button', { name: 'Question palette', exact: true });
    this.legend = this.palette.getByRole('list', { name: 'Palette legend', exact: true });
    this.legendSamples = this.legend.getByTestId('legend-sample');
    this.shortcuts = dialog(page, 'Keyboard shortcuts');
    this.summary = alertDialog(page, 'Submit test?');
    this.reconnect = dialog(page, 'Reconnect your phone');
    this.cameraToggle = page.getByRole('button', { name: 'Camera preview', exact: true });
    this.video = page.locator('video');
  }

  static attemptUrl(attemptId: string): string {
    return `/exam/?attempt=${encodeURIComponent(attemptId)}`;
  }

  /** Opens an attempt directly (the resume path, EX-05) and waits for its first question. */
  async gotoAttempt(attemptId: string, title?: string): Promise<void> {
    await this.page.goto(ExamScreen.attemptUrl(attemptId));
    await this.expectAttemptOpen(title);
  }

  async expectAttemptOpen(title?: string): Promise<void> {
    if (title) await expect(this.banner.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(this.questionHeading).toBeVisible();
    await expect(this.timer).toBeVisible();
  }

  /** The strike tally text, for example `Strikes 1 of 3`. */
  strikeTally(n: number, max: number): Locator {
    return this.banner.getByText(`Strikes ${n} of ${max}`, { exact: true });
  }

  phoneStatus(text: 'Phone connected' | 'Phone disconnected' | 'Phone status unavailable'): Locator {
    return this.banner.getByText(text, { exact: true });
  }

  /** A timing-track button by question number, whatever its state. */
  trackButton(n: number): Locator {
    return this.track.getByRole('button', { name: new RegExp(`^Question ${n}, `) });
  }

  /** A palette button by question number, whatever its state. */
  paletteButton(n: number): Locator {
    return this.palette.getByRole('button', { name: new RegExp(`^Question ${n}, `) });
  }

  /** The track button of question n in this exact state. */
  trackState(n: number, state: QuestionState): Locator {
    return this.track.getByRole('button', { name: `Question ${n}, ${state}`, exact: true });
  }

  paletteState(n: number, state: QuestionState): Locator {
    return this.palette.getByRole('button', { name: `Question ${n}, ${state}`, exact: true });
  }

  /** Both the track and the palette show question n in this state (A11Y-08). */
  async expectState(n: number, state: QuestionState): Promise<void> {
    await expect(this.trackState(n, state), `track: question ${n} ${state}`).toHaveCount(1);
    await expect(this.paletteState(n, state), `palette: question ${n} ${state}`).toHaveCount(1);
  }

  /** A section's group of palette buttons (sectioned tests). */
  paletteSection(name: string): Locator {
    return this.palette.getByRole('group', { name, exact: true });
  }

  /** Opens the palette: as a drawer below 1,280 px, or does nothing when it is a rail. */
  async openPalette(): Promise<void> {
    if (await this.paletteToggle.isVisible()) {
      if ((await this.paletteToggle.getAttribute('aria-expanded')) !== 'true') await this.paletteToggle.click();
      await expect(this.paletteToggle).toHaveAttribute('aria-expanded', 'true');
    }
    await expect(this.palette).toBeVisible();
  }

  /** Goes to question n with the timing track and waits for its heading. */
  async goToQuestion(n: number, total: number): Promise<void> {
    await this.trackButton(n).click();
    await expect(this.question(n, total)).toBeVisible();
  }

  /** Chooses an option of the current question by its radio name and waits until it is checked. */
  async choose(name: string): Promise<void> {
    await this.option(name).check();
    await expect(this.option(name)).toBeChecked();
  }

  async expectSaved(timeout = 20_000): Promise<void> {
    await expect(this.syncStatus).toHaveText('Saved', { timeout });
  }

  /** The strike warning with this exact title, for example `Strike 1 of 3`. */
  strikeWarning(n: number, max: number): Locator {
    return alertDialog(this.page, `Strike ${n} of ${max}`);
  }

  async openShortcuts(): Promise<void> {
    await this.page.keyboard.press('?');
    await expect(this.shortcuts).toBeVisible();
  }

  shortcutItems(): Locator {
    return this.shortcuts.getByRole('listitem');
  }

  static readonly shortcutTexts = SHORTCUTS;

  /** Opens the submit summary from the top bar. */
  async openSummary(): Promise<Locator> {
    await this.banner.getByRole('button', { name: 'Submit test', exact: true }).click();
    await expect(this.summary).toBeVisible();
    return this.summary;
  }

  summaryTable(): Locator {
    return this.summary.getByRole('table', { name: 'Answer summary', exact: true });
  }

  /** The summary's confirm button (inside the dialog, not the top bar's). */
  get confirmSubmit(): Locator {
    return button(this.summary, 'Submit test');
  }

  static previewUrl(testId: string): string {
    return `/exam/?preview=${encodeURIComponent(testId)}`;
  }

  async expectPreviewOpen(title: string): Promise<void> {
    await expect(this.banner.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(this.previewNote).toBeVisible();
    await expect(this.questionHeading).toBeVisible();
  }

  question(n: number, total: number): Locator {
    return this.main.getByRole('heading', { level: 2, name: `Question ${n} of ${total}`, exact: true });
  }

  option(name: string): Locator {
    return this.options.getByRole('radio', { name, exact: true });
  }

  get radios(): Locator {
    return this.options.getByRole('radio');
  }

  /** Text `Correct answer` shown for the correct option while answers are revealed. */
  get correctAnswerText(): Locator {
    return this.options.getByText('Correct answer', { exact: true });
  }

  /** The prompt text shown for the current question, as text in main (the shown fragment must be present). */
  promptText(fragment: string): Locator {
    return this.main.getByText(fragment);
  }

  /** Which of these prompts the current question shows (exactly one must be shown). */
  async shownPrompt(candidates: readonly string[]): Promise<string> {
    await expect(this.questionHeading).toBeVisible();
    const shown: string[] = [];
    for (const c of candidates) if ((await this.main.getByText(c, { exact: true }).count()) > 0) shown.push(c);
    expect(shown, 'prompts shown for the current question').toHaveLength(1);
    return shown[0]!;
  }

  get math(): Locator {
    return this.main.locator('math');
  }

  get texAnnotations(): Locator {
    return this.main.locator('math annotation[encoding="application/x-tex"]');
  }

  explanation(text: string): Locator {
    return this.main.getByText(text, { exact: true });
  }
}
