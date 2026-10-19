'use client';

import type { LiveTestList } from '@mitaoe/shared';
import { EmptyState, InlineMessage, PageHeader, Table } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { testHeading } from '@/features/authoring/tests/test-view';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { formatWindow } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { liveUrl } from './live-url';

const link = 'inline-flex min-h-11 items-center font-bold text-ballpoint underline';

/** /admin/live/ (OPS-01): published tests whose window is open on the server's clock, earliest start first. */
export function LiveExamsList() {
  const { orgId, org } = useWorkspace();
  const zone = org?.timezone ?? 'Asia/Kolkata';
  const list = useQuery({
    queryKey: qk.orgList(orgId, 'live-tests'),
    queryFn: () => api<LiveTestList>('/v1/live-tests'),
  });
  const items = list.data?.items ?? [];
  return (
    <>
      <PageHeader title={t('nav.live')} subtitle={t('live.lead')} />
      {list.isError ? <InlineMessage>{t('common.loadFailed')}</InlineMessage> : null}
      {list.isSuccess && items.length === 0 ? (
        <EmptyState
          message={t('live.empty')}
          action={
            <Link href="/admin/series/" className={link}>
              {t('live.goToSeries')}
            </Link>
          }
        />
      ) : (
        <Table
          caption={t('nav.live')}
          busy={list.isPending}
          rows={items}
          rowKey={(r) => r.testId}
          columns={[
            {
              key: 'test',
              header: t('live.colTest'),
              cell: (r) => (
                <Link href={liveUrl(r.testId)} className={link}>
                  {testHeading(r)}
                </Link>
              ),
            },
            { key: 'series', header: t('live.colSeries'), cell: (r) => r.seriesTitle },
            { key: 'window', header: t('live.colWindow'), cell: (r) => formatWindow(r.window, zone) },
          ]}
        />
      )}
    </>
  );
}
