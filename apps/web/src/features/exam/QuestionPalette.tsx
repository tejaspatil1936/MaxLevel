'use client';

import type { ExamSection } from '@mitaoe/shared';
import { cx } from '@mitaoe/ui';
import { useId } from 'react';
import { t, type MessageKey } from '@/i18n';
import type { QuestionState } from './exam-state';

const STATES: QuestionState[] = ['notVisited', 'notAnswered', 'answered', 'marked', 'answeredMarked'];

/**
 * Each state has its own shape as well as colour (UI-02, EX-07): dashed (not visited), outlined (not answered), solid
 * ballpoint (answered), highlighter (marked), highlighter with a ballpoint notch (answered and marked).
 */
const SHAPE: Record<QuestionState, string> = {
  notVisited: 'border-2 border-dashed border-graphite bg-surface text-ink',
  notAnswered: 'border-2 border-ink bg-surface text-ink',
  answered: 'border-2 border-ballpoint bg-ballpoint text-on-ballpoint',
  marked: 'border-2 border-ink bg-highlighter text-highlighter-ink',
  answeredMarked: 'border-2 border-ink bg-highlighter text-highlighter-ink',
};

function Bubble({ state, className, children }: { state: QuestionState; className?: string; children?: string }) {
  return (
    <span className={cx('relative flex items-center justify-center rounded-full font-bold', SHAPE[state], className)}>
      {children}
      {state === 'answeredMarked' ? (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 size-3 rounded-full border-2 border-surface bg-ballpoint"
        />
      ) : null}
    </span>
  );
}

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
                    <Bubble state={state} className={cx('size-9 tabular', i === current && 'ring-2 ring-ink')}>
                      {String(i + 1)}
                    </Bubble>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="flex flex-col gap-2 border-t border-rule pt-4">
        <p id={`${id}-legend`} className="font-bold">
          {t('exam.legend')}
        </p>
        <ul aria-labelledby={`${id}-legend`} className="flex flex-col gap-2 text-body-small">
          {STATES.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <Bubble state={s} className="size-5" />
              {t(`exam.legend.${s}` as MessageKey)}
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
        <span key={i} className={cx('block h-2 rounded-sm', i === current ? 'w-4' : 'w-2.5', TRACK[stateOf(i)])} />
      ))}
    </div>
  );
}

const TRACK: Record<QuestionState, string> = {
  notVisited: 'border border-dropout bg-surface',
  notAnswered: 'border border-ink bg-surface',
  answered: 'bg-ballpoint',
  marked: 'bg-highlighter',
  answeredMarked: 'bg-highlighter border-r-2 border-ballpoint',
};
