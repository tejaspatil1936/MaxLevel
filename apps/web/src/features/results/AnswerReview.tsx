'use client';

import type { ReviewItem } from '@mitaoe/shared';
import { CircleCheck, CircleMinus, CircleX } from 'lucide-react';
import { QuestionText } from '@/features/exam/QuestionView';
import { t } from '@/i18n';
import { formatMarks } from '@/lib/format';

const LETTERS = 'ABCDEFGHIJ';

/** `B. 24 m/s`: the letter follows the order the student saw the options in. */
function optionText(item: ReviewItem, optionId: string | undefined): string | null {
  const i = item.options.findIndex((o) => o.id === optionId);
  return i < 0 ? null : t('result.option', { letter: LETTERS[i] ?? String(i + 1), text: item.options[i]!.text });
}

const VERDICT = {
  correct: { icon: CircleCheck, tone: 'text-tick', label: 'result.verdict.correct' },
  wrong: { icon: CircleX, tone: 'text-redpen', label: 'result.verdict.wrong' },
  skipped: { icon: CircleMinus, tone: 'text-graphite', label: 'result.verdict.skipped' },
} as const;

/**
 * The full review (RES-03, SER-10): every question in exam order with the student's answer, the correct answer, a
 * verdict in words with an icon (not colour alone), the marks and, where the question has one, its explanation.
 */
export function AnswerReview({ review }: { review: ReviewItem[] }) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby="answer-review">
      <h2 id="answer-review" className="text-heading-2 font-bold">
        {t('result.review')}
      </h2>
      <ol aria-label={t('result.review')} className="flex flex-col gap-4">
        {review.map((item, n) => {
          const chosen = item.chosenOptionId === null ? null : optionText(item, item.chosenOptionId);
          const verdict =
            item.chosenOptionId === null
              ? VERDICT.skipped
              : item.correctOptionIds.includes(item.chosenOptionId)
                ? VERDICT.correct
                : VERDICT.wrong;
          const Icon = verdict.icon;
          return (
            <li key={item.questionId} className="flex flex-col gap-2 rounded-panel border border-rule p-5">
              <h3 className="text-heading-3 font-bold">{t('result.question', { n: n + 1 })}</h3>
              <QuestionText text={item.prompt} />
              <p>{t('result.yourAnswer', { answer: chosen ?? t('result.noAnswer') })}</p>
              <p>{t('result.correctAnswer', { answer: optionText(item, item.correctOptionIds[0]) ?? '' })}</p>
              <p className={`inline-flex items-center gap-2 font-bold ${verdict.tone}`}>
                <Icon aria-hidden size={20} />
                {t(verdict.label)}
              </p>
              <p>{t('result.marks', { marks: formatMarks(item.marks) })}</p>
              {item.explanation ? (
                <>
                  <h4 className="font-bold">{t('result.explanation')}</h4>
                  <QuestionText text={item.explanation} />
                </>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
