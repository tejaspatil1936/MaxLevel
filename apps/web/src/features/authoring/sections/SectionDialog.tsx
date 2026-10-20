'use client';

import { DIFFICULTIES, type Section, type TestDetail } from '@mitaoe/shared';
import { Button, Checkbox, Dialog, InlineMessage, notify, TextAreaField, TextField } from '@mitaoe/ui';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { ApiError } from '@/lib/api';
import {
  sectionDraft,
  sectionErrors,
  sectionFromDraft,
  serverFieldError,
  type PoolQuestions,
  type SectionDraft,
  type SectionErrors,
  type SectionInput,
} from './section-draft';
import { useSaveSections } from './useSaveSections';

/**
 * Q-03, Q-05, US-AD-07: add or edit a section. The draw and the difficulty mix are checked against the section's
 * approved questions before saving, and the server checks them again.
 */
export function SectionDialog({
  test,
  section,
  pool,
  onClose,
}: {
  test: TestDetail;
  /** The section being edited; absent when adding one. */
  section?: Section;
  /** The section's approved questions. */
  pool: PoolQuestions;
  onClose: () => void;
}) {
  const [d, setD] = useState<SectionDraft>(() => sectionDraft(section));
  const [tried, setTried] = useState(0);
  const [server, setServer] = useState<SectionErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const mixId = useId();
  const save = useSaveSections(test);
  const errors = sectionErrors(d, pool);
  const shown: SectionErrors = tried ? { ...server, ...errors } : server;
  // A11Y-11: after a refused save, focus moves to the first field in error.
  useEffect(() => {
    if (tried) document.querySelector<HTMLElement>('[role=dialog] [aria-invalid="true"]')?.focus();
  }, [tried]);

  const change = (patch: Partial<SectionDraft>) => {
    setD((cur) => ({ ...cur, ...patch }));
    setServer({});
  };
  const text = (k: 'name' | 'instructions' | 'durationMin' | 'drawCount' | 'marks' | 'negativeMarks') => ({
    value: d[k],
    onChange: (e: { target: { value: string } }) => change({ [k]: e.target.value }),
    error: shown[k as keyof SectionErrors] ?? null,
  });
  const number = { type: 'number', inputMode: 'numeric', min: 0, step: 1 } as const;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setTried((n) => n + 1);
    if (Object.keys(errors).length) return;
    const ordered = [...test.sections].sort((a, b) => a.order - b.order);
    const list: SectionInput[] = section
      ? ordered.map((s) => (s.id === section.id ? sectionFromDraft(d, { id: s.id, order: s.order }) : s))
      : [...ordered, sectionFromDraft(d, { order: ordered.length + 1 })];
    save.mutate(list, {
      onSuccess: () => {
        notify.success(t('sections.saved'));
        onClose();
      },
      onError: (err) => {
        const field = err instanceof ApiError ? serverFieldError(err) : null;
        if (field) setServer(field);
        else setFormError(t('common.saveFailed', { reason: err.message }));
      },
    });
  };

  const title = section ? t('sections.editTitle', { name: section.name }) : t('sections.add');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <TextField label={t('sections.name')} requiredText={t('common.requiredMark')} {...text('name')} />
        <TextAreaField
          label={t('sections.instructions')}
          hint={t('sections.instructionsHint')}
          rows={3}
          {...text('instructions')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('sections.duration')}
            hint={t('sections.durationHint')}
            {...number}
            {...text('durationMin')}
          />
          <TextField label={t('sections.draw')} hint={t('sections.drawHint')} {...number} {...text('drawCount')} />
        </div>
        <Checkbox
          label={t('sections.forwardOnlyLabel')}
          checked={d.forwardOnly}
          onCheckedChange={(forwardOnly) => change({ forwardOnly })}
        />
        <fieldset aria-describedby={`${mixId}-hint`} className="flex flex-col gap-2">
          <legend className="font-bold">{t('sections.mix')}</legend>
          <p id={`${mixId}-hint`} className="text-body-small text-graphite">
            {t('sections.mixHint')}
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {DIFFICULTIES.map((k) => (
              <TextField
                key={k}
                label={t(`sections.${k}`)}
                {...number}
                value={d.mix[k]}
                onChange={(e) => change({ mix: { ...d.mix, [k]: e.target.value } })}
                error={shown[k] ?? null}
              />
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('questions.marks')}
            hint={t('sections.marksHint')}
            {...number}
            inputMode="decimal"
            step="any"
            {...text('marks')}
          />
          <TextField
            label={t('questions.negativeMarks')}
            hint={t('sections.marksHint')}
            {...number}
            inputMode="decimal"
            step="any"
            {...text('negativeMarks')}
          />
        </div>
        {formError ? <InlineMessage>{formError}</InlineMessage> : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t('sections.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
