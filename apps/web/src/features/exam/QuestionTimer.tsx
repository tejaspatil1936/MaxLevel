'use client';

import { cx } from '@mitaoe/ui';
import { questionTimeUpAt } from '@mitaoe/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { useServerNow } from '@/features/student/Countdown';
import { t } from '@/i18n';
import { serverNow } from '@/lib/api';
import { formatQuestionTimer } from '@/lib/format';

/**
 * The current question's own countdown (Q-11): `M:SS` to its first serve time plus its limit, on the server's time; a
 * timer and never a live region. Until the server's serve time (`servedAt`) is known it counts from when it was shown.
 * `onTimeUp` runs once when it reaches zero; give each question its own instance (a `key`).
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
  const [shownAt] = useState(serverNow);
  const remaining = questionTimeUpAt(servedAt ?? shownAt, timeLimitSec) - useServerNow();
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
