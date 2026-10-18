'use client';

import { cx } from '@mitaoe/ui';
import { Check } from 'lucide-react';
import { useId } from 'react';
import { t } from '@/i18n';
import { optionLetter, QuestionText } from './QuestionView';

/**
 * The bubble options (13.6, A11Y-08): native radios in one group, so the arrow keys move between them. Each row is a
 * clickable 56 px target; the radio is the bubble with its letter, and choosing it fills it with ballpoint ink. With
 * `correctOptionIds` (preview's Show answers) the correct row says so in words, as the radio's description.
 */
export function AnswerOptions({
  questionId,
  options,
  chosen,
  onChoose,
  correctOptionIds,
}: {
  questionId: string;
  options: ReadonlyArray<{ id: string; text: string }>;
  chosen: string | undefined;
  onChoose: (optionId: string) => void;
  correctOptionIds?: readonly string[];
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={t('exam.options')} className="flex flex-col gap-2">
      {options.map((o, i) => {
        const correct = !!correctOptionIds?.includes(o.id);
        const nameId = `${id}-${o.id}-name`;
        const descId = `${id}-${o.id}-desc`;
        return (
          <label
            key={o.id}
            className={cx(
              'flex min-h-14 cursor-pointer items-center gap-3 rounded-control border bg-surface px-3 py-2',
              'transition-colors duration-(--duration-small) ease-standard hover:bg-ballpoint-wash',
              'has-checked:border-ballpoint has-checked:bg-ballpoint-wash',
              correct ? 'border-tick' : 'border-rule',
            )}
          >
            <span className="grid size-9 shrink-0 place-items-center">
              <input
                type="radio"
                name={`${id}-${questionId}`}
                value={o.id}
                checked={chosen === o.id}
                onChange={() => onChoose(o.id)}
                aria-labelledby={nameId}
                aria-describedby={correct ? descId : undefined}
                className={cx(
                  'peer col-start-1 row-start-1 size-9 cursor-pointer appearance-none rounded-full border-2 border-dropout bg-surface',
                  'transition-colors duration-(--duration-standard) ease-standard checked:border-ballpoint checked:bg-ballpoint',
                )}
              />
              <span
                aria-hidden
                className="pointer-events-none col-start-1 row-start-1 font-bold peer-checked:text-on-ballpoint"
              >
                {optionLetter(i)}
              </span>
            </span>
            <span id={nameId} className="min-w-0 flex-1">
              <span className="sr-only">{t('exam.optionLetter', { letter: optionLetter(i) })}</span>
              <QuestionText text={o.text} />
            </span>
            {correct ? (
              <span id={descId} className="flex shrink-0 items-center gap-1 font-bold text-tick">
                <Check aria-hidden size={20} />
                {t('exam.correctAnswer')}
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}
