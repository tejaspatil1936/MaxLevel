'use client';

import type { Series } from '@mitaoe/shared';
import { Button, InlineMessage, PageHeader, Skeleton, TextAreaField, TextField } from '@mitaoe/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api, ApiError, serverNow } from '@/lib/api';
import { zoneName } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { resolveDraft, studentLookup, type StudentRef } from '../eligibility/eligibility-draft';
import { EligibilityEditor } from '../eligibility/EligibilityEditor';
import { useStudentRefs } from '../eligibility/useAuthoringData';
import { FormBar, useKeepAboveBar } from '../FormBar';
import { SettingsFields } from '../settings/SettingControl';
import { settingErrors, type SettingErrors } from '../settings/settings-draft';
import { detailErrors, initialSeriesForm, seriesBody, slotMinutes, type SeriesDetails } from './series-form';
import { seriesUrl } from './SeriesList';
import { SeriesNotFound } from './SeriesNotFound';

/** /admin/series/new/ */
export function NewSeries() {
  const students = useStudentRefs();
  return <SeriesForm students={students.data} />;
}

/** /admin/series/edit/?id=… (WEB-02: the ID travels in the search params). */
export function EditSeries() {
  const { orgId } = useWorkspace();
  const id = useSearchParams().get('id') ?? '';
  const series = useQuery({
    queryKey: qk.orgItem(orgId, 'series', id),
    queryFn: () => api<Series>(`/v1/series/${encodeURIComponent(id)}`),
    enabled: !!id,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  const students = useStudentRefs();
  if (!id || (series.error instanceof ApiError && series.error.status === 404)) return <SeriesNotFound />;
  if (series.isError) return <InlineMessage>{t('common.loadFailed')}</InlineMessage>;
  if (!series.data || !students.data)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-12 w-80" />
        <Skeleton className="mt-6 h-96 w-full" />
      </div>
    );
  return <SeriesForm series={series.data} students={students.data} />;
}

/** SER-01, US-AD-04: details, default settings and eligibility; a new series is saved as a draft. */
function SeriesForm({ series, students }: { series?: Series; students: readonly StudentRef[] | undefined }) {
  const { orgId, org, readOnly } = useWorkspace();
  const router = useRouter();
  const qc = useQueryClient();
  const initial = useMemo(() => initialSeriesForm(series, students ?? []), [series, students]);
  const [state, setState] = useState(initial);
  const [submitted, setSubmitted] = useState(0);
  const [resets, setResets] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const { barRef, onFocus } = useKeepAboveBar();
  const lookup = useMemo(() => (students ? studentLookup(students) : undefined), [students]);
  const zone = zoneName(org?.timezone ?? 'Asia/Kolkata', serverNow());
  const dirty = JSON.stringify(state) !== JSON.stringify(initial);
  const { details, settings } = state;

  // Field errors appear after a save attempt; the SER-09 combination is shown as soon as it is chosen.
  const allSettingErrors = settingErrors(settings);
  const shownSettings: SettingErrors = submitted ? allSettingErrors : { resultRelease: allSettingErrors.resultRelease };
  const shownDetails = submitted ? detailErrors(details) : {};
  const setDetail = (k: keyof SeriesDetails) => (e: { target: { value: string } }) =>
    setState((s) => ({ ...s, details: { ...s.details, [k]: e.target.value } }));

  // Focus the first field in error after a refused save (A11Y-11).
  useEffect(() => {
    if (submitted) document.querySelector<HTMLElement>('main [aria-invalid="true"]')?.focus();
  }, [submitted]);

  const save = useMutation({
    mutationFn: (body: ReturnType<typeof seriesBody>) =>
      series
        ? api<Series>(`/v1/series/${encodeURIComponent(series.id)}`, { method: 'PATCH', body }).then(() => series.id)
        : api<{ id: string }>('/v1/series', { method: 'POST', body }).then((r) => r.id),
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: qk.orgAll(orgId) });
      router.push(seriesUrl(id));
    },
    onError: (e) => setFormError(t('common.saveFailed', { reason: e.message })),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const { rules, unknown } = resolveDraft(state.eligibility, lookup);
    const invalid =
      Object.keys(detailErrors(details)).length > 0 ||
      Object.keys(allSettingErrors).length > 0 ||
      unknown.include.length + unknown.exclude.length > 0;
    if (invalid) return setSubmitted((n) => n + 1);
    save.mutate(seriesBody(state, rules, series));
  };
  const discard = () => {
    setState(initial);
    setSubmitted(0);
    setFormError(null);
    setResets((n) => n + 1);
  };

  const required = t('common.requiredMark');
  const err = (k: keyof SeriesDetails) => (shownDetails[k] ? t(shownDetails[k]) : null);
  const hasEntries = !!(state.eligibility.include.trim() || state.eligibility.exclude.trim());
  return (
    <form noValidate onSubmit={submit} onFocus={onFocus} className="flex flex-col gap-8 pb-40">
      <PageHeader title={t(series ? 'series.edit' : 'series.new')} />
      <section aria-labelledby="series-details" className="flex max-w-measure flex-col gap-5">
        <h2 id="series-details" className="text-heading-2 font-bold">
          {t('series.details')}
        </h2>
        <TextField
          label={t('series.title')}
          requiredText={required}
          value={details.title}
          onChange={setDetail('title')}
          error={err('title')}
        />
        <TextAreaField
          label={t('series.description')}
          rows={3}
          value={details.description}
          onChange={setDetail('description')}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          {(['startDate', 'endDate'] as const).map((k) => (
            <TextField
              key={k}
              type="date"
              label={t(`series.${k}`)}
              requiredText={required}
              value={details[k]}
              onChange={setDetail(k)}
              error={err(k)}
            />
          ))}
          {(['dailyStart', 'dailyEnd'] as const).map((k) => (
            <TextField
              key={k}
              type="time"
              label={t(`series.${k}`)}
              requiredText={required}
              value={details[k]}
              onChange={setDetail(k)}
              error={err(k)}
            />
          ))}
        </div>
        <p className="text-body-small text-graphite">{t('series.dailyHint', { zone })}</p>
      </section>
      <fieldset className="flex flex-col gap-4 rounded-panel border border-rule bg-surface p-5">
        <legend className="px-1 text-heading-2 font-bold">{t('series.defaults')}</legend>
        <p className="text-graphite">{t('series.defaultsLead')}</p>
        <SettingsFields
          draft={settings}
          onChange={(patch) => setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }))}
          errors={shownSettings}
          slotMinutes={slotMinutes(details)}
          disabled={readOnly}
        />
      </fieldset>
      <EligibilityEditor
        key={resets}
        scope="series"
        value={state.eligibility}
        onChange={(eligibility) => setState((s) => ({ ...s, eligibility }))}
        previewPath={`/v1/series/${encodeURIComponent(series?.id ?? 'new')}/eligibility/preview`}
        students={students}
        showErrors={submitted > 0}
        disabled={readOnly}
      />
      {formError ? <InlineMessage>{formError}</InlineMessage> : null}
      <FormBar barRef={barRef} dirty={dirty}>
        <Button variant="secondary" onClick={discard}>
          {t('common.discard')}
        </Button>
        <Button type="submit" disabled={readOnly || save.isPending || (!students && hasEntries)}>
          {t(series ? 'common.saveChanges' : 'series.create')}
        </Button>
      </FormBar>
    </form>
  );
}
