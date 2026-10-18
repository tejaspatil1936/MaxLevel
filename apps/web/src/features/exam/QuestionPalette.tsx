'use client';

import type { ExamSection } from '@mitaoe/shared';
import { cx } from '@mitaoe/ui';
import { useId } from 'react';
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

/** The question palette in the right rail (13.6, A11Y-08): numbered bubbles grouped by section, with a legend. */
export function QuestionPalette({
  groups,
  current,
  stateOf,
  onGoTo,
}: {
  groups: readonly PaletteGroup[];
  current: number;
  stateOf: (index: number) => QuestionState;
  onGoTo: (index: number) => void;
}) {
  const id = useId();
  return (
    <nav
      aria-label={t('exam.palette')}
      className="flex w-64 shrink-0 flex-col gap-5 self-start rounded-panel border border-rule bg-surface p-4"
    >
      {groups.map((g, gi) => (
        <div key={g.section?.id ?? `loose-${gi}`} className="flex flex-col gap-2">
          <p id={`${id}-${gi}`} className="font-bold">
            {g.section ? g.section.name : t(groups.length > 1 ? 'exam.paletteOther' : 'exam.paletteAll')}
          </p>
          <ul aria-labelledby={`${id}-${gi}`} className="grid grid-cols-5 gap-1">
            {g.indexes.map((i) => {
              const state = stateOf(i);
              return (
                <li key={i}>
                  <button
                    type="button"
                    aria-current={i === current ? 'step' : undefined}
                    onClick={() => onGoTo(i)}
                    className={cx(
                      'flex size-11 items-center justify-center rounded-full',
                      i === current && 'bg-ballpoint-wash',
                    )}
                    aria-label={t('exam.paletteItem', { n: i + 1, state: t(`exam.state.${state}` as MessageKey) })}
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

/** The timing track down the sheet's left edge (13.2): one mark per question, the current one longer. */
export function TimingTrack({
  count,
  current,
  stateOf,
}: {
  count: number;
  current: number;
  stateOf: (index: number) => QuestionState;
}) {
  return (
    <div aria-hidden className="flex w-6 shrink-0 flex-col items-start gap-1.5 border-r border-dropout py-6 pl-1.5">
      {Array.from({ length: count }, (_, i) => (
        <StateMark key={i} state={stateOf(i)} shape="bar" className={cx('h-2', i === current ? 'w-4' : 'w-2.5')} />
      ))}
    </div>
  );
}
