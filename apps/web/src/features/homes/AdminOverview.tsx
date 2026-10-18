'use client';

import { PageHeader } from '@mitaoe/ui';
import { t } from '@/i18n';
import { useWorkspace } from '@/lib/workspace';

export function AdminOverview() {
  const { org, me } = useWorkspace();
  // /v1/me already names an admin's org, so the subtitle never shows an empty name while /v1/org loads or fails.
  const name = org?.name ?? me.org?.name ?? '';
  return <PageHeader title={t('admin.title')} subtitle={t('admin.lead', { org: name })} />;
}
