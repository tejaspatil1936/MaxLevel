'use client';

import { FEATURE_FLAGS, type OrgWorkspace } from '@mitaoe/shared';
import { InlineMessage, PageHeader, Switch } from '@mitaoe/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Lock } from 'lucide-react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { FEATURE_LABEL } from '../platform/Entitlements';

/** STU-03 profile locking (saved at once, optimistic) and the plan's features (FF-03). */
export function SettingsScreen() {
  const { orgId, org, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const key = qk.org(orgId);
  const lock = useMutation({
    mutationFn: (profileLocked: boolean) =>
      api<OrgWorkspace>('/v1/org/settings', { method: 'PATCH', body: { profileLocked } }),
    onMutate: async (profileLocked) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<OrgWorkspace>(key);
      if (previous) qc.setQueryData(key, { ...previous, profileLocked });
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (o) => qc.setQueryData(key, o),
  });
  return (
    <>
      <PageHeader title={t('nav.settings')} subtitle={t('settings.lead')} />
      <section aria-labelledby="settings-profiles" className="max-w-measure">
        <h2 id="settings-profiles" className="text-heading-1 font-bold">
          {t('settings.profiles')}
        </h2>
        <p className="mt-2 text-graphite">{t('settings.lockHint')}</p>
        <div className="mt-3">
          <Switch
            label={t('settings.lock')}
            checked={org?.profileLocked ?? false}
            disabled={!org || readOnly}
            onCheckedChange={(v) => lock.mutate(v)}
            stateText={t(org?.profileLocked ? 'a11y.on' : 'a11y.off')}
          />
        </div>
        {lock.isError ? <InlineMessage>{t('common.saveFailed', { reason: lock.error.message })}</InlineMessage> : null}
      </section>
      <section aria-labelledby="settings-plan" className="mt-10 max-w-measure">
        <h2 id="settings-plan" className="text-heading-1 font-bold">
          {t('settings.plan')}
        </h2>
        <ul aria-label={t('settings.features')} className="mt-3 flex flex-col divide-y divide-rule">
          {FEATURE_FLAGS.map((f) => {
            const on = org?.entitlements.features[f] ?? false;
            return (
              <li key={f} className="flex min-h-11 items-center justify-between gap-4 py-2">
                <span>{t(FEATURE_LABEL[f])}</span>
                <span className="flex items-center gap-2 text-graphite">
                  {on ? <Check aria-hidden size={16} /> : <Lock aria-hidden size={16} />}
                  {t(on ? 'plan.included' : 'plan.notIncluded')}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
