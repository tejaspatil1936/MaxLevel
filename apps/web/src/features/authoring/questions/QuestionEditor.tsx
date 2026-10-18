'use client';

import { problemText, type Question, type QuestionList, type TestDetail } from '@mitaoe/shared';
import { Button, Dialog, InlineMessage, notify, SelectField, TextAreaField, TextField } from '@mitaoe/ui';
import { useMutation } from '@tanstack/react-query';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { QuestionView } from '../../exam/QuestionView';
import { ImageFields, OptionFields } from './EditorFields';
import {
  draftErrors,
  draftFrom,
  draftProblems,
  draftToCreate,
  draftToPatch,
  type QuestionDraft,
} from './question-draft';
import { questionsPath } from './useQuestions';

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

/**
 * Q-01, A11Y-10: write or edit a question beside a live Student view, with the checks of DECISIONS Q17 listed under
 * `Needs attention` as they change. A question with problems is still saved, as a draft.
 */
export function QuestionEditor({
  test,
  list,
  editing,
  onSaved,
  onClose,
}: {
  test: TestDetail;
  list: QuestionList;
  /** The question being edited and its position; absent when adding one. */
  editing?: { question: Question; n: number };
  onSaved: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [d, setD] = useState<QuestionDraft>(() => draftFrom(editing?.question, list.imageUrls));
  const [tried, setTried] = useState(false);
  const [uploading, setUploading] = useState(false);
  const previewId = useId();
  const problemsId = useId();
  const set = <K extends keyof QuestionDraft>(k: K, v: QuestionDraft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const text = (k: 'prompt' | 'explanation' | 'marks' | 'negativeMarks' | 'timeLimit' | 'tags') => ({
    value: d[k],
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
  });

  // The test's questions in order, this one's own slot blank, so a duplicate is named by its position.
  const others = useMemo(
    () => list.items.map((q) => (q.id === editing?.question.id ? { prompt: '' } : q)),
    [list.items, editing],
  );
  const problems = draftProblems(d, others);
  const errors = draftErrors(d);
  const shownErrors = tried ? errors : {};

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api<{ id: string }>(`${questionsPath(test.id)}/${encodeURIComponent(editing.question.id)}`, {
            method: 'PATCH',
            body: draftToPatch(d),
          })
        : api<{ id: string }>(questionsPath(test.id), { method: 'POST', body: draftToCreate(d) }),
    onSuccess: async () => {
      await onSaved();
      notify.success(t('questions.saved'));
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length === 0 && !uploading) save.mutate();
  };

  const options = d.options;
  const title = editing ? t('questions.editTitle', { n: editing.n }) : t('questions.add');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title} size="wide">
      <form noValidate onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <TextAreaField label={t('questions.prompt')} hint={t('questions.promptHint')} rows={6} {...text('prompt')} />
          <OptionFields draft={d} setDraft={setD} />
          <TextAreaField label={t('questions.explanation')} rows={3} {...text('explanation')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={t('questions.difficulty')}
              value={d.difficulty}
              onChange={(e) => set('difficulty', e.target.value as QuestionDraft['difficulty'])}
              options={[
                { value: '', label: t('questions.difficulty.none') },
                ...DIFFICULTIES.map((x) => ({ value: x, label: t(`questions.difficulty.${x}`) })),
              ]}
            />
            {test.sections.length ? (
              <SelectField
                label={t('questions.section')}
                value={d.sectionId}
                onChange={(e) => set('sectionId', e.target.value)}
                options={[
                  { value: '', label: t('questions.noSection') },
                  ...test.sections.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            ) : null}
            <TextField
              label={t('questions.marks')}
              hint={t('questions.marksHint')}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              error={shownErrors.marks && t(shownErrors.marks)}
              {...text('marks')}
            />
            <TextField
              label={t('questions.negativeMarks')}
              hint={t('questions.marksHint')}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              error={shownErrors.negativeMarks && t(shownErrors.negativeMarks)}
              {...text('negativeMarks')}
            />
            {test.effective.questionTimeMode === 'each' ? (
              <TextField
                label={t('questions.timeLimit')}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                error={shownErrors.timeLimit && t(shownErrors.timeLimit)}
                {...text('timeLimit')}
              />
            ) : null}
          </div>
          <TextField label={t('questions.tags')} hint={t('questions.tagsHint')} {...text('tags')} />
          <ImageFields testId={test.id} draft={d} setDraft={setD} uploading={uploading} setUploading={setUploading} />
        </div>
        <div className="flex min-w-0 flex-col gap-4 self-start lg:sticky lg:top-0">
          <section aria-labelledby={previewId} className="rounded-panel border border-rule bg-sheet p-4">
            <h3 id={previewId} className="mb-3 text-heading-3 font-bold">
              {t('questions.studentView')}
            </h3>
            <QuestionView prompt={d.prompt} images={d.images} options={options.filter((o) => o.text.trim() !== '')} />
          </section>
          <div aria-live="polite">
            {problems.length ? (
              <div className="rounded-panel border border-redpen bg-redpen-wash p-4">
                <h3 id={problemsId} className="text-heading-3 font-bold">
                  {t('questions.needsAttention')}
                </h3>
                <p className="mt-1 text-body-small">{t('questions.draftNote')}</p>
                <ul aria-labelledby={problemsId} className="mt-2 list-disc pl-5">
                  {problems.map((p) => (
                    <li key={problemText(p)}>{problemText(p)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-3 lg:col-span-2">
          {save.isError ? <InlineMessage>{save.error.message}</InlineMessage> : null}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending || uploading}>
              {t('questions.save')}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
