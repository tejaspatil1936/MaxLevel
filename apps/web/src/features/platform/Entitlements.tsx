'use client';

import { FEATURE_FLAGS, LIMIT_KEYS, type FeatureFlag, type LimitKey, type PlatformOrgDetail } from '@mitaoe/shared';
import { Button, InlineMessage, Switch, Table } from '@mitaoe/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { t, type MessageKey } from '@/i18n';
import { api } from '@/lib/api';
import { formatCount } from '@/lib/format';

export const FEATURE_LABEL: Record<FeatureFlag, MessageKey> = {
  ai_question_import: 'feature.ai_question_import',
  question_pools: 'feature.question_pools',
  sections: 'feature.sections',
  negative_marking: 'feature.negative_marking',
  per_question_timer: 'feature.per_question_timer',
  second_camera: 'feature.second_camera',
  public_leaderboards: 'feature.public_leaderboards',
  extra_time_grants: 'feature.extra_time_grants',
  results_export: 'feature.results_export',
  analytics_reports: 'feature.analytics_reports',
};
const LIMIT_LABEL: Record<LimitKey, MessageKey> = {
  max_students: 'limit.max_students',
  max_admins: 'limit.max_admins',
  ai_imports_per_month: 'limit.ai_imports_per_month',
  ai_reports_per_month: 'limit.ai_reports_per_month',
  storage_gb: 'limit.storage_gb',
};

export function Entitlements({
  org,
  onSaved,
  readOnly,
}: {
  org: PlatformOrgDetail;
  onSaved: (o: PlatformOrgDetail) => void;
  readOnly: boolean;
}) {
  const [features, setFeatures] = useState(org.entitlements.features);
  const [limits, setLimits] = useState(
    () =>
      Object.fromEntries(LIMIT_KEYS.map((k) => [k, String(org.entitlements.limits[k])])) as Record<LimitKey, string>,
  );
  const [errors, setErrors] = useState<Partial<Record<LimitKey, string>>>({});
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api<PlatformOrgDetail>(`/v1/platform/orgs/${encodeURIComponent(org.id)}/entitlements`, {
        method: 'PUT',
        body: {
          featureOverrides: features,
          limitOverrides: Object.fromEntries(LIMIT_KEYS.map((k) => [k, Number(limits[k])])),
        },
      }),
    onSuccess: (o) => {
      onSaved(o);
      setSaved(true);
    },
  });

  const submit = () => {
    const next: Partial<Record<LimitKey, string>> = {};
    for (const k of LIMIT_KEYS) if (!/^\d+$/.test(limits[k].trim())) next[k] = t('limit.invalid');
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  };

  return (
    <section aria-labelledby="entitlements" className="mt-10">
      <h2 id="entitlements" className="mb-3 text-heading-1 font-bold">
        {t('org.entitlementsTitle')}
      </h2>
      <div className="grid gap-x-8 gap-y-1 min-[900px]:grid-cols-2">
        {FEATURE_FLAGS.map((f) => (
          <Switch
            key={f}
            label={t(FEATURE_LABEL[f])}
            checked={features[f]}
            disabled={readOnly}
            onCheckedChange={(v) => {
              setSaved(false);
              setFeatures((cur) => ({ ...cur, [f]: v }));
            }}
            stateText={t(features[f] ? 'a11y.on' : 'a11y.off')}
          />
        ))}
      </div>
      <div className="mt-6 grid gap-5 min-[900px]:grid-cols-3">
        {LIMIT_KEYS.map((k) => (
          <LimitField
            key={k}
            label={t(LIMIT_LABEL[k])}
            value={limits[k]}
            error={errors[k]}
            disabled={readOnly}
            onChange={(v) => {
              setSaved(false);
              setLimits((cur) => ({ ...cur, [k]: v }));
            }}
          />
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button onClick={submit} disabled={readOnly || save.isPending}>
          {t('org.saveEntitlements')}
        </Button>
        <p role="status" className="font-bold text-tick">
          {saved ? t('org.entitlementsSaved') : null}
        </p>
        {save.isError ? <InlineMessage>{save.error.message}</InlineMessage> : null}
      </div>
    </section>
  );
}

function LimitField(p: {
  label: string;
  value: string;
  error?: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const id = `limit-${p.label.replace(/\W/g, '')}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-bold">
        {p.label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={p.value}
        disabled={p.disabled}
        aria-invalid={p.error ? true : undefined}
        aria-describedby={p.error ? `${id}-error` : undefined}
        onChange={(e) => p.onChange(e.target.value)}
        className="min-h-11 w-full rounded-control border border-graphite bg-surface px-3 tabular aria-[invalid=true]:border-redpen"
      />
      {p.error ? (
        <p id={`${id}-error`} className="text-body-small font-bold text-redpen">
          {p.error}
        </p>
      ) : null}
    </div>
  );
}

export function UsageTable({ org }: { org: PlatformOrgDetail }) {
  const u = org.usage;
  const l = org.entitlements.limits;
  const gb = (bytes: number) => `${formatCount(Math.round((bytes / 1e9) * 100) / 100)} GB`;
  const rows: Array<{ key: string; measure: MessageKey; used: string; limit: string }> = [
    { key: 'students', measure: 'usage.students', used: formatCount(u.students), limit: formatCount(l.max_students) },
    { key: 'admins', measure: 'usage.admins', used: formatCount(u.admins), limit: formatCount(l.max_admins) },
    { key: 'tests', measure: 'usage.tests', used: formatCount(u.testsRun), limit: t('common.noLimit') },
    {
      key: 'imports',
      measure: 'usage.aiImports',
      used: formatCount(u.aiImports),
      limit: formatCount(l.ai_imports_per_month),
    },
    {
      key: 'reports',
      measure: 'usage.aiReports',
      used: formatCount(u.aiReports),
      limit: formatCount(l.ai_reports_per_month),
    },
    { key: 'storage', measure: 'usage.storage', used: gb(u.storageBytes), limit: `${formatCount(l.storage_gb)} GB` },
  ];
  return (
    <Table
      caption={t('org.usageTitle')}
      rows={rows}
      rowKey={(r) => r.key}
      columns={[
        { key: 'measure', header: t('usage.measure'), cell: (r) => t(r.measure) },
        { key: 'used', header: t('usage.used'), align: 'end', cell: (r) => r.used },
        { key: 'limit', header: t('usage.limit'), align: 'end', cell: (r) => r.limit },
      ]}
    />
  );
}
