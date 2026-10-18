'use client';

import { cx } from '@mitaoe/ui';
import type { ReactNode } from 'react';
import type { QuestionState } from './exam-state';

/**
 * How each state is drawn (13.6, UI-02, A11Y-14). Colour and shape both carry the state, so it still reads with every
 * colour forced to black on white: a dashed outline (not visited), a solid outline (not answered), a solid fill
 * (answered), a highlighter fill with a corner flag (marked), the flag plus a ballpoint notch (answered and marked),
 * and hatching (locked).
 */
const DRAW: Record<
  QuestionState,
  { body: string; text: string; dashed?: boolean; flag?: boolean; notch?: boolean; hatch?: string }
> = {
  notVisited: { body: 'fill-surface stroke-graphite', text: 'text-ink', dashed: true },
  notAnswered: { body: 'fill-surface stroke-ink', text: 'text-ink' },
  answered: { body: 'fill-ballpoint stroke-ballpoint', text: 'text-on-ballpoint' },
  marked: { body: 'fill-highlighter stroke-ink', text: 'text-highlighter-ink', flag: true },
  answeredMarked: { body: 'fill-highlighter stroke-ink', text: 'text-highlighter-ink', flag: true, notch: true },
  lockedAnswered: { body: 'fill-ballpoint stroke-ballpoint', text: 'text-on-ballpoint', hatch: 'stroke-on-ballpoint' },
  lockedNotAnswered: { body: 'fill-surface-sunken stroke-graphite', text: 'text-ink', hatch: 'stroke-graphite' },
};

/** Hatching lines across a circle of radius r at (c, c), 45 degrees, `gap` apart, ending on the circle. */
function circleHatch(c: number, r: number, gap: number): string {
  const parts: string[] = [];
  for (let d = -r + gap / 2; d < r; d += gap) {
    const h = Math.sqrt(r * r - d * d);
    const px = c + d / Math.SQRT2;
    const py = c + d / Math.SQRT2;
    const dx = h / Math.SQRT2;
    parts.push(`M${(px - dx).toFixed(2)} ${(py + dx).toFixed(2)}L${(px + dx).toFixed(2)} ${(py - dx).toFixed(2)}`);
  }
  return parts.join('');
}
const BUBBLE_HATCH = circleHatch(20, 16, 7);
const BAR_HATCH = 'M8 14L14 2M16 14L22 2M24 14L30 2';

/**
 * A question state drawn as a palette bubble (round, with its number) or a timing-track mark (a bar). The drawing is
 * decorative; the button around it carries the state in words (A11Y-08).
 */
export function StateMark({
  state,
  shape,
  className,
  children,
  testId,
}: {
  state: QuestionState;
  shape: 'bubble' | 'bar';
  className?: string;
  children?: ReactNode;
  testId?: string;
}) {
  const d = DRAW[state];
  const bubble = shape === 'bubble';
  return (
    <span
      aria-hidden
      data-testid={testId}
      className={cx('relative inline-flex shrink-0 items-center justify-center font-bold', d.text, className)}
    >
      <svg
        viewBox={bubble ? '0 0 40 40' : '0 0 40 16'}
        preserveAspectRatio={bubble ? undefined : 'none'}
        className="absolute inset-0 size-full overflow-visible"
        focusable="false"
      >
        {bubble ? (
          <circle
            cx="20"
            cy="20"
            r="17"
            strokeWidth="3"
            strokeDasharray={d.dashed ? '6 4' : undefined}
            className={d.body}
          />
        ) : (
          <rect
            x="1.5"
            y="1.5"
            width="37"
            height="13"
            rx="2"
            strokeWidth="3"
            strokeDasharray={d.dashed ? '5 3' : undefined}
            className={d.body}
          />
        )}
        {d.hatch ? <path d={bubble ? BUBBLE_HATCH : BAR_HATCH} strokeWidth="2.5" className={d.hatch} /> : null}
        {d.flag ? (
          <path d={bubble ? 'M25 -3H43V15Z' : 'M29 -4H43V10Z'} strokeWidth="2" className="fill-ink stroke-surface" />
        ) : null}
        {d.notch ? (
          <circle
            cx={bubble ? 34 : 36}
            cy={bubble ? 34 : 14}
            r={bubble ? 7 : 5}
            strokeWidth="2"
            className="fill-ballpoint stroke-surface"
          />
        ) : null}
      </svg>
      {children ? <span className="relative">{children}</span> : null}
    </span>
  );
}
