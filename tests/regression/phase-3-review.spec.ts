import type { Locator, Page } from '@playwright/test';
import { openExam } from '../acceptance/fixtures/exam-session';
import { focusedStyle } from '../acceptance/fixtures/layout';
import { expect, test } from '../acceptance/fixtures/test';

// Bugs found by the phase 3 review. Each test failed before its fix.

/**
 * Presses `key` until `target` has focus and returns every focused element that something covered on the way
 * (WCAG 2.2 SC 2.4.11). Losing focus to the page counts as covered too.
 */
async function coveredWhileMoving(page: Page, key: 'Tab' | 'Shift+Tab', target: Locator, max = 30) {
  const covered: string[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    const style = await focusedStyle(page);
    if (!style.unobscured) covered.push(style.description);
    if (await target.evaluate((el) => el === document.activeElement)) return covered;
  }
  throw new Error(`${key} did not reach ${target.toString()} within ${max} presses`);
}

test.describe('phase 3 review @exam', () => {
  test('A11Y-15 A11Y-04 with the palette drawer open, Tab and Shift+Tab never focus a control the drawer covers', async ({
    page,
    signInAs,
    apiAs,
    testApi,
  }) => {
    const { exam } = await openExam({ page, signInAs, apiAs, testApi });
    expect(page.viewportSize()!.width, 'the exam project is below 1,280 px').toBeLessThan(1280);

    await exam.openPalette();
    expect(await coveredWhileMoving(page, 'Tab', exam.saveAndNext), 'covered while tabbing forward').toEqual([]);

    await exam.openPalette();
    expect(
      await coveredWhileMoving(
        page,
        'Shift+Tab',
        exam.banner.getByRole('button', { name: 'Submit test', exact: true }),
      ),
      'covered while tabbing back',
    ).toEqual([]);
  });
});
