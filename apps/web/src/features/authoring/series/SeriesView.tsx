'use client';

import type { Series, SeriesStatus as Status } from '@mitaoe/shared';
import { Button, ConfirmDialog, InlineMessage, Menu, notify, PageHeader, Skeleton } from '@mitaoe/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { t } from '@/i18n';
import { api, ApiError, serverNow } from '@/lib/api';
import { formatMinutes, zoneName } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { seriesDates } from './SeriesList';
import { SeriesNotFound } from './SeriesNotFound';
import { SeriesStatus } from './SeriesStatus';

/** /admin/series/view/?id=… (WEB-02). */
export function SeriesView() {
  const { orgId } = useWorkspace();
  const id = useSearchParams().get('id') ?? '';
  const series = useQuery({
    queryKey: qk.orgItem(orgId, 'series', id),
    queryFn: () => api<Series>(`/v1/series/${encodeURIComponent(id)}`),
    enabled: !!id,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  if (!id || (series.error instanceof ApiError && series.error.status === 404)) return <SeriesNotFound />;
  if (series.isError) return <InlineMessage>{t('common.loadFailed')}</InlineMessage>;
  if (!series.data)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-12 w-80" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  return <SeriesPage series={series.data} />;
}

/**
 * SER-01, SER-02: the series with its dates, daily window and status; activate and archive from More actions.
 * F-2.03 adds Add test and the Tests by day timeline below the facts.
 */
function SeriesPage({ series }: { series: Series }) {
  const { orgId, org, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const zone = zoneName(org?.timezone ?? 'Asia/Kolkata', serverNow());
  const setStatus = useMutation({
    mutationFn: (status: Status) =>
      api<Series>(`/v1/series/${encodeURIComponent(series.id)}`, { method: 'PATCH', body: { status } }),
    onSuccess: (s) => {
      qc.setQueryData(qk.orgItem(orgId, 'series', s.id), s);
      void qc.invalidateQueries({ queryKey: qk.orgList(orgId, 'series') });
      setConfirmArchive(false);
      notify.success(t(s.status === 'archived' ? 'series.archivedNotice' : 'series.activated'));
    },
  });
  const daily = series.dailyWindow
    ? t('series.timeRange', {
        start: formatMinutes(series.dailyWindow.startMinutes),
        end: formatMinutes(series.dailyWindow.endMinutes),
        zone,
      })
    : null;

  return (
    <>
      <PageHeader
        title={series.title}
        subtitle={
          <span data-testid="series-status">
            <SeriesStatus status={series.status} />
          </span>
        }
        actions={
          <>
            <Menu
              trigger={
                <Button
                  variant="secondary"
                  aria-label={t('common.moreActions')}
                  className="min-w-11 px-2"
                  disabled={readOnly}
                >
                  <MoreHorizontal aria-hidden size={20} />
                </Button>
              }
              items={[
                ...(series.status !== 'active'
                  ? [{ label: t('series.activate'), onSelect: () => setStatus.mutate('active') }]
                  : []),
                ...(series.status !== 'archived'
                  ? [{ label: t('series.archive'), destructive: true, onSelect: () => setConfirmArchive(true) }]
                  : []),
              ]}
            />
            <Link
              href={`/admin/series/edit/?id=${encodeURIComponent(series.id)}`}
              className="inline-flex min-h-11 items-center rounded-control border border-rule bg-surface px-4 font-bold text-ink hover:bg-ballpoint-wash"
            >
              {t('series.edit')}
            </Link>
          </>
        }
      />
      {setStatus.isError && !confirmArchive ? <InlineMessage>{setStatus.error.message}</InlineMessage> : null}
      <dl className="grid max-w-measure grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        <dt className="font-bold">{t('series.dates')}</dt>
        <dd>{seriesDates(series)}</dd>
        {daily ? (
          <>
            <dt className="font-bold">{t('series.dailyWindow')}</dt>
            <dd>{daily}</dd>
          </>
        ) : null}
      </dl>
      {series.description ? <p className="mt-4 max-w-measure">{series.description}</p> : null}
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={t('series.archiveConfirm', { title: series.title })}
        description={t('series.archiveBody')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('series.archive')}
        destructive
        confirmDisabled={setStatus.isPending}
        onConfirm={() => setStatus.mutate('archived')}
      >
        {setStatus.isError ? <InlineMessage>{setStatus.error.message}</InlineMessage> : null}
      </ConfirmDialog>
    </>
  );
}
