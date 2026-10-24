'use client';

import type { StudentDashboard as Dashboard, StudentTestSummary } from '@mitaoe/shared';
import { EmptyState, InlineMessage, PageHeader, Skeleton, StatusPill } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useId, type ReactNode } from 'react';
import { resultUrl } from '@/features/results/StudentResultScreen';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { formatCount, formatWindow } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';
import { Countdown } from './Countdown';
import { FINISHED_STATUS, studentTestUrl, testHeading } from './test-heading';

/** The countdown of a live test (to its last start) or an upcoming one (to its window start). */
const countdownOf = (test: StudentTestSummary, live: boolean) =>
  live
    ? { label: t('studentTests.lastStartIn'), target: test.lastStartAt }
    : { label: t('studentTests.opensIn'), target: test.window.start };

/**
 * US-ST-03, UX-11: the next test and its countdown in display numerals, then live, upcoming and completed tests. Every
 * time is in the organization's timezone and counted by the server's clock.
 */
export function StudentDashboard() {
  const { session } = useSession();
  const orgId = session.status === 'ready' ? (session.me.orgId ?? '') : '';
  const query = useQuery({
    queryKey: qk.orgList(orgId, 'student-dashboard'),
    queryFn: () => api<Dashboard>('/v1/student/dashboard'),
    enabled: !!orgId,
  });
  // A test that opens or passes its last start moves group: ask the server again.
  const { refetch: reload } = query;
  const refetch = useCallback(() => void reload(), [reload]);
  const d = query.data;
  const next = d
    ? d.live[0]
      ? { test: d.live[0], live: true }
      : d.upcoming[0] && { test: d.upcoming[0], live: false }
    : null;

  return (
    <>
      <PageHeader title={t('student.title')} />
      {query.isError ? <InlineMessage>{t('common.loadFailed')}</InlineMessage> : null}
      {!d ? (
        query.isError ? null : (
          <div role="status" aria-busy="true" aria-label={t('app.loading')}>
            <Skeleton className="h-40 w-full" />
            <Skeleton className="mt-6 h-24 w-full" />
          </div>
        )
      ) : d.live.length + d.upcoming.length + d.completed.length === 0 ? (
        <EmptyState
          message={t('studentTests.empty')}
          action={
            <Link href="/profile/" className="inline-flex min-h-11 items-center font-bold text-ballpoint underline">
              {t('studentTests.reviewProfile')}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-10">
          {next ? <NextTest test={next.test} live={next.live} timezone={d.timezone} onElapsed={refetch} /> : null}
          <Group title={t('studentTests.live')} items={d.live}>
            {(test) => <OpenItem test={test} live timezone={d.timezone} onElapsed={refetch} />}
          </Group>
          <Group title={t('studentTests.upcoming')} items={d.upcoming}>
            {(test) => <OpenItem test={test} live={false} timezone={d.timezone} onElapsed={refetch} />}
          </Group>
          <Group title={t('studentTests.completed')} items={d.completed}>
            {(test) => (
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-rule bg-surface p-5 shadow-sm">
                <div>
                  <Link
                    href={resultUrl(test.attemptId)}
                    className="text-heading-2 font-bold text-ink transition-colors hover:text-ballpoint"
                  >
                    {testHeading(test)}
                  </Link>
                  <p className="mt-1 text-body-small text-graphite">{t(FINISHED_STATUS[test.status])}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill tone={test.status === 'terminated' ? 'danger' : 'success'}>
                    {t(FINISHED_STATUS[test.status])}
                  </StatusPill>
                  <Link
                    href={resultUrl(test.attemptId)}
                    className="inline-flex min-h-10 items-center justify-center gap-1 rounded-control border border-rule bg-surface px-4 text-body-small font-bold text-ink transition-colors hover:bg-ballpoint-wash"
                  >
                    <span>{t('studentTests.viewDetails')}</span>
                    <span aria-hidden="true">&rarr;</span>
                  </Link>
                </div>
              </div>
            )}
          </Group>
        </div>
      )}
    </>
  );
}

function NextTest({
  test,
  live,
  timezone,
  onElapsed,
}: {
  test: StudentTestSummary;
  live: boolean;
  timezone: string;
  onElapsed: () => void;
}) {
  const id = useId();
  const targetUrl = test.attemptId
    ? `/exam/?attempt=${encodeURIComponent(test.attemptId)}`
    : studentTestUrl(test.testId);

  return (
    <section
      aria-labelledby={id}
      className="relative overflow-hidden rounded-panel border-2 border-rule bg-surface p-6 shadow-sm sm:p-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-4">
        <div className="flex items-center gap-2">
          <span className="text-caption font-bold uppercase tracking-wider text-graphite">
            {t('studentTests.nextTest')}
          </span>
          <StatusPill tone={live ? 'success' : 'neutral'}>
            {live ? (
              <span className="flex items-center gap-1.5 font-bold">
                <span className="h-2 w-2 animate-pulse rounded-full bg-tick" />
                {t('studentTests.live')}
              </span>
            ) : (
              t('studentTests.upcoming')
            )}
          </StatusPill>
        </div>
        {live ? <span className="text-body-small text-graphite">{t('studentTests.lateWarning')}</span> : null}
      </div>

      <div className="mt-5 grid grid-cols-1 items-start justify-between gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <Link
            href={targetUrl}
            className="inline-block font-display text-heading-1 font-bold text-ink transition-colors hover:text-ballpoint"
          >
            {testHeading(test)}
          </Link>
          {test.company ? <p className="mt-1 font-bold text-graphite">{test.company}</p> : null}

          <div className="mt-4 flex flex-wrap gap-4 text-body-small text-graphite">
            <div className="flex items-center gap-1.5 rounded-control border border-rule bg-surface-sunken px-3 py-1.5">
              <span className="font-semibold text-ink">Window:</span>
              <span>{formatWindow(test.window, timezone)}</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-control border border-rule bg-surface-sunken px-3 py-1.5">
              <span className="font-semibold text-ink">Duration:</span>
              <span>{formatCount(test.durationMin)} mins</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-start gap-4 rounded-control border border-rule bg-surface-sunken p-5 md:items-end md:text-right">
          <Countdown {...countdownOf(test, live)} size="display" onElapsed={onElapsed} />
          <Link
            href={targetUrl}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-ballpoint px-6 text-body font-bold text-on-ballpoint shadow transition-colors hover:bg-ink sm:w-auto"
          >
            <span>
              {test.attemptId
                ? t('studentTest.resume')
                : live
                  ? t('studentTests.startTest')
                  : t('studentTests.viewDetails')}
            </span>
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

function Group<T extends { testId: string }>({
  title,
  items,
  children,
}: {
  title: string;
  items: T[];
  children: (item: T) => ReactNode;
}) {
  const id = useId();
  if (items.length === 0) return null;
  return (
    <section>
      <h2 id={id} className="font-display text-heading-1 font-bold">
        {title}
      </h2>
      <div aria-labelledby={id} className="mt-4 flex flex-col gap-3">
        {items.map((item) => (
          <div key={item.testId}>{children(item)}</div>
        ))}
      </div>
    </section>
  );
}

function OpenItem({
  test,
  live,
  timezone,
  onElapsed,
}: {
  test: StudentTestSummary;
  live: boolean;
  timezone: string;
  onElapsed: () => void;
}) {
  const targetUrl = test.attemptId
    ? `/exam/?attempt=${encodeURIComponent(test.attemptId)}`
    : studentTestUrl(test.testId);

  return (
    <div className="flex flex-col gap-4 rounded-panel border border-rule bg-surface p-5 shadow-sm transition-colors hover:border-ballpoint sm:flex-row sm:items-center sm:justify-between">
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={targetUrl} className="text-heading-2 font-bold text-ink transition-colors hover:text-ballpoint">
            {testHeading(test)}
          </Link>
          <StatusPill tone={live ? 'success' : 'neutral'}>
            {live ? t('studentTests.live') : t('studentTests.upcoming')}
          </StatusPill>
        </div>
        {test.company ? <p className="mt-0.5 font-bold text-graphite">{test.company}</p> : null}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-body-small text-graphite">
          <span>{t('studentTests.window', { window: formatWindow(test.window, timezone) })}</span>
          <span>&bull;</span>
          <span>{t('studentTests.duration', { n: formatCount(test.durationMin) })}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 sm:flex-nowrap">
        <Countdown {...countdownOf(test, live)} size="compact" onElapsed={test.attemptId ? undefined : onElapsed} />
        <Link
          href={targetUrl}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-ballpoint px-5 text-body-small font-bold text-on-ballpoint shadow transition-colors hover:bg-ink"
        >
          <span>
            {test.attemptId
              ? t('studentTest.resume')
              : live
                ? t('studentTests.startTest')
                : t('studentTests.viewDetails')}
          </span>
          <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>
    </div>
  );
}
