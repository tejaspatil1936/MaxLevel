import type { AttemptEventDetails, Settings } from '@mitaoe/shared';
import type { ClientEventType } from './proctor-events';

// Browser lockdown on the exam screen (spec 7.7, PR-04 to PR-06; docs/testids/phase-3.md "Strike warnings and
// lockdown"). It listens to the browser's own events and reports through the proctoring reporter, which decides the
// warnings; the server decides the count. Focus is read from the `blur` and `visibilitychange` events, never by polling
// `document.hasFocus()`. Copy, cut, paste and the print shortcut are always blocked; the selection and printed page are
// handled by the exam screen's styles.

type Keys = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>;

/** The letter a key event names, by physical key when known (macOS Option changes `key`). */
const letter = (e: Keys) => (/^Key[A-Z]$/.test(e.code ?? '') ? e.code.slice(3) : e.key).toLowerCase();

/**
 * The developer tools shortcuts (PR-06): F12, Ctrl+Shift+I, J or C and Ctrl+U, with the macOS Cmd+Option forms.
 */
export function isDevtoolsShortcut(e: Keys): boolean {
  if (e.key === 'F12') return true;
  const k = letter(e);
  const mac = e.metaKey && e.altKey;
  if ((e.ctrlKey && e.shiftKey) || mac) return k === 'i' || k === 'j' || k === 'c';
  return e.ctrlKey && !e.altKey && k === 'u';
}

/** Ctrl+P or Cmd+P, which opens the print dialog (PR-06). */
export function isPrintShortcut(e: Keys): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && letter(e) === 'p';
}

export interface LockdownDeps {
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState' | 'fullscreenElement'>;
  report: (type: ClientEventType, details?: AttemptEventDetails) => void;
  fullscreenRequired: boolean;
  devtoolsPolicy: Settings['devtoolsPolicy'];
}

/** Starts the lockdown; returns the function that stops it. */
export function installLockdown({ win, doc, report, fullscreenRequired, devtoolsPolicy }: LockdownDeps): () => void {
  const blocking = devtoolsPolicy !== 'allow';
  const stops: Array<() => void> = [];
  const on = (
    target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
    type: string,
    fn: (e: Event) => void,
    capture = false,
  ) => {
    // An options object, not a boolean: Node's EventTarget (unit tests) ignores a boolean `capture` on removal.
    target.addEventListener(type, fn, { capture });
    stops.push(() => target.removeEventListener(type, fn, { capture }));
  };

  // PR-04: leaving fullscreen.
  on(doc, 'fullscreenchange', () => {
    if (fullscreenRequired && !doc.fullscreenElement) report('fullscreen_exit', { source: 'fullscreenchange' });
  });
  // PR-05: the page hidden (another tab, minimized) and the window losing focus are separate reasons.
  on(doc, 'visibilitychange', () => {
    if (doc.visibilityState === 'hidden') report('tab_hidden', { source: 'visibilitychange' });
  });
  on(win, 'blur', (e) => {
    // Blur of an element inside the page reaches window listeners only in the capture phase; this is the window's own.
    if (e.target === win) report('window_blur', { source: 'blur' });
  });
  // PR-06: developer tools keys by policy, the print shortcut always.
  on(
    win,
    'keydown',
    (event) => {
      const e = event as KeyboardEvent;
      if (isPrintShortcut(e)) e.preventDefault();
      else if (blocking && isDevtoolsShortcut(e)) {
        e.preventDefault();
        if (!e.repeat) report('devtools', { key: e.key, policy: devtoolsPolicy });
      }
    },
    true,
  );
  for (const type of ['copy', 'cut', 'paste']) on(doc, type, (e) => e.preventDefault(), true);
  on(
    doc,
    'contextmenu',
    (e) => {
      if (!blocking) return;
      e.preventDefault();
      report('context_menu', {});
    },
    true,
  );

  return () => {
    for (const stop of stops.splice(0)) stop();
  };
}
