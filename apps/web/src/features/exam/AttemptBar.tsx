'use client';

import { cx } from '@mitaoe/ui';
import { Check, CloudOff, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useServerNow } from '@/features/student/Countdown';
import { t } from '@/i18n';
import { formatExamTimer } from '@/lib/format';
import type { SyncStatus } from './answer-sync';
import { isFinalMinutes, passedWarning } from './time-left';

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

/**
 * `deadline − server now` in noticeboard numerals (EX-06); a timer, never a live region. The numerals turn red pen
 * below 10 minutes, `onWarning` runs once as the time left passes 10, 5 and 1 minutes (A11Y-09), and `onTimeUp` once
 * when it reaches zero.
 */
export function ExamTimer({
  deadlineAt,
  onWarning,
  onTimeUp,
}: {
  deadlineAt: number;
  onWarning?: (minutes: number) => void;
  /** Runs once when the deadline is reached on the server's time (EX-16). */
  onTimeUp?: () => void;
}) {
  const id = useId();
  const remaining = deadlineAt - useServerNow();
  const before = useRef(remaining);
  const warn = useRef(onWarning);
  const up = useRef(onTimeUp);
  const timeUp = remaining <= 0;
  useEffect(() => {
    warn.current = onWarning;
    up.current = onTimeUp;
  });
  useEffect(() => {
    const minutes = passedWarning(before.current, remaining);
    before.current = remaining;
    if (minutes !== null) warn.current?.(minutes);
  }, [remaining]);
  useEffect(() => {
    if (timeUp) up.current?.();
  }, [timeUp]);
  return (
    <p className="flex items-baseline gap-2">
      <span id={id} className="text-graphite">
        {t('attempt.timeLeft')}
      </span>
      <span
        role="timer"
        aria-labelledby={id}
        className={cx(
          'font-display text-timer font-extrabold tabular',
          isFinalMinutes(remaining) ? 'text-redpen' : 'text-ink',
        )}
      >
        {formatExamTimer(remaining)}
      </span>
    </p>
  );
}

/**
 * The text of the `Time announcements` region and the function that sets it. Saying the same words again empties the
 * region for a moment first, so screen readers read them again (A11Y-06).
 */
export function useTimeAnnouncer(): [string, (text: string) => void] {
  const [text, setText] = useState('');
  const shown = useRef('');
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pending.current), []);
  const announce = useCallback((next: string) => {
    const show = (v: string) => {
      shown.current = v;
      setText(v);
    };
    clearTimeout(pending.current);
    if (shown.current !== next) return show(next);
    show('');
    pending.current = setTimeout(() => show(next), 150);
  }, []);
  return [text, announce];
}

/** The polite `Time announcements` region in the top bar: empty until the first announcement (A11Y-09). */
export function TimeAnnouncements({ text }: { text: string }) {
  return (
    <p role="status" aria-live="polite" aria-label={t('attempt.timeAnnouncements')} className="font-bold text-ink">
      {text}
    </p>
  );
}
