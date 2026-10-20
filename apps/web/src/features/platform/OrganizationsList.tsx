'use client';

import type { PlatformOrg } from '@mitaoe/shared';
import { InlineMessage, PageHeader, Table } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { OrgStatus } from './status';

/** US-SA-01: every organization with its status and size. */
export function OrganizationsList() {
  const orgs = useQuery({
    queryKey: qk.platformOrgs(),
    queryFn: () => api<{ items: PlatformOrg[] }>('/v1/platform/orgs'),
  });
  return (
    <>
      <PageHeader
        title={t('platform.title')}
        subtitle={t('platform.lead')}
        actions={
          <Link
            href="/platform/new/"
            className="inline-flex min-h-11 items-center rounded-control bg-ballpoint px-4 font-bold text-on-ballpoint"
          >
            {t('org.new')}
          </Link>
        }
      />
      {orgs.isError ? <InlineMessage>{t('common.loadFailed')}</InlineMessage> : null}
      <Table
        caption={t('platform.title')}
        busy={orgs.isPending}
        rows={orgs.data?.items ?? []}
        rowKey={(o) => o.id}
        columns={[
          {
            key: 'name',
            header: t('org.name'),
            cell: (o) => (
              <Link
                href={`/platform/org/?id=${encodeURIComponent(o.id)}`}
                className="inline-flex min-h-11 items-center font-bold text-ballpoint underline"
              >
                {o.name}
              </Link>
            ),
          },
          { key: 'slug', header: t('org.slug'), cell: (o) => o.slug },
          { key: 'status', header: t('org.status'), cell: (o) => <OrgStatus status={o.status} /> },
          { key: 'students', header: t('org.students'), align: 'end', cell: (o) => formatCount(o.usage.students) },
          { key: 'admins', header: t('org.admins'), align: 'end', cell: (o) => formatCount(o.usage.admins) },
        ]}
      />
    </>
  );
}
