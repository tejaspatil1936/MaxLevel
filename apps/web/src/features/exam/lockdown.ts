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

/** Away from the exam page (unloaded, then opened again) for longer than this is a strike; a quick reload is not. */
export const AWAY_STRIKE_MS = 5000;

export interface LockdownDeps {
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState' | 'fullscreenElement'>;
  report: (type: ClientEventType, details?: AttemptEventDetails) => void;
  fullscreenRequired: boolean;
  devtoolsPolicy: Settings['devtoolsPolicy'];
  /** The time (the server's clock), for how long the page was away. */
  now: () => number;
  /** This tab's storage (sessionStorage), which keeps the time the page unloaded across a reload or a return. */
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** The storage key of this attempt's unload time. */
  awayKey: string;
  /** Fullscreen is required and the page is not in it (true), or it is again (false): the blocking overlay of PR-04. */
  onFullscreenNeeded: (needed: boolean) => void;
}

/** Starts the lockdown; returns the function that stops it. */
export function installLockdown(deps: LockdownDeps): () => void {
  const { win, doc, report, fullscreenRequired, devtoolsPolicy, now, storage, awayKey, onFullscreenNeeded } = deps;
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

  const stored = {
    read: () => {
      try {
        const at = Number(storage?.getItem(awayKey));
        storage?.removeItem(awayKey);
        return Number.isFinite(at) && at > 0 ? at : null;
      } catch {
        return null;
      }
    },
    write: (at: number) => {
      try {
        storage?.setItem(awayKey, String(at));
      } catch {
        // Storage blocked: the return is not counted, as before.
      }
    },
  };
  // PR-04: the exam outside fullscreen when it opens or comes back (a reload or a return ends fullscreen without a
  // `fullscreenchange` here) blocks the screen until the student goes back in; it is no strike by itself.
  const checkFullscreen = () => {
    if (fullscreenRequired && !doc.fullscreenElement) onFullscreenNeeded(true);
  };
  // PR-04: leaving fullscreen (its strike warning is the overlay).
  on(doc, 'fullscreenchange', () => {
    if (!fullscreenRequired) return;
    if (doc.fullscreenElement) onFullscreenNeeded(false);
    else report('fullscreen_exit', { source: 'fullscreenchange' });
  });
  // PR-05: the page hidden (another tab, minimized) and the window losing focus are separate reasons. A page being
  // unloaded (reload, navigation, closing) also turns hidden, right after `pagehide`; that is not another tab, and its
  // report would race the unload, so it is not sent. The unload time is kept instead: coming back from the
  // back-forward cache, or opening the exam again more than 5 seconds later, is the strike (a same-tab navigation
  // such as Alt+Left blurs nothing). Only the browser's own `pagehide` counts, so a script can't hide a tab switch.
  let unloading = false;
  on(win, 'pagehide', (e) => {
    if (!e.isTrusted) return;
    unloading = true;
    stored.write(now());
  });
  on(win, 'pageshow', (e) => {
    unloading = false;
    const away = stored.read();
    if ((e as PageTransitionEvent).persisted)
      report('tab_hidden', { source: 'pageshow', ...(away === null ? {} : { awayMs: Math.round(now() - away) }) });
    checkFullscreen();
  });
  const away = stored.read();
  if (away !== null && now() - away > AWAY_STRIKE_MS)
    report('tab_hidden', { source: 'reopened', awayMs: Math.round(now() - away) });
  checkFullscreen();
  on(doc, 'visibilitychange', () => {
    if (doc.visibilityState === 'hidden' && !unloading) report('tab_hidden', { source: 'visibilitychange' });
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
