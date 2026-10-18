'use client';

import { cx } from '@mitaoe/ui';
import { useEffect, useId, useRef } from 'react';
import { useServerNow } from '@/features/student/Countdown';
import { t } from '@/i18n';
import { formatQuestionTimer } from '@/lib/format';

/**
 * The current question's own countdown (Q-11): `M:SS` to `timeUpAt` on the server's time, a timer and never a live
 * region. `onTimeUp` runs once when it reaches zero; give each question its own instance (a `key`).
 */
export function QuestionTimer({ timeUpAt, onTimeUp }: { timeUpAt: number; onTimeUp: () => void }) {
  const id = useId();
  const remaining = timeUpAt - useServerNow();
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
