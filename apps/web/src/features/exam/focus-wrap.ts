// Keyboard focus stays inside the exam page (PR-05, A11Y-03, WCAG 2.1.1): Tab past the last control would move focus
// to the browser's own toolbar, and the window losing focus is a strike. A focusable guard at each end of the body
// catches that step and sends focus round to the other end, so the window never blurs; a real blur still strikes.
// Open modal dialogs trap focus themselves (Radix FocusScope), so the guards are only reached from the page.

const CANDIDATES = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'iframe',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/** Whether Tab can reach `el`: enabled, not inert or hidden, and, for a radio, the group's stop. */
function tabbable(el: HTMLElement): boolean {
  if (el.tabIndex < 0 || el.hasAttribute('data-focus-wrap')) return false;
  if ((el as HTMLButtonElement).disabled || el.closest('[inert]')) return false;
  if (el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden') return false;
  if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
    const group = Array.from(
      (el.form ?? el.ownerDocument).querySelectorAll<HTMLInputElement>(`input[type="radio"]`),
    ).filter((r) => r.name === el.name && !r.disabled);
    const checked = group.find((r) => r.checked);
    return checked ? checked === el : group[0] === el;
  }
  return true;
}

/** The page's tab stops in tab order (positive tabindex first, then document order). */
export function tabStops(root: ParentNode): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(CANDIDATES)).filter(tabbable);
  const positive = all.filter((el) => el.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex);
  return [...positive, ...all.filter((el) => el.tabIndex === 0)];
}

function guard(doc: Document, end: 'start' | 'end'): HTMLSpanElement {
  const el = doc.createElement('span');
  el.tabIndex = 0;
  el.setAttribute('data-focus-wrap', end);
  // Invisible and out of the layout, like Radix's own focus guards.
  el.style.cssText = 'position:fixed;opacity:0;pointer-events:none;outline:none;width:1px;height:1px;overflow:hidden';
  return el;
}

/** Puts the guards at both ends of the body; returns the function that removes them. */
export function installFocusWrap(doc: Document): () => void {
  const start = guard(doc, 'start');
  const end = guard(doc, 'end');
  const wrap = (to: 'first' | 'last') => () => {
    const stops = tabStops(doc.body);
    const target = to === 'first' ? stops[0] : stops[stops.length - 1];
    target?.focus();
  };
  // Shift+Tab from the first stop lands on the start guard: go to the last stop; Tab from the last, to the first.
  const toLast = wrap('last');
  const toFirst = wrap('first');
  start.addEventListener('focus', toLast);
  end.addEventListener('focus', toFirst);
  doc.body.prepend(start);
  doc.body.append(end);
  return () => {
    start.removeEventListener('focus', toLast);
    end.removeEventListener('focus', toFirst);
    start.remove();
    end.remove();
  };
}
