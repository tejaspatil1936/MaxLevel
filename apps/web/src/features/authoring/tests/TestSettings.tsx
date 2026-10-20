'use client';

import type { Series, Settings, SettingsOverrides, TestDetail } from '@mitaoe/shared';
import { Button, cx, InlineMessage, notify, StatusPill, Switch, TextField } from '@mitaoe/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { t } from '@/i18n';
import { api, serverNow } from '@/lib/api';
import { formatCount, zonedParts, zoneName } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { FormBar, useKeepAboveBar } from '../FormBar';
import { optionLabel, SettingControl } from '../settings/SettingControl';
import { settingShown, type ChoiceKey, type SettingsDraft } from '../settings/settings-draft';
import {
  draftWindow,
  initialTestSettings,
  overridesFromState,
  seriesSettings,
  setOverridden,
  TEST_SETTING_KEYS,
  testSettingErrors,
  type OverrideKey,
  type TestSettingErrors,
  type WindowDraft,
} from '../settings/test-settings';

/** The series value of a setting as the series form shows it: `3`, `60 minutes`, `On`, an option label. */
function seriesValueText(key: OverrideKey, base: Settings, timeZone: string): string {
  if (key === 'window') {
    if (!base.window) return t('tests.noWindow');
    return t('tests.seriesWindow', {
      start: zonedParts(base.window.start, timeZone).time,
      end: zonedParts(base.window.end, timeZone).time,
      zone: zoneName(timeZone, base.window.start),
    });
  }
  const value = base[key];
  if (typeof value === 'boolean') return t(value ? 'a11y.on' : 'a11y.off');
  if (key === 'durationMin' || key === 'lateEntryCutoffMin')
    return t(value === 1 ? 'tests.minute' : 'tests.minutes', { n: formatCount(value as number) });
  if (typeof value === 'number') return formatCount(value);
  return optionLabel(key as ChoiceKey, value as SettingsDraft[ChoiceKey]);
}

/** One setting: Inherited with the series value, or Overridden with its control and a ballpoint left rule (13). */
function SettingGroup(p: {
  label: string;
  overridden: boolean;
  seriesValue: string;
  onOverride: (on: boolean) => void;
  disabled?: boolean;
  /** Shown even while inherited, for the SER-09 combination. */
  note?: string | null;
  children: ReactNode;
}) {
  const id = useId();
  const hidden = <span className="sr-only"> {p.label}</span>;
  return (
    <div
      role="group"
      aria-labelledby={id}
      className={cx(
        'flex flex-col gap-3 border-b border-l-4 border-rule py-4 pr-2 pl-4',
        p.overridden ? 'border-l-ballpoint' : 'border-l-transparent',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p id={id} className="font-bold">
          {p.label}
        </p>
        <StatusPill tone={p.overridden ? 'info' : 'muted'}>
          {t(p.overridden ? 'tests.overridden' : 'tests.inherited')}
        </StatusPill>
        <div className="ml-auto">
          <Switch
            label={
              <>
                {t('tests.override')}
                {hidden}
              </>
            }
            checked={p.overridden}
            disabled={p.disabled}
            onCheckedChange={p.onOverride}
          />
        </div>
      </div>
      {p.overridden ? (
        <>
          {p.children}
          <Button
            variant="ghost"
            className="self-start"
            aria-label={t('tests.useSeriesValueFor', { label: p.label })}
            disabled={p.disabled}
            onClick={() => p.onOverride(false)}
          >
            {t('tests.useSeriesValue')}
          </Button>
        </>
      ) : (
        <>
          <p className="text-graphite">{t('tests.fromSeries', { value: p.seriesValue })}</p>
          {p.note ? <p className="text-body-small font-bold text-redpen">{p.note}</p> : null}
        </>
      )}
    </div>
  );
}

function WindowFields(p: {
  value: WindowDraft;
  onChange: (w: WindowDraft) => void;
  errors: TestSettingErrors;
  zone: string;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(['start', 'end'] as const).map((k) => {
        const error = p.errors[k === 'start' ? 'windowStart' : 'windowEnd'];
        return (
          <TextField
            key={k}
            type="datetime-local"
            label={t(k === 'start' ? 'setting.windowStart' : 'setting.windowEnd')}
            hint={t('tests.windowHint', { zone: p.zone })}
            value={p.value[k]}
            disabled={p.disabled}
            onChange={(e) => p.onChange({ ...p.value, [k]: e.target.value })}
            error={error ? t(error) : null}
          />
        );
      })}
    </div>
  );
}

/** The Settings tab (TST-03, US-AD-05): every setting inherited from the series or overridden for this test. */
export function TestSettings({ test, series }: { test: TestDetail; series: Series }) {
  const { orgId, org, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const tz = org?.timezone ?? 'Asia/Kolkata';
  const base = useMemo(() => seriesSettings(series, test.scheduledDate, tz), [series, test.scheduledDate, tz]);
  const initial = useMemo(() => initialTestSettings(base, test.overrides, tz), [base, test.overrides, tz]);
  const [state, setState] = useState(initial);
  const [submitted, setSubmitted] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const { barRef, onFocus } = useKeepAboveBar();
  const dirty = JSON.stringify(state) !== JSON.stringify(initial);
  const zone = zoneName(tz, base.window?.start ?? serverNow());

  // Field errors appear after a save attempt; the SER-09 combination as soon as it is chosen.
  const errors = testSettingErrors(state, tz);
  const shown: TestSettingErrors = submitted ? errors : { resultRelease: errors.resultRelease };
  useEffect(() => {
    if (submitted) document.querySelector<HTMLElement>('main [aria-invalid="true"]')?.focus();
  }, [submitted]);

  const save = useMutation({
    mutationFn: (overrides: SettingsOverrides) =>
      api<TestDetail>(`/v1/tests/${encodeURIComponent(test.id)}`, { method: 'PATCH', body: { overrides } }),
    onSuccess: async (saved) => {
      qc.setQueryData(qk.orgItem(orgId, 'tests', test.id), saved);
      notify.success(t('tests.settingsSaved'));
      await qc.invalidateQueries({ queryKey: qk.orgAll(orgId) });
    },
    onError: (e) => setFormError(t('common.saveFailed', { reason: e.message })),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (Object.keys(errors).length) return setSubmitted((n) => n + 1);
    save.mutate(overridesFromState(state, test.overrides, base, tz));
  };
  const discard = () => {
    setState(initial);
    setSubmitted(0);
    setFormError(null);
  };

  const inForce = draftWindow(state, base, tz);
  const slot = inForce ? Math.round((inForce.end - inForce.start) / 60_000) : null;
  const keys = TEST_SETTING_KEYS.filter((k) => k === 'window' || settingShown(k, state.draft));
  return (
    <form noValidate onSubmit={submit} onFocus={onFocus} className="flex max-w-measure flex-col pb-40">
      <p className="mb-2 text-graphite">{t('tests.settingsLead')}</p>
      {keys.map((k) => {
        const overridden = state.overridden.includes(k);
        const error = k === 'window' ? undefined : shown[k];
        return (
          <SettingGroup
            key={k}
            label={t(`setting.${k}`)}
            overridden={overridden}
            seriesValue={seriesValueText(k, base, tz)}
            onOverride={(on) => setState((s) => setOverridden(s, k, on, base, tz))}
            disabled={readOnly}
            note={k === 'resultRelease' && shown.resultRelease ? t(shown.resultRelease) : null}
          >
            {k === 'window' ? (
              <WindowFields
                value={state.window}
                onChange={(w) => setState((s) => ({ ...s, window: w }))}
                errors={shown}
                zone={zone}
                disabled={readOnly}
              />
            ) : (
              <SettingControl
                setting={k}
                draft={state.draft}
                onChange={(patch) => setState((s) => ({ ...s, draft: { ...s.draft, ...patch } }))}
                error={error ? t(error) : null}
                slotMinutes={slot}
                disabled={readOnly}
              />
            )}
          </SettingGroup>
        );
      })}
      {formError ? <InlineMessage>{formError}</InlineMessage> : null}
      <FormBar barRef={barRef} dirty={dirty}>
        <Button variant="secondary" onClick={discard}>
          {t('common.discard')}
        </Button>
        <Button type="submit" disabled={readOnly || save.isPending}>
          {t('tests.saveSettings')}
        </Button>
      </FormBar>
    </form>
  );
}
