'use client';

import { MARKING_PRESET_IDS, type Series, type SettingsOverrides, type TestDetail } from '@mitaoe/shared';
import { Button, InlineMessage, notify, RadioGroup, TextField } from '@mitaoe/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { FormBar, useKeepAboveBar } from '../FormBar';
import { seriesSettings } from '../settings/test-settings';
import {
  choosePreset,
  editValue,
  markingDraft,
  markingErrors,
  markingOverrides,
  type MarkingDraft,
  type TimeMode,
} from './marking-draft';

const TIME_MODES: readonly TimeMode[] = ['none', 'same', 'each'];

/**
 * Q-08, Q-10: the test's marking scheme (a preset fills values that stay editable) and its per-question time limit:
 * none, the same for every question, or set on each question in the question editor.
 */
export function MarkingTab({ test, series }: { test: TestDetail; series: Series }) {
  const { orgId, org, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const tz = org?.timezone ?? 'Asia/Kolkata';
  const base = useMemo(() => seriesSettings(series, test.scheduledDate, tz), [series, test.scheduledDate, tz]);
  const initial = useMemo(() => markingDraft(test.effective), [test.effective]);
  const [d, setD] = useState<MarkingDraft>(initial);
  const [submitted, setSubmitted] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const { barRef, onFocus } = useKeepAboveBar();
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const errors = markingErrors(d);
  const shown = submitted ? errors : {};
  // A11Y-11: after a refused save, focus moves to the first field in error.
  useEffect(() => {
    if (submitted) document.querySelector<HTMLElement>('main [aria-invalid="true"]')?.focus();
  }, [submitted]);

  const save = useMutation({
    mutationFn: (overrides: SettingsOverrides) =>
      api<TestDetail>(`/v1/tests/${encodeURIComponent(test.id)}`, { method: 'PATCH', body: { overrides } }),
    onSuccess: async (saved) => {
      qc.setQueryData(qk.orgItem(orgId, 'tests', test.id), saved);
      notify.success(t('marking.saved'));
      await qc.invalidateQueries({ queryKey: qk.orgAll(orgId) });
    },
    onError: (e) => setFormError(t('common.saveFailed', { reason: e.message })),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (Object.keys(errors).length) return setSubmitted((n) => n + 1);
    save.mutate(markingOverrides(d, test.overrides, base));
  };
  const discard = () => {
    setD(initial);
    setSubmitted(0);
    setFormError(null);
  };
  const value = { type: 'number', inputMode: 'decimal', min: 0, step: 'any', disabled: readOnly } as const;
  const error = (k: keyof typeof shown) => (shown[k] ? t(shown[k]) : null);

  return (
    <form noValidate onSubmit={submit} onFocus={onFocus} className="flex max-w-measure flex-col gap-8 pb-40">
      <section className="flex flex-col gap-4">
        <h2 className="text-heading-2 font-bold">{t('marking.heading')}</h2>
        <p className="text-graphite">{t('marking.lead')}</p>
        <RadioGroup
          label={t('marking.scheme')}
          value={d.preset}
          onValueChange={(p) => setD((cur) => choosePreset(cur, p))}
          options={MARKING_PRESET_IDS.map((p) => ({ value: p, label: t(`marking.preset.${p}`) }))}
          disabled={readOnly}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('marking.marks')}
            {...value}
            value={d.marks}
            onChange={(e) => setD((cur) => editValue(cur, 'marks', e.target.value))}
            error={error('marks')}
          />
          <TextField
            label={t('marking.negative')}
            hint={t('marking.negativeHint')}
            {...value}
            value={d.negativeMarks}
            onChange={(e) => setD((cur) => editValue(cur, 'negativeMarks', e.target.value))}
            error={error('negativeMarks')}
          />
        </div>
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-heading-2 font-bold">{t('marking.timersHeading')}</h2>
        <RadioGroup
          label={t('marking.timeLimit')}
          orientation="vertical"
          value={d.timeMode}
          onValueChange={(timeMode) => setD((cur) => ({ ...cur, timeMode }))}
          options={TIME_MODES.map((m) => ({ value: m, label: t(`marking.time.${m}`) }))}
          disabled={readOnly}
        />
        {d.timeMode === 'same' ? (
          <div className="w-64">
            <TextField
              label={t('marking.seconds')}
              {...value}
              inputMode="numeric"
              min={1}
              step={1}
              value={d.seconds}
              onChange={(e) => setD((cur) => ({ ...cur, seconds: e.target.value }))}
              error={error('seconds')}
            />
          </div>
        ) : null}
        {d.timeMode === 'each' ? <p className="text-graphite">{t('marking.eachHint')}</p> : null}
      </section>
      {formError ? <InlineMessage>{formError}</InlineMessage> : null}
      <FormBar barRef={barRef} dirty={dirty}>
        <Button variant="secondary" onClick={discard}>
          {t('common.discard')}
        </Button>
        <Button type="submit" disabled={readOnly || save.isPending}>
          {t('marking.save')}
        </Button>
      </FormBar>
    </form>
  );
}
