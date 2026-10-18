'use client';

import type { OrgDetail } from '@mitaoe/shared';
import { PageHeader } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

export function AdminOverview() {
  const { session } = useSession();
  const me = session.status === 'ready' ? session.me : null;
  const org = useQuery({
    queryKey: qk.org(me?.orgId ?? ''),
    queryFn: () => api<OrgDetail>('/v1/org'),
    enabled: !!me?.orgId,
  });
  // /v1/me already names the org, so the subtitle never shows an empty name while /v1/org loads or fails.
  const name = org.data?.name ?? me?.org?.name ?? '';
  return <PageHeader title={t('admin.title')} subtitle={t('admin.lead', { org: name })} />;
}
