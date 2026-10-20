'use client';

import { cx } from '@mitaoe/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { serverNow } from '@/lib/api';
import { formatCountdown } from '@/lib/format';

/** The server's time, ticking every second (EX-06): device time corrected by the X-Server-Time offset. */
export function useServerNow(): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * A countdown to `target` by the server's clock (UX-11): a visible label naming a `timer` (never a live region, so
 * screen readers are not interrupted every second). `onElapsed` runs once when it reaches zero.
 */
export function Countdown({
  label,
  target,
  onElapsed,
  size = 'normal',
}: {
  label: string;
  target: number;
  onElapsed?: () => void;
  size?: 'normal' | 'display';
}) {
  const id = useId();
  const now = useServerNow();
  const remaining = target - now;
  const fired = useRef(false);
  useEffect(() => {
    if (remaining > 0 || fired.current) return;
    fired.current = true;
    onElapsed?.();
  }, [remaining, onElapsed]);
  return (
    <p className={cx('flex flex-wrap items-baseline gap-x-2', size === 'display' ? 'flex-col items-start' : '')}>
      <span id={id} className="text-graphite">
        {label}
      </span>
      <span
        role="timer"
        aria-labelledby={id}
        className={cx('font-display font-extrabold tabular', size === 'display' ? 'text-display-1' : 'text-heading-2')}
      >
        {formatCountdown(remaining)}
      </span>
    </p>
  );
}
