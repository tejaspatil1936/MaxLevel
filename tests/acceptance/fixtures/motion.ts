import type { Page } from '@playwright/test';

/** Largest value in a computed duration list such as "0.12s, 0s" or "200ms", in milliseconds. */
export function maxDurationMs(value: string): number {
  return Math.max(
    0,
    ...value.split(',').map((part) => {
      const p = part.trim();
      if (p.endsWith('ms')) return Number(p.slice(0, -2));
      if (p.endsWith('s')) return Number(p.slice(0, -1)) * 1000;
      return Number.NaN;
    }),
  );
}

/**
 * Every element or rendered ::before / ::after on the page whose computed transition-duration, or whose running
 * animation's animation-duration, is not exactly 0s. Returns readable descriptions; an empty list means all motion is
 * instant (UI-12).
 */
export async function nonInstantMotion(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const notZero = (v: string) => v.split(',').some((p) => p.trim() !== '0s');
    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : '';
      const cls =
        typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
      return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 120);
    };
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      for (const pseudo of [null, '::before', '::after'] as const) {
        const cs = getComputedStyle(el, pseudo);
        if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
        const where = `${describe(el)}${pseudo ?? ''}`;
        if (notZero(cs.transitionDuration)) out.push(`${where} transition-duration ${cs.transitionDuration}`);
        if (cs.animationName !== 'none' && notZero(cs.animationDuration))
          out.push(`${where} animation-duration ${cs.animationDuration}`);
      }
    }
    return out;
  });
}
