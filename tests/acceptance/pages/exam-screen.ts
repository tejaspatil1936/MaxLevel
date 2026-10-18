import { expect, type Locator, type Page } from '@playwright/test';
import { button } from './ui';

// The exam screen in preview mode, /exam/?preview=<testId> (docs/testids/phase-2.md, "Exam screen in preview").

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
