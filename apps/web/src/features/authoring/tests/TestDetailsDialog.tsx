'use client';

import type { Series, Test, TestDetail } from '@mitaoe/shared';
import { Button, Checkbox, Dialog, InlineMessage, notify, TextField } from '@mitaoe/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { formatDay } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';

type Values = { title: string; company: string; scheduledDate: string; dayLabel: string; hideDay: boolean };
type Errors = Partial<Record<'title' | 'scheduledDate' | 'form', string>>;

/** TST-01: title and date are required and the date lies within the series dates. */
function check(v: Values, series: Pick<Series, 'startDate' | 'endDate'>): Errors {
  const errors: Errors = {};
  if (!v.title.trim()) errors.title = t('tests.titleMissing');
  if (!v.scheduledDate) errors.scheduledDate = t('tests.dateMissing');
  else if (v.scheduledDate < series.startDate || v.scheduledDate > series.endDate)
    errors.scheduledDate = t('tests.dateOutside', {
      from: formatDay(series.startDate),
      to: formatDay(series.endDate),
    });
  return errors;
}

/**
 * `Add test` on the series page and `Edit test details` in the test editor (TST-01, TST-02): an empty day label is
 * numbered by date, and the label can be hidden.
 */
export function TestDetailsDialog({
  series,
  test,
  onClose,
}: {
  series: Pick<Series, 'id' | 'startDate' | 'endDate'>;
  /** The test being edited; absent when adding one. */
  test?: Test;
  onClose: () => void;
}) {
  const { orgId } = useWorkspace();
  const qc = useQueryClient();
  const [v, setV] = useState<Values>({
    title: test?.title ?? '',
    company: test?.company ?? '',
    scheduledDate: test?.scheduledDate ?? '',
    dayLabel: test?.dayNumber ?? '',
    hideDay: test?.dayHidden ?? false,
  });
  const [errors, setErrors] = useState<Errors>({});
  const set = (k: 'title' | 'company' | 'scheduledDate' | 'dayLabel') => (e: { target: { value: string } }) =>
    setV((cur) => ({ ...cur, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: async () => {
      const details = {
        title: v.title.trim(),
        scheduledDate: v.scheduledDate,
        dayHidden: v.hideDay,
        company: v.company.trim() || null,
        dayNumber: v.dayLabel.trim() || null,
      };
      if (test) return api<TestDetail>(`/v1/tests/${encodeURIComponent(test.id)}`, { method: 'PATCH', body: details });
      const { company, ...rest } = details;
      return api<{ id: string }>('/v1/tests', {
        method: 'POST',
        body: { seriesId: series.id, ...rest, ...(company ? { company } : {}) },
      });
    },
    onSuccess: (saved) => {
      if (test) qc.setQueryData(qk.orgItem(orgId, 'tests', test.id), saved);
      // Day labels of the other tests can change with a new date, so the whole org cache is refreshed.
      void qc.invalidateQueries({ queryKey: qk.orgAll(orgId) });
      notify.success(t(test ? 'tests.detailsSaved' : 'tests.added'));
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.details.field === 'scheduledDate') setErrors({ scheduledDate: e.message });
      else setErrors({ form: e.message });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = check(v, series);
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  };
  const required = t('common.requiredMark');
  const title = t(test ? 'tests.editDetailsTitle' : 'tests.add');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('tests.title')}
          requiredText={required}
          value={v.title}
          onChange={set('title')}
          error={errors.title}
        />
        <TextField label={t('tests.company')} value={v.company} onChange={set('company')} />
        <TextField
          label={t('tests.scheduledDate')}
          requiredText={required}
          type="date"
          min={series.startDate}
          max={series.endDate}
          hint={t('tests.dateHint', { from: formatDay(series.startDate), to: formatDay(series.endDate) })}
          value={v.scheduledDate}
          onChange={set('scheduledDate')}
          error={errors.scheduledDate}
        />
        <TextField
          label={t('tests.dayLabel')}
          hint={t('tests.dayLabelHint')}
          value={v.dayLabel}
          onChange={set('dayLabel')}
        />
        <Checkbox
          label={t('tests.hideDay')}
          checked={v.hideDay}
          onCheckedChange={(hideDay) => setV((cur) => ({ ...cur, hideDay }))}
        />
        <InlineMessage>{errors.form ?? null}</InlineMessage>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t(test ? 'tests.saveDetails' : 'tests.add')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
