import { expect, type Locator, type Page } from '@playwright/test';
import { dialog } from './ui';

// The accessibility panel opened from every top bar (docs/testids/phase-1.md, "Accessibility panel").

export type TextSize = '100%' | '115%' | '130%' | '150%';
export type Theme = 'Light' | 'Dark' | 'Follow system';
export type Motion = 'On' | 'Off' | 'Follow system';

export const SHEET = { light: 'rgb(243, 245, 247)', dark: 'rgb(15, 19, 38)' } as const;
export const ROOT_FONT_SIZE: Record<TextSize, string> = {
  '100%': '16px',
  '115%': '18.4px',
  '130%': '20.8px',
  '150%': '24px',
};

export class AccessibilityPanel {
  readonly dialog: Locator;
  readonly textSize: Locator;
  readonly theme: Locator;
  readonly highContrast: Locator;
  readonly reduceMotion: Locator;
  readonly increasedSpacing: Locator;
  readonly readingRuler: Locator;
  readonly close: Locator;

  constructor(readonly page: Page) {
    this.dialog = dialog(page, 'Accessibility settings');
    const d = this.dialog;
    this.textSize = d.getByRole('radiogroup', { name: 'Text size', exact: true });
    this.theme = d.getByRole('radiogroup', { name: 'Theme', exact: true });
    this.highContrast = d.getByRole('switch', { name: 'High contrast', exact: true });
    this.reduceMotion = d.getByRole('radiogroup', { name: 'Reduce motion', exact: true });
    this.increasedSpacing = d.getByRole('switch', { name: 'Increased spacing', exact: true });
    this.readingRuler = d.getByRole('switch', { name: 'Reading ruler', exact: true });
    this.close = d.getByRole('button', { name: 'Close', exact: true });
  }

  /** Opens the panel from the top bar's `Accessibility settings` button. */
  async open(opener: Locator): Promise<void> {
    await opener.click();
    await expect(this.dialog).toBeVisible();
  }

  option(group: Locator, name: string): Locator {
    return group.getByRole('radio', { name, exact: true });
  }

  /** Chooses an option and waits for PUT /v1/me/preferences to succeed (A11Y-02). */
  async choose(group: Locator, name: string): Promise<void> {
    const saved = this.waitForSave();
    await this.option(group, name).check();
    await saved;
  }

  async toggle(sw: Locator): Promise<void> {
    const saved = this.waitForSave();
    await sw.click();
    await saved;
  }

  waitForSave(): Promise<unknown> {
    return this.page.waitForResponse(
      (r) => r.request().method() === 'PUT' && /\/v1\/me\/preferences$/.test(new URL(r.url()).pathname) && r.ok(),
    );
  }
}

/** The reading ruler band (decorative, found by test ID). */
export const readingRuler = (page: Page) => page.getByTestId('reading-ruler');

/** Computed root and body styles that the preferences change. */
export async function appearance(page: Page) {
  return page.evaluate(() => {
    const html = getComputedStyle(document.documentElement);
    const body = document.body ? getComputedStyle(document.body) : null;
    const px = (v: string | undefined) => (v && v !== 'normal' ? parseFloat(v) : 0);
    return {
      rootFontSize: html.fontSize,
      rootBackground: html.backgroundColor,
      bodyColor: body?.color ?? '',
      bodyFontSize: px(body?.fontSize),
      letterSpacing: px(body?.letterSpacing),
      wordSpacing: px(body?.wordSpacing),
      lineHeight: px(body?.lineHeight),
    };
  });
}
