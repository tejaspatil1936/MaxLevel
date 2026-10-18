import { expect, type Locator, type Page } from '@playwright/test';

// Measurements of what a person sees: target sizes (UX-04, A11Y-16), the focus ring (A11Y-04), landmarks and heading
// order (A11Y-07), reflow (UX-12) and the page-header layout (UX-01). Contract: docs/testids/phase-1.md.

/** Visible clickable targets smaller than 44 x 44 CSS px, described for the failure message. */
export async function undersizedTargets(page: Page, min = 44): Promise<string[]> {
  return page.evaluate((minSize) => {
    const selector = [
      'a[href]',
      'button',
      'input:not([type=hidden])',
      'select',
      'textarea',
      'summary',
      '[role=button]',
      '[role=link]',
      '[role=checkbox]',
      '[role=switch]',
      '[role=radio]',
      '[role=tab]',
      '[role=menuitem]',
      '[role=menuitemcheckbox]',
      '[role=menuitemradio]',
      '[role=option]',
    ].join(',');
    const describe = (el: Element) => {
      const name =
        el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 40) ?? el.getAttribute('name') ?? '';
      return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''} "${name}"`;
    };
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (el.closest('[aria-hidden=true], [inert]')) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      // Visually hidden until focused (for example the skip link): clipped away, so not a target yet.
      if (el !== document.activeElement && ((style.clip && style.clip !== 'auto') || style.clipPath !== 'none'))
        continue;
      // Links inside running text are exempt (WCAG 2.5.8 inline exception).
      if (el.tagName === 'A' && el.closest('p')) continue;
      let rect = el.getBoundingClientRect();
      const input = el as HTMLInputElement;
      if (el.tagName === 'INPUT' && (input.type === 'checkbox' || input.type === 'radio') && input.labels?.length) {
        // A native checkbox or radio is clicked through its label too; the larger box is the target.
        const label = Array.from(input.labels)
          .map((l) => l.getBoundingClientRect())
          .sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
        if (label.width * label.height > rect.width * rect.height) rect = label;
      }
      // Visually hidden (sr-only) and off-screen elements are not targets until shown.
      if (rect.width <= 2 || rect.height <= 2) continue;
      if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth) continue;
      if (rect.width + 0.5 < minSize || rect.height + 0.5 < minSize)
        out.push(`${describe(el)} is ${Math.round(rect.width)} x ${Math.round(rect.height)}`);
    }
    return out;
  }, min);
}

export interface FocusStyle {
  outlineStyle: string;
  outlineWidth: string;
  outlineOffset: string;
  outlineColor: string;
  /** The focused element is the topmost element at its centre (not covered by a sticky bar). */
  unobscured: boolean;
  description: string;
}

/** Computed focus ring of the currently focused element, and whether anything covers it. */
export async function focusedStyle(page: Page): Promise<FocusStyle> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body)
      return {
        outlineStyle: '',
        outlineWidth: '',
        outlineOffset: '',
        outlineColor: '',
        unobscured: false,
        description: 'nothing focused',
      };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const cx = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    const label = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 40);
    return {
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineOffset: cs.outlineOffset,
      outlineColor: cs.outlineColor,
      unobscured:
        !!top && (top === el || el.contains(top) || (el as HTMLInputElement).labels?.[0]?.contains(top) === true),
      description: `${el.tagName.toLowerCase()} "${label}"`,
    };
  });
}

/** Presses Tab until `target` has focus, failing after `max` presses. Returns the number of presses. */
export async function tabUntilFocused(page: Page, target: Locator, max = 60): Promise<number> {
  await expect(target).toBeVisible();
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return i;
  }
  throw new Error(`Tab did not reach ${target.toString()} within ${max} presses`);
}

/** Levels of every visible heading (h1 to h6 and role=heading) in document order. */
export async function headingLevels(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role=heading]'))
      .filter((h) => {
        const r = h.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !h.closest('[aria-hidden=true]');
      })
      .map((h) => Number(h.getAttribute('aria-level') ?? h.tagName.slice(1))),
  );
}

/** Fails unless the outline starts at level 1, has one level-1 heading and never skips a level going down. */
export async function expectHeadingOrder(page: Page): Promise<void> {
  const levels = await headingLevels(page);
  expect(levels[0], `first heading level in ${JSON.stringify(levels)}`).toBe(1);
  expect(
    levels.filter((l) => l === 1),
    'level-1 headings',
  ).toHaveLength(1);
  for (let i = 1; i < levels.length; i++)
    expect(levels[i]! - levels[i - 1]!, `heading levels ${JSON.stringify(levels)}`).toBeLessThanOrEqual(1);
}

/** Whether the page scrolls horizontally at the current viewport. */
export async function scrollsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

/** UX-01: the action sits top-right in the page header, level with the level-1 heading. */
export async function expectTopRightOfHeader(main: Locator, heading: Locator, action: Locator): Promise<void> {
  await expect(action).toBeVisible();
  const [m, h, a] = await Promise.all([main.boundingBox(), heading.boundingBox(), action.boundingBox()]);
  expect(m && h && a, 'main, heading and action have boxes').toBeTruthy();
  const centre = (b: { y: number; height: number }) => b.y + b.height / 2;
  expect(Math.abs(centre(a!) - centre(h!)), 'action level with the page heading').toBeLessThanOrEqual(40);
  expect(m!.x + m!.width - (a!.x + a!.width), 'action right edge to main right edge').toBeLessThanOrEqual(64);
  expect(a!.x, 'action right of the heading').toBeGreaterThan(h!.x);
}

/** Bounding box of a locator, failing if it has none. */
export async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(locator).toBeVisible();
  const b = await locator.boundingBox();
  expect(b, `${locator.toString()} has a box`).not.toBeNull();
  return b!;
}

/** Computed style property of the first element of a locator. */
export async function cssOf(locator: Locator, property: string): Promise<string> {
  return locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);
}

/** The ballpoint colour of the focus ring in the light theme (A11Y-04). */
export const BALLPOINT = 'rgb(46, 63, 209)';

/** What is wrong with a focus ring, or nothing (A11Y-04: 2 px solid ballpoint outline, 2 px offset, uncovered). */
export function focusRingProblems(style: FocusStyle): string[] {
  const out: string[] = [];
  if (style.outlineStyle !== 'solid') out.push(`outline-style ${style.outlineStyle}`);
  if (style.outlineWidth !== '2px') out.push(`outline-width ${style.outlineWidth}`);
  if (style.outlineOffset !== '2px') out.push(`outline-offset ${style.outlineOffset}`);
  if (style.outlineColor !== BALLPOINT) out.push(`outline-color ${style.outlineColor}`);
  if (!style.unobscured) out.push('covered by another element');
  return out.length ? [`${style.description}: ${out.join(', ')}`] : [];
}

/** Presses Tab `presses` times and returns every focus-ring problem seen on the way. */
export async function tabAndCheckFocusRing(page: Page, presses: number): Promise<string[]> {
  const problems: string[] = [];
  let seen = 0;
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press('Tab');
    const style = await focusedStyle(page);
    if (style.description === 'nothing focused') continue;
    seen++;
    problems.push(...focusRingProblems(style));
  }
  expect(seen, 'focusable elements reached by Tab').toBeGreaterThan(5);
  return problems;
}
