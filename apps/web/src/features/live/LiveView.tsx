'use client';

import {
  LIVE_FILTERS,
  LIVE_ROW_STATUSES,
  liveCounts,
  liveRows,
  matchesLiveFilter,
  matchesLiveSearch,
  sortLiveRows,
  type LiveFilter,
  type LiveRow,
  type LiveRoster as Roster,
  type LiveSortKey,
} from '@mitaoe/shared';
import { Button, EmptyState, InlineMessage, PageHeader, Skeleton, type MenuItem } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { testHeading } from '@/features/authoring/tests/test-view';
import { useServerNow } from '@/features/student/Countdown';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { ExtraTimeDialog } from './ExtraTimeDialog';
import { LiveRoster } from './LiveRoster';
import { liveUrl } from './live-url';
import { useLiveMirror } from './useLiveMirror';

const link = 'inline-flex min-h-11 items-center font-bold text-ballpoint underline';
const toggle = 'aria-pressed:border-ink aria-pressed:bg-highlighter aria-pressed:text-highlighter-ink';

/**
 * /admin/live/?test=<testId> (OPS-01 to OPS-03, US-AD-11): counts, filters, search and a row per student. The roster
 * of eligible students is the one API read (PERF-04); every status after that comes from Realtime Database.
 */
export function LiveView({ testId }: { testId: string }) {
  const { orgId, org, features } = useWorkspace();
  const roster = useQuery({
    queryKey: qk.orgItem(orgId, 'live-roster', testId),
    queryFn: () => api<Roster>(`/v1/tests/${encodeURIComponent(testId)}/live`),
    // Loaded once: live updates never come from the API.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
  const mirror = useLiveMirror(orgId, testId, roster.isSuccess);
  const now = useServerNow();
  const [filters, setFilters] = useState<LiveFilter[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: LiveSortKey; dir: 'asc' | 'desc' }>({ key: 'student', dir: 'asc' });
  const [granting, setGranting] = useState<{ attemptId: string; name: string; deadlineAt: number } | null>(null);

  const rows = useMemo(
    () =>
      roster.data && mirror.records && mirror.presence
        ? liveRows({
            students: roster.data.students,
            records: mirror.records,
            presence: mirror.presence,
            secondCamera: roster.data.test.secondCamera,
          })
        : [],
    [roster.data, mirror.records, mirror.presence],
  );
  const shown = sortLiveRows(
    rows.filter((r) => filters.every((f) => matchesLiveFilter(r, f, now)) && matchesLiveSearch(r, search)),
    sort,
    now,
  );

  const back = (
    <Link href={liveUrl()} className={link}>
      {t('live.back')}
    </Link>
  );
  if (roster.error instanceof ApiError && roster.error.status === 404)
    return (
      <div className="flex flex-col items-start gap-2">
        <h1 className="font-display text-display-2 font-bold">{t('tests.notFound')}</h1>
        <p>{t('tests.notFoundBody', { org: org?.name ?? '' })}</p>
        {back}
      </div>
    );
  if (roster.isError)
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="font-display text-display-2 font-bold">{t('nav.live')}</h1>
        <InlineMessage>{t('common.loadFailed')}</InlineMessage>
        {back}
      </div>
    );
  // The heading appears together with the counts and rows it introduces.
  if (!roster.data || !mirror.records || !mirror.presence)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-12 w-96" />
        <Skeleton className="mt-6 h-16 w-full" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );

  const counts = liveCounts(rows, roster.data.students.length);
  const { durationMin } = roster.data.test;
  // FF-03: with extra_time_grants off the item stays in the menu, disabled, saying why.
  const extraTimeOn = features?.extra_time_grants !== false;
  const actions = (r: LiveRow): MenuItem[] => {
    const items: MenuItem[] = [];
    if (r.status === 'in_progress' && r.attemptId && r.deadlineAt !== null) {
      const grant = { attemptId: r.attemptId, name: r.name, deadlineAt: r.deadlineAt };
      items.push({
        label: t('live.action.grantExtra'),
        onSelect: () => setGranting(grant),
        ...(extraTimeOn ? {} : { disabled: true, hint: t('plan.notIncluded') }),
      });
    }
    return items;
  };
  const toggleFilter = (f: LiveFilter) => setFilters((on) => (on.includes(f) ? on.filter((x) => x !== f) : [...on, f]));
  const clear = () => {
    setFilters([]);
    setSearch('');
  };
  return (
    <>
      <PageHeader title={t('live.heading', { heading: testHeading(roster.data.test) })} actions={back} />
      {mirror.failed ? <InlineMessage>{t('live.mirrorFailed')}</InlineMessage> : null}
      <ul aria-label={t('live.counts')} className="mb-6 flex flex-wrap gap-3">
        {(['eligible', ...LIVE_ROW_STATUSES] as const).map((k) => (
          <li key={k} className="rounded-panel border border-rule bg-surface px-4 py-3 text-body-small">
            {t(`live.count.${k}`, { n: formatCount(counts[k]) })}
          </li>
        ))}
      </ul>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div role="group" aria-label={t('live.filters')} className="flex flex-wrap gap-2">
          {LIVE_FILTERS.map((f) => (
            <Button
              key={f}
              variant="secondary"
              className={toggle}
              aria-pressed={filters.includes(f)}
              onClick={() => toggleFilter(f)}
            >
              {t(`live.filter.${f}`)}
            </Button>
          ))}
        </div>
        <div className="flex min-w-64 flex-1 flex-col gap-1">
          <label htmlFor="live-search" className="font-bold">
            {t('live.search')}
          </label>
          <input
            id="live-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-h-11 rounded-control border border-graphite bg-surface px-3"
          />
        </div>
      </div>
      <LiveRoster
        rows={shown}
        now={now}
        sort={sort}
        onSortChange={setSort}
        actions={actions}
        empty={
          <EmptyState
            message={t('live.noMatch')}
            action={
              <Button variant="secondary" onClick={clear}>
                {t('live.clearFilters')}
              </Button>
            }
          />
        }
      />
      {granting ? (
        <ExtraTimeDialog
          {...granting}
          durationMin={durationMin}
          timezone={org?.timezone ?? 'Asia/Kolkata'}
          onClose={() => setGranting(null)}
        />
      ) : null}
    </>
  );
}
