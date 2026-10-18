import { describe, expect, it } from 'vitest';
import { installLockdown, isDevtoolsShortcut, isPrintShortcut, type LockdownDeps } from './lockdown';

type Policy = LockdownDeps['devtoolsPolicy'];

const keys = (
  key: string,
  mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {},
  code = '',
) => ({
  key,
  code: code || (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key),
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: !!mods.meta,
});

function harness(over: { fullscreenRequired?: boolean; devtoolsPolicy?: Policy } = {}) {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
    fullscreenElement: null as Element | null,
  });
  const reports: Array<{ type: string; details?: Record<string, unknown> }> = [];
  const stop = installLockdown({
    win: win as unknown as LockdownDeps['win'],
    doc: doc as unknown as LockdownDeps['doc'],
    report: (type, details) => reports.push({ type, details }),
    fullscreenRequired: over.fullscreenRequired ?? true,
    devtoolsPolicy: over.devtoolsPolicy ?? 'block_strike',
  });
  /** Dispatches a cancelable event; true when the lockdown prevented it. */
  const fire = (target: EventTarget, type: string, props: object = {}) =>
    !target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), props));
  return { win, doc, reports, stop, fire, types: () => reports.map((r) => r.type) };
}

describe('lockdown shortcuts', () => {
  it('PR-06 names the developer tools keys of the contract, and nothing else', () => {
    expect(isDevtoolsShortcut(keys('F12'))).toBe(true);
    for (const k of ['I', 'J', 'C']) expect(isDevtoolsShortcut(keys(k, { ctrl: true, shift: true }))).toBe(true);
    expect(isDevtoolsShortcut(keys('u', { ctrl: true }))).toBe(true);
    expect(isDevtoolsShortcut(keys('ˆ', { meta: true, alt: true }, 'KeyI'))).toBe(true);
    expect(isDevtoolsShortcut(keys('c', { ctrl: true }))).toBe(false);
    expect(isDevtoolsShortcut(keys('i'))).toBe(false);
    expect(isDevtoolsShortcut(keys('u', { ctrl: true, alt: true }))).toBe(false);
  });

  it('PR-06 names Ctrl+P and Cmd+P as the print shortcut', () => {
    expect(isPrintShortcut(keys('p', { ctrl: true }))).toBe(true);
    expect(isPrintShortcut(keys('P', { meta: true, shift: true }))).toBe(true);
    expect(isPrintShortcut(keys('p'))).toBe(false);
  });
});

describe('lockdown', () => {
  it('PR-04 leaving fullscreen reports fullscreen_exit when fullscreen is required; entering it reports nothing', () => {
    const h = harness();
    h.doc.fullscreenElement = {} as Element;
    h.fire(h.doc, 'fullscreenchange');
    expect(h.types()).toEqual([]);
    h.doc.fullscreenElement = null;
    h.fire(h.doc, 'fullscreenchange');
    expect(h.types()).toEqual(['fullscreen_exit']);

    const free = harness({ fullscreenRequired: false });
    free.fire(free.doc, 'fullscreenchange');
    expect(free.types()).toEqual([]);
  });

  it('PR-05 a hidden page reports tab_hidden and the window losing focus reports window_blur', () => {
    const h = harness();
    h.fire(h.win, 'blur');
    h.doc.visibilityState = 'hidden';
    h.fire(h.doc, 'visibilitychange');
    h.doc.visibilityState = 'visible';
    h.fire(h.doc, 'visibilitychange');
    h.fire(h.win, 'focus');
    expect(h.types()).toEqual(['window_blur', 'tab_hidden']);
  });

  it('PR-06 under block_strike and block, developer tools keys are prevented and reported once per press', () => {
    for (const policy of ['block_strike', 'block'] as const) {
      const h = harness({ devtoolsPolicy: policy });
      expect(h.fire(h.win, 'keydown', keys('F12'))).toBe(true);
      expect(h.fire(h.win, 'keydown', { ...keys('I', { ctrl: true, shift: true }), repeat: true })).toBe(true);
      expect(h.reports).toEqual([{ type: 'devtools', details: { key: 'F12', policy } }]);
      expect(h.fire(h.doc, 'contextmenu')).toBe(true);
      expect(h.types()).toEqual(['devtools', 'context_menu']);
    }
  });

  it('PR-06 under allow, developer tools keys and the context menu are left alone', () => {
    const h = harness({ devtoolsPolicy: 'allow' });
    expect(h.fire(h.win, 'keydown', keys('F12'))).toBe(false);
    expect(h.fire(h.doc, 'contextmenu')).toBe(false);
    expect(h.types()).toEqual([]);
  });

  it('PR-06 copy, cut, paste and Ctrl+P are always prevented, without a report', () => {
    for (const policy of ['block_strike', 'allow'] as const) {
      const h = harness({ devtoolsPolicy: policy });
      for (const type of ['copy', 'cut', 'paste']) expect(h.fire(h.doc, type), type).toBe(true);
      expect(h.fire(h.win, 'keydown', keys('p', { ctrl: true }))).toBe(true);
      expect(h.fire(h.win, 'keydown', keys('n'))).toBe(false);
      expect(h.types()).toEqual([]);
    }
  });

  it('PR-04 PR-05 PR-06 stopping removes every listener', () => {
    const h = harness();
    h.stop();
    h.fire(h.win, 'blur');
    h.doc.visibilityState = 'hidden';
    h.fire(h.doc, 'visibilitychange');
    h.fire(h.doc, 'fullscreenchange');
    expect(h.fire(h.doc, 'copy')).toBe(false);
    expect(h.fire(h.win, 'keydown', keys('F12'))).toBe(false);
    expect(h.types()).toEqual([]);
  });
});
