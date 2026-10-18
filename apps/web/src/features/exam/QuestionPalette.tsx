'use client';

import type { ExamSection } from '@mitaoe/shared';
import { cx } from '@mitaoe/ui';
import { useEffect, useId, useRef, type Ref } from 'react';
import { t, type MessageKey } from '@/i18n';
import type { QuestionState } from './exam-state';
import { StateMark } from './StateMark';

/** The legend's rows (EX-07); the locked sample stands for both locked states. */
const LEGEND: Array<{ state: QuestionState; label: MessageKey }> = [
  { state: 'notVisited', label: 'exam.legend.notVisited' },
  { state: 'notAnswered', label: 'exam.legend.notAnswered' },
  { state: 'answered', label: 'exam.legend.answered' },
  { state: 'marked', label: 'exam.legend.marked' },
  { state: 'answeredMarked', label: 'exam.legend.answeredMarked' },
  { state: 'lockedNotAnswered', label: 'exam.legend.locked' },
];

export interface PaletteGroup {
  section: ExamSection | null;
  /** Indexes of the group's questions in exam order. */
  indexes: number[];
}

const stateName = (i: number, state: QuestionState) =>
  t('exam.paletteItem', { n: i + 1, state: t(`exam.state.${state}` as MessageKey) });

/**
 * The question palette (13.6, A11Y-08, A11Y-15): numbered bubbles grouped by section, with a legend. From 1,280 px it
 * is the right rail; below that it is a drawer that is hidden until `open`. Focus leaving the open drawer calls
 * `onFocusLeave` with where it went, so the screen can close it before it covers the focused control (WCAG 2.4.11).
 */
export function QuestionPalette({
  groups,
  current,
  stateOf,
  onGoTo,
  open,
  onClose,
  onFocusLeave,
  currentRef,
}: {
  groups: readonly PaletteGroup[];
  current: number;
  stateOf: (index: number) => QuestionState;
  onGoTo: (index: number) => void;
  open: boolean;
  onClose: () => void;
  onFocusLeave?: (to: Element | null) => void;
  currentRef?: Ref<HTMLButtonElement>;
}) {
  const id = useId();
  return (
    <nav
      aria-label={t('exam.palette')}
      className={cx(
        'w-64 shrink-0 flex-col gap-5 self-start rounded-panel border border-rule bg-surface p-4 xl:flex',
        'max-xl:fixed max-xl:inset-y-0 max-xl:right-0 max-xl:z-30 max-xl:w-72 max-xl:overflow-y-auto max-xl:rounded-none max-xl:border-y-0 max-xl:border-r-0 max-xl:shadow-overlay',
        open ? 'flex' : 'hidden',
      )}
      onBlur={(e) => {
        const to = e.relatedTarget instanceof Element ? e.relatedTarget : null;
        // Focus moving inside the drawer, or the whole window losing focus, keeps it open.
        if (!open || (to && e.currentTarget.contains(to)) || (!to && !document.hasFocus())) return;
        onFocusLeave?.(to);
      }}
    >
      <div className="flex items-center justify-between gap-2 xl:hidden">
        <p className="font-bold">{t('exam.palette')}</p>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-control px-3 font-bold text-ballpoint hover:bg-ballpoint-wash"
        >
          {t('exam.paletteClose')}
        </button>
      </div>
      {groups.map((g, gi) => (
        <div
          key={g.section?.id ?? `loose-${gi}`}
          role="group"
          aria-labelledby={`${id}-${gi}`}
          className="flex flex-col gap-2"
        >
          <p id={`${id}-${gi}`} className="font-bold">
            {g.section ? g.section.name : t(groups.length > 1 ? 'exam.paletteOther' : 'exam.paletteAll')}
          </p>
          <ul className="grid grid-cols-5 gap-1">
            {g.indexes.map((i) => {
              const state = stateOf(i);
              return (
                <li key={i}>
                  <button
                    ref={i === current ? currentRef : undefined}
                    type="button"
                    aria-current={i === current ? 'step' : undefined}
                    onClick={() => onGoTo(i)}
                    className={cx(
                      'flex size-11 items-center justify-center rounded-full',
                      i === current && 'bg-ballpoint-wash',
                    )}
                    aria-label={stateName(i, state)}
                  >
                    <StateMark
                      state={state}
                      shape="bubble"
                      className={cx('size-9 rounded-full tabular', i === current && 'ring-2 ring-ink ring-offset-1')}
                    >
                      {String(i + 1)}
                    </StateMark>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="flex flex-col gap-2 border-t border-rule pt-4">
        <p className="font-bold">{t('exam.legend')}</p>
        <ul aria-label={t('exam.legendList')} className="flex flex-col gap-2 text-body-small">
          {LEGEND.map(({ state, label }) => (
            <li key={state} className="flex items-center gap-3">
              <StateMark state={state} shape="bubble" className="size-6" testId="legend-sample" />
              {t(label)}
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/**
 * The timing track down the sheet's left edge (13.2, 13.6, A11Y-08): one mark per question, the current one longer,
 * each a button that opens its question. It scrolls by itself in a long test and keeps the current mark in view.
 */
export function TimingTrack({
  count,
  current,
  stateOf,
  onGoTo,
}: {
  count: number;
  current: number;
  stateOf: (index: number) => QuestionState;
  onGoTo: (index: number) => void;
}) {
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);
  return (
    <nav
      aria-label={t('exam.track')}
      className="sticky top-24 flex max-h-[calc(100dvh-14rem)] w-12 shrink-0 flex-col self-start overflow-y-auto border-r border-dropout py-4"
    >
      <ul className="flex flex-col">
        {Array.from({ length: count }, (_, i) => (
          <li key={i}>
            <button
              ref={i === current ? currentRef : undefined}
              type="button"
              aria-current={i === current ? 'step' : undefined}
              aria-label={stateName(i, stateOf(i))}
              onClick={() => onGoTo(i)}
              className="flex h-7 w-full items-center pl-2 hover:bg-ballpoint-wash"
            >
              <StateMark state={stateOf(i)} shape="bar" className={cx('h-2.5', i === current ? 'w-8' : 'w-5')} />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
