'use client';

import type { ExportCreated, ExportFormat, ExportInfo, ExportScope } from '@mitaoe/shared';
import { Button } from '@mitaoe/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';

const FORMATS: ReadonlyArray<{ format: ExportFormat; label: 'CSV' | 'XLSX' }> = [
  { format: 'csv', label: 'CSV' },
  { format: 'xlsx', label: 'XLSX' },
];
const POLL_MS = 1000;
const done = (s: ExportInfo['status'] | undefined) => s === 'ready' || s === 'failed';

/**
 * The `Export results` region of the admin test and series results pages (US-AD-14, EXP-01 to EXP-03): Export CSV and
 * Export XLSX ask the API for an export (with an Idempotency-Key), the page polls it until the worker has built the
 * file, then offers the signed download link, valid for 15 minutes. Locked with the plan notice while
 * `results_export` is off (FF-03).
 */
export function ExportRegion({ scope, refId }: { scope: ExportScope; refId: string }) {
  const { orgId, features } = useWorkspace();
  const headingId = useId();
  const lockedId = useId();
  const locked = features ? !features.results_export : false;

  const start = useMutation({
    mutationFn: (format: ExportFormat) =>
      api<ExportCreated>('/v1/exports', {
        method: 'POST',
        body: { scope, refId, format },
        headers: { 'idempotency-key': crypto.randomUUID() },
      }),
  });
  const exportId = start.data?.id ?? null;
  const progress = useQuery({
    queryKey: qk.orgItem(orgId, 'export', exportId ?? ''),
    queryFn: () => api<ExportInfo>(`/v1/exports/${encodeURIComponent(exportId!)}`),
    enabled: exportId !== null,
    refetchInterval: (q) => (done(q.state.data?.status) ? false : POLL_MS),
  });
  const info = progress.data;
  const preparing = start.isPending || (exportId !== null && !done(info?.status) && !progress.isError);
  const failed = start.isError || progress.isError || info?.status === 'failed';
  const ready = info?.status === 'ready' && info.url ? info : null;
  const label = FORMATS.find((f) => f.format === (ready?.format ?? start.variables))?.label ?? 'CSV';

  return (
    <section
      aria-labelledby={headingId}
      className="mt-6 flex flex-col items-start gap-3 rounded-panel border border-rule p-5"
    >
      <h2 id={headingId} className="text-heading-2 font-bold">
        {t('results.export')}
      </h2>
      <div className="flex flex-wrap gap-3">
        {FORMATS.map(({ format, label: name }) => (
          <Button
            key={format}
            variant="secondary"
            aria-disabled={locked || preparing || undefined}
            aria-describedby={locked ? lockedId : undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            onClick={() => !locked && !preparing && start.mutate(format)}
          >
            {t('results.exportAs', { format: name })}
          </Button>
        ))}
      </div>
      {locked ? (
        <p id={lockedId} className="text-graphite">
          {t('plan.notIncluded')}
        </p>
      ) : null}
      <p role="status" className={preparing || ready ? undefined : 'sr-only'}>
        {preparing ? t('results.exportPreparing') : ready ? t('results.exportReady') : ''}
      </p>
      {ready ? (
        <p className="flex flex-wrap items-center gap-x-3">
          <a href={ready.url} className="inline-flex min-h-11 items-center font-bold text-ballpoint underline">
            {t('results.exportDownload', { format: label })}
          </a>
          <span className="text-graphite">{t('results.exportLinkNote')}</span>
        </p>
      ) : null}
      {failed && !preparing ? <p role="alert">{t('results.exportFailed')}</p> : null}
    </section>
  );
}
