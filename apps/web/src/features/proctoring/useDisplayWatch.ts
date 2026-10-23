'use client';

import type { AttemptEventDetails } from '@mitaoe/shared';
import { useEffect, useRef, useState } from 'react';
import { startDisplayWatch, type DisplayWatch } from './display-watch';

/** Screen with the Window Management API's additions, where the browser has them. */
type ScreenWithExtended = Screen & Partial<EventTarget> & { isExtended?: boolean };

/**
 * With `active` (the test locks the exam down), a second screen is a `dual_monitor` strike and blocks the exam until
 * it is unplugged. Returns whether the exam is blocked and `check`, which looks again at once.
 */
export function useDisplayWatch(
  active: boolean,
  report: (type: 'dual_monitor', details: AttemptEventDetails) => void,
): { blocked: boolean; check: () => void } {
  const [blocked, setBlocked] = useState(false);
  const watch = useRef<DisplayWatch | null>(null);
  useEffect(() => {
    if (!active) return;
    const scr = window.screen as ScreenWithExtended;
    const w = startDisplayWatch({
      isExtended: () => scr.isExtended,
      onChange: (fn) => {
        // `change` on the screen fires when screens are added or removed; a resize often comes with it.
        scr.addEventListener?.('change', fn);
        window.addEventListener('resize', fn);
        return () => {
          scr.removeEventListener?.('change', fn);
          window.removeEventListener('resize', fn);
        };
      },
      every: (fn, ms) => {
        const id = setInterval(fn, ms);
        return () => clearInterval(id);
      },
      report,
      onBlocked: setBlocked,
    });
    watch.current = w;
    return () => {
      w.stop();
      watch.current = null;
      setBlocked(false);
    };
  }, [active, report]);
  return { blocked, check: () => watch.current?.check() };
}
