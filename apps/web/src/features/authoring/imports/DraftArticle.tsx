'use client';

import type { ImportDraft, ImportJobView } from '@mitaoe/shared';
import { cx } from '@mitaoe/ui';
import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { formatCount } from '@/lib/format';
import { optionLetter, QuestionPrompt, QuestionText } from '../../exam/QuestionView';

export const draftArticleId = (draftId: string) => `import-draft-${draftId}`;
export const draftHeadingId = (draftId: string) => `import-draft-${draftId}-heading`;

/** Where the draft came from: `Page 2` of a PDF, `Row 3` of a template sheet, `Part 1` of text the model read. */
export function draftSourceLabel(job: Pick<ImportJobView, 'format' | 'provider'>, page: number): string | null {
  if (job.format === 'pdf') return t('imports.source.page', { n: formatCount(page) });
  if (job.format === 'json') return null;
  if ((job.format === 'csv' || job.format === 'xlsx') && !job.provider)
    return t('imports.source.row', { n: formatCount(page) });
  return t('imports.source.part', { n: formatCount(page) });
}

/** `Correct answer: B`, `Correct answer: none`, or `Correct answers: A, B`. */
export function answerText(draft: Pick<ImportDraft, 'options' | 'correctOptionIds'>): string {
  const letters = draft.options.flatMap((o, i) => (draft.correctOptionIds.includes(o.id) ? [optionLetter(i)] : []));
  if (!letters.length) return t('imports.answerNone');
  if (letters.length === 1) return t('imports.answer', { letter: letters[0]! });
  return t('imports.answers', { letters: letters.join(', ') });
}

const LEVEL = {
  easy: 'questions.difficulty.easy',
  medium: 'questions.difficulty.medium',
  hard: 'questions.difficulty.hard',
} as const;

/** A draft as students would see it, with what the import found about it (docs/testids/phase-6.md, "Inside a draft"). */
export function DraftBody({
  job,
  draft,
  imageUrls,
}: {
  job: Pick<ImportJobView, 'format' | 'provider'>;
  draft: ImportDraft;
  imageUrls: Record<string, string>;
}) {
  const source = draftSourceLabel(job, draft.sourcePage);
  const level = draft.difficulty ? t(LEVEL[draft.difficulty]) : null;
  return (
    <>
      {source ? <p className="text-body-small text-graphite">{source}</p> : null}
      {draft.flags.length ? (
        <div className="rounded-control border border-redpen bg-redpen-wash p-3">
          <p id={`${draftArticleId(draft.id)}-reasons`} className="font-bold">
            {t('imports.reasons')}
          </p>
          <ul aria-labelledby={`${draftArticleId(draft.id)}-reasons`} className="mt-1 list-disc pl-5">
            {draft.flags.map((f) => (
              <li key={f.code + f.text}>{f.text}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <QuestionPrompt
        prompt={draft.prompt}
        images={draft.images.map((img) => ({ src: imageUrls[img.path] ?? null, alt: img.alt }))}
      />
      <ul aria-label={t('questions.options')} className="flex flex-col gap-2">
        {draft.options.map((o, i) => (
          <li
            key={o.id}
            className="flex min-h-12 items-center gap-3 rounded-control border border-rule bg-surface px-3 py-2"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-dropout font-bold">
              {optionLetter(i)}
              <span className="sr-only">{t('imports.letterEnd')}</span>
            </span>{' '}
            <QuestionText text={o.text} />
          </li>
        ))}
      </ul>
      <p className="font-bold">{answerText(draft)}</p>
      {level ? (
        <p>
          {draft.difficultySuggested ? t('imports.suggestedDifficulty', { level }) : t('imports.difficulty', { level })}
        </p>
      ) : null}
      {draft.sectionName ? <p>{t('imports.section', { name: draft.sectionName })}</p> : null}
      {draft.explanation ? (
        <div>
          <p className="font-bold">{t('imports.explanation')}</p>
          <QuestionText text={draft.explanation} />
        </div>
      ) : null}
    </>
  );
}

/**
 * One draft as an `article` named by its number (IMP-11): focusable, and made current when clicked or focused, so the
 * source page beside it and the review keys follow it.
 */
export function DraftArticle({
  draft,
  current,
  onSelect,
  children,
}: {
  draft: ImportDraft;
  current: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <article
      id={draftArticleId(draft.id)}
      aria-labelledby={draftHeadingId(draft.id)}
      aria-current={current ? 'true' : undefined}
      tabIndex={-1}
      onFocus={onSelect}
      onClick={onSelect}
      className={cx(
        'flex scroll-mt-4 flex-col gap-4 rounded-panel border bg-surface p-4',
        current ? 'border-ballpoint border-l-4' : 'border-rule',
      )}
    >
      <h3 id={draftHeadingId(draft.id)} className="text-heading-3 font-bold">
        {t('imports.draft', { n: formatCount(draft.order) })}
      </h3>
      {children}
    </article>
  );
}
