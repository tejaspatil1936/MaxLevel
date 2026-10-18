'use client';

import type { Page, Series } from '@mitaoe/shared';
import { EmptyState, InlineMessage, PageHeader, Table } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { formatCount, formatDay } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { SeriesStatus } from './SeriesStatus';

export const seriesUrl = (id: string) => `/admin/series/view/?id=${encodeURIComponent(id)}`;
export const seriesDates = (s: Pick<Series, 'startDate' | 'endDate'>) =>
  t('series.dateRange', { from: formatDay(s.startDate), to: formatDay(s.endDate) });

/** SER-01: the org's series with their dates, test count and status. */
export function SeriesList() {
  const { orgId } = useWorkspace();
  const list = useQuery({
    queryKey: qk.orgList(orgId, 'series'),
    queryFn: () => api<Page<Series>>('/v1/series?limit=200'),
  });
  const items = list.data?.items ?? [];
  const newSeries = (
    <Link
      href="/admin/series/new/"
      className="inline-flex min-h-11 items-center rounded-control bg-ballpoint px-4 font-bold text-on-ballpoint"
    >
      {t('series.new')}
    </Link>
  );
  return (
    <>
      <PageHeader title={t('nav.series')} subtitle={t('series.lead')} actions={newSeries} />
      {list.isError ? <InlineMessage>{t('common.loadFailed')}</InlineMessage> : null}
      {list.isSuccess && items.length === 0 ? (
        <EmptyState message={t('series.empty')} action={newSeries} />
      ) : (
        <Table
          caption={t('nav.series')}
          busy={list.isPending}
          rows={items}
          rowKey={(s) => s.id}
          columns={[
            {
              key: 'title',
              header: t('series.colTitle'),
              cell: (s) => (
                <Link
                  href={seriesUrl(s.id)}
                  className="inline-flex min-h-11 items-center font-bold text-ballpoint underline"
                >
                  {s.title}
                </Link>
              ),
            },
            { key: 'dates', header: t('series.colDates'), cell: seriesDates },
            { key: 'tests', header: t('series.colTests'), align: 'end', cell: (s) => formatCount(s.testCount) },
            { key: 'status', header: t('series.colStatus'), cell: (s) => <SeriesStatus status={s.status} /> },
          ]}
        />
      )}
    </>
  );
}
