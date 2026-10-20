'use client';

import type { TestDetail } from '@mitaoe/shared';
import { Button, InlineMessage, notify, TextField } from '@mitaoe/ui';
import { useId, useRef, useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { ApiError } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { testDrawError } from './section-draft';
import { useSaveTest } from './useSaveSections';

/** US-AD-07, Q-04: how many of a test's approved questions each student gets, while the test has no sections. */
export function WholeTestDraw({ test, approved }: { test: TestDetail; approved: number }) {
  const [value, setValue] = useState(test.drawCount === undefined ? '' : String(test.drawCount));
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const save = useSaveTest(test);
  const { readOnly } = useWorkspace();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const problem = testDrawError(value, approved);
    setError(problem ?? null);
    if (problem) return input.current?.focus();
    save.mutate(
      { drawCount: value.trim() === '' ? null : Number(value) },
      {
        onSuccess: () => notify.success(t('sections.drawSaved')),
        onError: (err) => {
          if (err instanceof ApiError && err.details.field === 'drawCount') {
            setError(err.message);
            input.current?.focus();
          } else setFormError(t('common.saveFailed', { reason: err.message }));
        },
      },
    );
  };

  return (
    <section aria-labelledby={headingId} className="flex max-w-measure flex-col gap-3">
      <h2 id={headingId} className="text-heading-2 font-bold">
        {t('sections.wholeTest')}
      </h2>
      <p className="text-graphite">{t('sections.wholeTestLead')}</p>
      <form noValidate onSubmit={submit} className="flex flex-col items-start gap-3">
        <div className="w-64">
          <TextField
            ref={input}
            label={t('sections.draw')}
            hint={t('sections.drawHint')}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            error={error}
            disabled={readOnly}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={readOnly || save.isPending}>
          {t('sections.saveDraw')}
        </Button>
      </form>
      {formError ? <InlineMessage>{formError}</InlineMessage> : null}
    </section>
  );
}
