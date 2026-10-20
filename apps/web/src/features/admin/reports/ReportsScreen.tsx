'use client';

import type { Page, ReportListItem, ReportStatus, ReportUsage } from '@mitaoe/shared';
import {
  Button,
  EmptyState,
  InlineMessage,
  notify,
  PageHeader,
  rememberOpener,
  Skeleton,
  StatusPill,
  Table,
  type Tone,
} from '@mitaoe/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { t, type MessageKey } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { formatCount, formatZonedDay, formatZonedTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { GenerateReportDialog } from './GenerateReportDialog';

/** Polled while a listed report is still being made: each status change shows within 5 seconds (phase 7 contract). */
const POLL_MS = 2000;
/** Otherwise refreshed now and then, so the 15-minute file links of an open page stay fresh (EXP-06). */
const IDLE_MS = 10 * 60_000;
const PENDING: ReadonlyArray<ReportStatus> = ['queued', 'running', 'retrying'];

const STATUS: Record<ReportStatus, { key: MessageKey; tone: Tone }> = {
  queued: { key: 'reports.statusGenerating', tone: 'info' },
  running: { key: 'reports.statusGenerating', tone: 'info' },
  retrying: { key: 'reports.statusRetrying', tone: 'neutral' },
  ready: { key: 'reports.statusReady', tone: 'success' },
  failed: { key: 'reports.statusFailed', tone: 'danger' },
};

/** Every page of `GET /v1/reports`, newest first. */
async function allReports(): Promise<ReportListItem[]> {
  const items: ReportListItem[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const page: Page<ReportListItem> = await api<Page<ReportListItem>>(`/v1/reports?limit=200${query}`);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

const featureOff = (e: unknown) => e instanceof ApiError && e.code === 'FEATURE_DISABLED';

/**
 * The admin Reports page (US-AD-15, EXP-06, EXP-07, FF-03): the month's usage against the limit, every report newest
 * first with its status (polled while one is being made, changes announced politely, WCAG 4.1.3) and its download
 * links once ready, and the Generate report dialog. While `analytics_reports` is off the page is locked: the button is
 * disabled with the plan notice and nothing else is shown or fetched (every report route answers 403 then, FF-02).
 */
export function ReportsScreen() {
  const { orgId, org, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const lockedId = useId();
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLButtonElement>(null);
  const enabled = org?.entitlements.features.analytics_reports === true;

  const usageKey = qk.orgList(orgId, 'report-usage');
  const listKey = qk.orgList(orgId, 'reports');
  const usage = useQuery({
    queryKey: usageKey,
    queryFn: () => api<ReportUsage>('/v1/reports/usage'),
    enabled,
  });
  const list = useQuery({
    queryKey: listKey,
    queryFn: allReports,
    enabled,
    refetchInterval: (q) => (q.state.data?.some((r) => PENDING.includes(r.status)) ? POLL_MS : IDLE_MS),
  });
  const announcement = useStatusAnnouncement(list.data);

  const locked = !!org && (!enabled || featureOff(usage.error) || featureOff(list.error));
  const settled = (q: { isPending: boolean }) => !q.isPending;
  // The heading arrives with what the page shows under it, never before (the lock, or the usage and the list).
  if (!org || (!locked && !(settled(usage) && settled(list))))
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')} className="flex flex-col gap-4">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  const openDialog = (from: 'header' | 'empty') => {
    if (locked || readOnly) return;
    // Focus returns to the header's button: the empty state's own button is gone once the first report is listed.
    if (from === 'empty' && header.current) rememberOpener(header.current);
    setOpen(true);
  };
  const created = () => {
    setOpen(false);
    notify.info(t('reports.generating'));
    void qc.invalidateQueries({ queryKey: listKey });
    void qc.invalidateQueries({ queryKey: usageKey });
  };
  const items = list.data ?? [];
  const timeZone = org.timezone;

  return (
    <>
      <PageHeader
        title={t('nav.reports')}
        subtitle={locked ? undefined : t('reports.lead')}
        actions={
          <Button
            ref={header}
            onClick={() => openDialog('header')}
            disabled={locked || readOnly}
            aria-describedby={locked ? lockedId : undefined}
          >
            {t('reports.generate')}
          </Button>
        }
      />
      {locked ? (
        <p id={lockedId} className="text-graphite">
          {t('plan.notIncluded')}
        </p>
      ) : (
        <>
          {usage.data ? (
            <p className="mb-4 tabular">
              {t('reports.usage', { used: formatCount(usage.data.used), limit: formatCount(usage.data.limit) })}
            </p>
          ) : null}
          {usage.isError || list.isError ? <InlineMessage>{t('common.loadFailed')}</InlineMessage> : null}
          {list.isSuccess && items.length === 0 ? (
            <EmptyState
              message={t('reports.empty')}
              action={
                <Button onClick={() => openDialog('empty')} disabled={readOnly}>
                  {t('reports.generate')}
                </Button>
              }
            />
          ) : list.isSuccess ? (
            <Table
              caption={t('nav.reports')}
              rows={items}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: 'report',
                  header: t('reports.colReport'),
                  // A long unbroken word in a title wraps instead of pushing Status and Files off-screen.
                  cell: (r) => <span className="wrap-anywhere">{r.title}</span>,
                },
                {
                  key: 'type',
                  header: t('reports.colType'),
                  cell: (r) => t(r.scope === 'test' ? 'reports.typeTest' : 'reports.typeSeries'),
                },
                {
                  key: 'requested',
                  header: t('reports.colRequested'),
                  cell: (r) =>
                    t('time.dayTime', {
                      date: formatZonedDay(r.createdAt, timeZone),
                      time: formatZonedTime(r.createdAt, timeZone),
                    }),
                },
                { key: 'by', header: t('reports.colRequestedBy'), cell: (r) => r.createdBy.name },
                {
                  key: 'status',
                  header: t('reports.colStatus'),
                  cell: (r) => <StatusPill tone={STATUS[r.status].tone}>{t(STATUS[r.status].key)}</StatusPill>,
                },
                { key: 'files', header: t('reports.colFiles'), cell: (r) => <Files report={r} /> },
              ]}
            />
          ) : null}
        </>
      )}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
      {open && usage.data ? (
        <GenerateReportDialog limit={usage.data.limit} onClose={() => setOpen(false)} onCreated={created} />
      ) : null}
    </>
  );
}

function Files({ report }: { report: ReportListItem }) {
  if (report.status === 'failed' && report.error) return <span className="text-graphite">{report.error.message}</span>;
  if (report.status !== 'ready') return null;
  const links = [
    { file: report.pdf, format: 'PDF' },
    { file: report.xlsx, format: 'XLSX' },
  ].filter((l) => l.file);
  return (
    <span className="flex flex-wrap gap-x-4">
      {links.map(({ file, format }) => (
        <a
          key={format}
          href={file!.url}
          className="inline-flex min-h-11 items-center font-bold text-ballpoint underline"
        >
          {t('reports.download', { format })}
        </a>
      ))}
    </span>
  );
}

/**
 * The words for the latest status change of a listed report (`<title>: Ready`), for a polite live region: the first
 * load and reports that appear or keep their status announce nothing.
 */
function useStatusAnnouncement(items: ReportListItem[] | undefined): string {
  const seen = useRef<Map<string, ReportStatus> | null>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    if (!items) return;
    const before = seen.current;
    seen.current = new Map(items.map((r) => [r.id, r.status]));
    if (!before) return;
    const changed = items.filter((r) => {
      const was = before.get(r.id);
      return was !== undefined && STATUS[was].key !== STATUS[r.status].key;
    });
    if (changed.length)
      setText(
        changed.map((r) => t('reports.statusChanged', { title: r.title, status: t(STATUS[r.status].key) })).join('. '),
      );
  }, [items]);
  return text;
}
