'use client';

import { cx } from '@mitaoe/ui';
import { questionTimeUpAt } from '@mitaoe/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { t } from '@/i18n';
import { deviceNow, serverClockOffset } from '@/lib/api';
import { formatQuestionTimer } from '@/lib/format';

/** Where the countdown ends, in device time. */
function deviceEnd(servedAt: number | undefined, shownAt: number, timeLimitSec: number) {
  const at =
    servedAt === undefined
      ? questionTimeUpAt(shownAt, timeLimitSec)
      : questionTimeUpAt(servedAt, timeLimitSec) - serverClockOffset();
  return { servedAt, at };
}

/**
 * The current question's own countdown (Q-11): `M:SS` to its first serve time plus its limit, on the server's time; a
 * timer and never a live region. Until the server's serve time (`servedAt`) is known it counts from when it was shown.
 * `onTimeUp` runs once when it reaches zero; give each question its own instance (a `key`).
 *
 * The end is held in device time, taken with the clock offset of the moment it became known (for a new serve time,
 * the offset its own response measured), and the countdown runs on the device clock. A later correction of the offset
 * never moves the end, so a question is never over the moment it shows (a stale offset paired with a fresh serve time
 * skipped it).
 */
export function QuestionTimer({
  servedAt,
  timeLimitSec,
  onTimeUp,
}: {
  servedAt: number | undefined;
  timeLimitSec: number;
  onTimeUp: () => void;
}) {
  const id = useId();
  const [shownAt] = useState(deviceNow);
  const [end, setEnd] = useState(() => deviceEnd(servedAt, shownAt, timeLimitSec));
  if (end.servedAt !== servedAt) setEnd(deviceEnd(servedAt, shownAt, timeLimitSec));
  const [, setTick] = useState(0);
  useEffect(() => {
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, []);
  const remaining = end.at - deviceNow();
  const up = useRef(onTimeUp);
  const timeUp = remaining <= 0;
  useEffect(() => {
    up.current = onTimeUp;
  });
  useEffect(() => {
    if (timeUp) up.current();
  }, [timeUp]);
  return (
    <p className="flex items-baseline gap-2">
      <span id={id} className="text-graphite">
        {t('attempt.questionTimeLeft')}
      </span>
      <span
        role="timer"
        aria-labelledby={id}
        className={cx(
          'font-display text-heading-2 font-extrabold tabular',
          remaining < 10_000 ? 'text-redpen' : 'text-ink',
        )}
      >
        {formatQuestionTimer(remaining)}
      </span>
    </p>
  );
}
