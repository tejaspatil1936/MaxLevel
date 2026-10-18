'use client';

import { cx } from '@mitaoe/ui';
import { Check, CloudOff, RefreshCw } from 'lucide-react';
import { useId } from 'react';
import { useServerNow } from '@/features/student/Countdown';
import { t } from '@/i18n';
import { formatExamTimer } from '@/lib/format';
import type { SyncStatus } from './answer-sync';

// The attempt's top-bar pieces (13.6, 13.7): sync status, strike tally and the noticeboard timer.

/** Saved, Saving or Offline with the waiting count, with an icon beside the word (EX-12, A11Y-14). */
export function SyncStatusView({ status }: { status: SyncStatus }) {
  const Icon = status.kind === 'saved' ? Check : status.kind === 'saving' ? RefreshCw : CloudOff;
  const text =
    status.kind === 'saved'
      ? t('attempt.saved')
      : status.kind === 'saving'
        ? t('attempt.saving')
        : status.waiting === 0
          ? t('attempt.offlineNone')
          : status.waiting === 1
            ? t('attempt.offlineOne')
            : t('attempt.offlineMany', { n: status.waiting });
  return (
    <p
      role="status"
      aria-label={t('attempt.syncStatus')}
      className={cx('flex items-center gap-2 font-bold', status.kind === 'offline' ? 'text-redpen' : 'text-graphite')}
    >
      <Icon aria-hidden size={20} />
      {text}
    </p>
  );
}

/** Red-pen tally strokes, one per strike used and faint ones for those left, always with the words (13.6). */
export function StrikeTally({ count, max }: { count: number; max: number }) {
  return (
    <p className="flex items-center gap-2">
      <svg aria-hidden width={max * 8} height={20} viewBox={`0 0 ${max * 8} 20`}>
        {Array.from({ length: max }, (_, i) => (
          <line
            key={i}
            x1={i * 8 + 4}
            y1="2"
            x2={i * 8 + 4}
            y2="18"
            strokeWidth="3"
            strokeLinecap="round"
            className={i < count ? 'stroke-redpen' : 'stroke-rule'}
          />
        ))}
      </svg>
      {t('attempt.strikes', { n: count, max })}
    </p>
  );
}

/** `deadline − server now` in noticeboard numerals (EX-06); a timer, never a live region. */
export function ExamTimer({ deadlineAt }: { deadlineAt: number }) {
  const id = useId();
  const now = useServerNow();
  return (
    <p className="flex items-baseline gap-2">
      <span id={id} className="text-graphite">
        {t('attempt.timeLeft')}
      </span>
      <span role="timer" aria-labelledby={id} className="font-display text-timer font-extrabold tabular">
        {formatExamTimer(deadlineAt - now)}
      </span>
    </p>
  );
}
