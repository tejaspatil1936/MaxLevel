'use client';

import type { ImportDraft } from '@mitaoe/shared';
import { Button, InlineMessage, SelectField, TextAreaField, TextField } from '@mitaoe/ui';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { OptionFields } from '../questions/EditorFields';
import type { QuestionDraft } from '../questions/question-draft';
import { formFrom, patchFrom } from './draft-form';
import { importJobPath } from './useDraftReview';

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

/**
 * IMP-12: the article turns into the question editor's fields, with `Save changes` and `Cancel` (or Escape). Focus
 * starts in `Question text`.
 */
export function DraftEditForm({
  jobId,
  draft,
  imageUrls,
  onSaved,
  onCancel,
}: {
  jobId: string;
  draft: ImportDraft;
  imageUrls: Record<string, string>;
  onSaved: (saved: ImportDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [before] = useState(() => formFrom(draft, imageUrls));
  const [d, setD] = useState(before);
  const form = useRef<HTMLFormElement>(null);
  const set = <K extends keyof QuestionDraft>(k: K, v: QuestionDraft[K]) => setD((cur) => ({ ...cur, [k]: v }));

  useEffect(() => form.current?.querySelector('textarea')?.focus(), []);

  const save = useMutation({
    mutationFn: () =>
      api<ImportDraft>(`${importJobPath(jobId)}/drafts/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        body: patchFrom(before, d),
      }),
    onSuccess: onSaved,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!save.isPending) save.mutate();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  };

  return (
    <form ref={form} noValidate onSubmit={submit} onKeyDown={onKeyDown} className="flex flex-col gap-4">
      <TextAreaField
        label={t('questions.prompt')}
        rows={4}
        value={d.prompt}
        onChange={(e) => set('prompt', e.target.value)}
      />
      <OptionFields draft={d} setDraft={setD} />
      <TextAreaField
        label={t('questions.explanation')}
        rows={3}
        value={d.explanation}
        onChange={(e) => set('explanation', e.target.value)}
      />
      <SelectField
        label={t('questions.difficulty')}
        value={d.difficulty}
        onChange={(e) => set('difficulty', e.target.value as QuestionDraft['difficulty'])}
        options={[
          { value: '', label: t('questions.difficulty.none') },
          ...DIFFICULTIES.map((x) => ({ value: x, label: t(`questions.difficulty.${x}`) })),
        ]}
      />
      {d.images.map((img, i) => (
        <div key={img.path} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              label={t('questions.altText', { n: i + 1 })}
              hint={t('questions.altHint')}
              value={img.alt}
              onChange={(e) =>
                set(
                  'images',
                  d.images.map((x) => (x.path === img.path ? { ...x, alt: e.target.value } : x)),
                )
              }
            />
          </div>
          <Button
            variant="ghost"
            aria-label={t('questions.removeImage', { n: i + 1 })}
            onClick={() =>
              set(
                'images',
                d.images.filter((x) => x.path !== img.path),
              )
            }
          >
            <X aria-hidden size={18} />
          </Button>
        </div>
      ))}
      {save.isError ? <InlineMessage>{save.error.message}</InlineMessage> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {t('common.saveChanges')}
        </Button>
      </div>
    </form>
  );
}
