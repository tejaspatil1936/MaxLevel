'use client';

import { PageHeader } from '@mitaoe/ui';
import { t } from '@/i18n';
import { useSession } from '@/lib/session';

export default function AdminHome() {
  const { session } = useSession();
  const org = session.status === 'ready' ? (session.me.org?.name ?? '') : '';
  return <PageHeader title={t('admin.title')} subtitle={t('admin.lead', { org })} />;
}
