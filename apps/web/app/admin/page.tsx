'use client';

import type { OrgDetail } from '@mitaoe/shared';
import { PageHeader } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

export default function AdminHome() {
  const { session } = useSession();
  const orgId = session.status === 'ready' ? session.me.orgId : null;
  const org = useQuery({ queryKey: qk.org(orgId ?? ''), queryFn: () => api<OrgDetail>('/v1/org'), enabled: !!orgId });
  return <PageHeader title={t('admin.title')} subtitle={t('admin.lead', { org: org.data?.name ?? '' })} />;
}
