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
  className,
}: {
  label: string;
  target: number;
  onElapsed?: () => void;
  size?: 'normal' | 'display' | 'compact';
  className?: string;
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
    <div
      className={cx(
        'flex',
        size === 'display'
          ? 'flex-col items-start gap-1'
          : size === 'compact'
            ? 'flex-row items-center gap-2'
            : 'flex-wrap items-baseline gap-x-2',
        className,
      )}
    >
      <span
        id={id}
        className={cx(
          'text-graphite',
          size === 'display' ? 'text-body-small font-semibold' : size === 'compact' ? 'text-caption' : '',
        )}
      >
        {label}
      </span>
      <span
        role="timer"
        aria-labelledby={id}
        className={cx(
          'font-display font-bold tabular tracking-tight text-ink',
          size === 'display'
            ? 'text-timer leading-none'
            : size === 'compact'
              ? 'text-body font-bold'
              : 'text-heading-2',
        )}
      >
        {formatCountdown(remaining)}
      </span>
    </div>
  );
}
